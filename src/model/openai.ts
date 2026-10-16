/**
 * The one model backend this slice implements: an OpenAI-compatible
 * chat-completions endpoint.
 *
 * It speaks the dialect rather than one vendor's product, because gateways and local
 * servers implement the same shape and the caller already chose the base URL. The
 * client makes exactly one request and never retries: a retry is a second charge the
 * caller did not ask for, so a failed call is reported as a failure instead.
 */

import {
  ANSWER_CONTRACT,
  COMPARE_EVIDENCE_LABEL,
  COMPARE_SYSTEM_PROMPT,
  EVAL_GEN_SYSTEM_PROMPT,
  EXPLAIN_SYSTEM_PROMPT,
  FIX_SUGGEST_SYSTEM_PROMPT,
} from "./contract.js";
import { parseModelAnswer } from "./answer.js";
import type {
  CompareRequest,
  EvalGenRequest,
  ExplainRequest,
  ModelAttempt,
  ModelClient,
  ModelFailure,
  ModelResult,
  ModelSuccess,
  FixSuggestRequest,
} from "./types.js";

/** Bounds how much the model may write, and so how much of it lands in the report. */
const MAX_COMPLETION_TOKENS = 1024;

/** How much of an error body is echoed into the failure message. */
const ERROR_BODY_LIMIT = 200;

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Text of `choices[0].message.content`, or null when the envelope has none. */
function answerContent(envelope: unknown): string | null {
  const choices = asRecord(envelope)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const content = asRecord(asRecord(choices[0])?.message)?.content;
  return typeof content === "string" && content.trim().length > 0 ? content : null;
}

function reasonOf(error: unknown): string | undefined {
  const direct = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof direct === "string") {
    return direct;
  }
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = asRecord(cause)?.code;
  return typeof code === "string" ? code : undefined;
}

export class OpenAICompatibleClient implements ModelClient {
  readonly provider = "openai-compatible";

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  async complete(request: ExplainRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult> {
    return this.post(
      this.explainPayload(request),
      EXPLAIN_SYSTEM_PROMPT,
      "this trace",
      request.events.length,
      request.redacted_fields,
      knownEventIds,
    );
  }

  async completeCompare(request: CompareRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult> {
    return this.post(
      this.comparePayload(request),
      COMPARE_SYSTEM_PROMPT,
      COMPARE_EVIDENCE_LABEL,
      request.events.length,
      request.redacted_fields,
      knownEventIds,
    );
  }

  async completeEvalGen(request: EvalGenRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult> {
    return this.post(
      this.evalGenPayload(request),
      EVAL_GEN_SYSTEM_PROMPT,
      "this trace",
      request.events.length,
      request.redacted_fields,
      knownEventIds,
    );
  }

  async completeFixSuggest(request: FixSuggestRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult> {
    return this.post(
      this.fixSuggestPayload(request),
      FIX_SUGGEST_SYSTEM_PROMPT,
      "this trace",
      request.events.length,
      request.redacted_fields,
      knownEventIds,
    );
  }

  /** The explain payload, key for key as the task statement describes it. */
  private explainPayload(request: ExplainRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      task: request.task,
      output_contract: ANSWER_CONTRACT,
      observations: request.observations,
      events: request.events,
    };
    if (request.file !== null) {
      payload.file = request.file;
    }
    return payload;
  }

  /** The compare payload. Same shape, one task: the two files instead of one. */
  private comparePayload(request: CompareRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      task: request.task,
      output_contract: ANSWER_CONTRACT,
      observations: request.observations,
      events: request.events,
    };
    if (request.file_a !== null) {
      payload.file_a = request.file_a;
    }
    if (request.file_b !== null) {
      payload.file_b = request.file_b;
    }
    return payload;
  }

  /**
   * The eval-gen payload. Same shape again, and the evidence label is the plain one:
   * there is one trace, so a bare event id says which file it came from.
   */
  private evalGenPayload(request: EvalGenRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      task: request.task,
      output_contract: ANSWER_CONTRACT,
      observations: request.observations,
      events: request.events,
    };
    if (request.file !== null) {
      payload.file = request.file;
    }
    return payload;
  }

  /**
   * The fix-suggest payload. Same shape again, and the plain evidence label too: there
   * is one trace, so a bare event id says which file it came from.
   */
  private fixSuggestPayload(request: FixSuggestRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      task: request.task,
      output_contract: ANSWER_CONTRACT,
      observations: request.observations,
      events: request.events,
    };
    if (request.file !== null) {
      payload.file = request.file;
    }
    return payload;
  }

  /**
   * The one transport path every task shares.
   *
   * The task statement and the system prompt arrive with the request rather than being
   * chosen here, so another task cannot quietly reuse the wrong one, and so the string
   * a model is given exists in exactly one place: the constant the draft builder put on
   * the request. An earlier version chose the constant here as well, which left two
   * copies of one sentence and nothing comparing them -- the model could have been
   * given one task statement while the request object recorded another. Everything
   * after the body is built is identical for all of them: one request, never a retry.
   *
   * `redactedFields` is counted by whoever built the excerpt and travels beside the
   * payload rather than inside it: the wire body lists its fields explicitly, and a
   * number describing what was withheld is not one of them.
   */
  private async post(
    payload: Record<string, unknown>,
    systemPrompt: string,
    evidenceLabel: string,
    sentEvents: number,
    redactedFields: number,
    knownEventIds: ReadonlySet<string>,
  ): Promise<ModelResult> {
    const attempt: ModelAttempt = {
      provider: this.provider,
      model: this.model,
      requests: 0,
      sent_events: sentEvents,
      request_bytes: 0,
      redacted_fields: redactedFields,
    };
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      temperature: 0,
      max_tokens: MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
    });
    attempt.request_bytes = Buffer.byteLength(body, "utf8");
    attempt.requests = 1;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return { ...attempt, ok: false, ...this.transportFailure(error) };
    }

    if (!response.ok) {
      const excerpt = await this.errorExcerpt(response);
      return {
        ...attempt,
        ok: false,
        kind: "http_error",
        message: `the provider answered HTTP ${response.status}${excerpt}`,
      };
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(await response.text());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...attempt, ok: false, kind: "bad_shape", message: `the provider envelope is not JSON (${reason})` };
    }

    const content = answerContent(envelope);
    if (content === null) {
      return { ...attempt, ok: false, kind: "empty_answer", message: "the provider answer carries no message content" };
    }

    const answer = parseModelAnswer(content, knownEventIds, evidenceLabel);
    if (!answer.ok) {
      return { ...attempt, ok: false, kind: answer.kind, message: answer.message };
    }
    const success: ModelSuccess = { ...attempt, ok: true, findings: answer.findings, unverified: answer.unverified };
    return success;
  }

  private transportFailure(error: unknown): Omit<ModelFailure, keyof ModelAttempt | "ok"> {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { kind: "timeout", message: `the provider did not answer within ${this.timeoutMs} ms` };
    }
    const reason = reasonOf(error);
    return {
      kind: "network_error",
      message: `the provider could not be reached${reason === undefined ? "" : ` (${reason})`}`,
    };
  }

  private async errorExcerpt(response: Response): Promise<string> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      return "";
    }
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length === 0) {
      return "";
    }
    return `: ${flat.slice(0, ERROR_BODY_LIMIT)}${flat.length > ERROR_BODY_LIMIT ? "..." : ""}`;
  }
}
