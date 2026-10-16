/**
 * Deterministic half of `explain`.
 *
 * Everything in this module is a pure function over loaded events: no clock, no file
 * system, no network. It answers "what does this trace actually say about how the run
 * ended" by restating events, each one bound to its event id and line, and it builds
 * the minimal excerpt a model may be shown. The model layer only ever receives what
 * this module produces, so the request boundary is a property of the code rather than
 * a promise in the documentation.
 */

import type { LoadedEvent } from "./loader.js";
import { asRecord, asText, describeEvent, summarize } from "./analyze.js";
import type { RunStatus } from "./analyze.js";
import type {
  ExplainRequest,
  ModelEventExcerpt,
  ModelFinding,
  ModelObservation,
  ModelResult,
} from "./model/types.js";
import { ANSWER_CONTRACT, EXPLAIN_TASK } from "./model/contract.js";
import { redactPayload } from "./model/redact.js";

/** What one observation is about. Each kind restates events, it does not interpret them. */
export type ObservationKind =
  | "run_outcome"
  | "error_recorded"
  | "model_failure"
  | "tool_failure"
  | "permission_denied"
  | "withheld_tool"
  | "last_model_turn";

export interface ExplainObservation extends ModelObservation {
  kind: ObservationKind;
}

/** Section of the report describing the model call, whether or not one happened. */
export interface ExplainModelSection {
  enabled: boolean;
  ok: boolean;
  provider: string | null;
  model: string | null;
  requests: number;
  sent_events: number;
  request_bytes: number;
  /** Credential-looking payload values withheld from the request. */
  redacted_fields: number;
  /** Gaps the model itself declared. Kept apart from the deterministic ones. */
  unverified: string[];
  error: { kind: string; message: string } | null;
}

export interface ExplainReport {
  command: "explain";
  file: string;
  schema: string;
  run_id: string | null;
  status: RunStatus;
  events: number;
  observations: ExplainObservation[];
  findings: ModelFinding[];
  /** What this report does not establish. Deterministic, never model-written. */
  unverified: string[];
  model: ExplainModelSection;
}

/** A report ready to render, plus the request that would be sent if a model were asked. */
export interface ExplainDraft {
  report: ExplainReport;
  request: ExplainRequest;
  /** Every event id in the trace, so a finding may cite an unquoted but real event. */
  knownEventIds: ReadonlySet<string>;
}

type PendingObservation = Omit<ExplainObservation, "id">;

/** Tools the run itself declared unavailable, quoted from `run.started`. */
function withheldTools(payload: Record<string, unknown>, eventId: string | null, line: number): PendingObservation[] {
  const config = asRecord(payload.config_summary);
  const tools = config?.tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  const withheld: PendingObservation[] = [];
  for (const entry of tools) {
    const tool = asRecord(entry);
    const name = asText(tool?.name);
    if (name !== null && tool?.available === false) {
      withheld.push({
        kind: "withheld_tool",
        event_id: eventId,
        line,
        statement: `run.started declares tool ${name} unavailable`,
      });
    }
  }
  return withheld;
}

/**
 * Reduces a trace to evidence-bound observations.
 *
 * The order is fixed rather than file order, because a reader looks for the outcome
 * first and the supporting evidence second: the terminal event, then everything that
 * failed or was refused in file order, then the last thing the model said. Statements
 * reuse the `timeline` description of the same event, so the two commands cannot
 * describe one event two different ways.
 */
export function buildObservations(events: LoadedEvent[]): ExplainObservation[] {
  let outcome: PendingObservation | null = null;
 let lastTurn: PendingObservation | null = null;
  const middle: PendingObservation[] = [];

  for (const { line, event } of events) {
    const record = asRecord(event);
    if (record === null) {
      continue;
    }
    const type = asText(record.type) ?? "unknown";
    const eventId = asText(record.event_id);
    const payload = asRecord(record.payload) ?? {};

    switch (type) {
      case "run.finished":
      case "run.failed":
      case "run.cancelled":
        outcome = { kind: "run_outcome", event_id: eventId, line, statement: describeEvent(event) };
        break;
      case "error.recorded":
        middle.push({ kind: "error_recorded", event_id: eventId, line, statement: describeEvent(event) });
        break;
      case "model.response.failed":
        middle.push({ kind: "model_failure", event_id: eventId, line, statement: describeEvent(event) });
        break;
      case "tool.call.failed":
        middle.push({ kind: "tool_failure", event_id: eventId, line, statement: describeEvent(event) });
        break;
      case "permission.resolved":
        if (payload.decision === "denied") {
          middle.push({ kind: "permission_denied", event_id: eventId, line, statement: describeEvent(event) });
        }
        break;
      case "model.response.completed":
        lastTurn = { kind: "last_model_turn", event_id: eventId, line, statement: describeEvent(event) };
        break;
      case "run.started":
        middle.push(...withheldTools(payload, eventId, line));
        break;
      default:
        break;
    }
  }

  const ordered: PendingObservation[] = [
    ...(outcome === null ? [] : [outcome]),
    ...middle,
    ...(lastTurn === null ? [] : [lastTurn]),
  ];
  return ordered.map((observation, index) => ({ id: `obs_${index + 1}`, ...observation }));
}

/**
 * Quotes the events the observations cite, in file order.
 *
 * Past `maxEvents` the remaining ids are named in `omitted` instead of quoted, and
 * the caller reports that: an event that was named but not quoted is still evidence a
 * reader can open, it just was not sent anywhere.
 *
 * Each payload is passed through `redactPayload` before it is quoted, and the number
 * of values that replaced is returned as `redacted`. Withholding happens here rather
 * than in the transport because the excerpt is the only thing a model is ever shown,
 * so the boundary holds wherever the excerpt goes.
 */
export function buildExcerpt(
  events: LoadedEvent[],
  observations: ExplainObservation[],
  maxEvents: number,
): { excerpt: ModelEventExcerpt[]; omitted: string[]; redacted: number } {
  const wanted = new Set(observations.map((observation) => observation.event_id).filter((id): id is string => id !== null));
  const excerpt: ModelEventExcerpt[] = [];
  const omitted: string[] = [];
  let redacted = 0;
  for (const { line, event } of events) {
    const record = asRecord(event);
    if (record === null) {
      continue;
    }
    const eventId = asText(record.event_id);
    if (eventId === null || !wanted.has(eventId)) {
      continue;
    }
    if (excerpt.length >= maxEvents) {
      omitted.push(eventId);
      continue;
    }
    const withheld = redactPayload(asRecord(record.payload) ?? {});
    redacted += withheld.redacted;
    excerpt.push({
      event_id: eventId,
      line,
      type: asText(record.type) ?? "unknown",
      payload: withheld.payload,
    });
  }
  return { excerpt, omitted, redacted };
}

function deterministicUnverified(status: RunStatus, observations: ExplainObservation[], maxExcerptEvents: number, omitted: string[]): string[] {
  const notes: string[] = [];
  if (status === "incomplete") {
    notes.push("the file has no terminal event, so the final outcome of the run is not recorded");
  }
  const causes = observations.filter(
    (observation) => observation.kind !== "run_outcome" && observation.kind !== "last_model_turn",
  );
  if (causes.length === 0) {
    notes.push(
      "the trace records no failed model call, failed tool call, recorded error or denied permission, so it does not state a cause",
    );
  }
  if (omitted.length > 0) {
    notes.push(
      `only the first ${maxExcerptEvents} cited events were quoted; ${omitted.join(", ")} are named but not quoted`,
    );
  }
  return notes;
}

/**
 * Builds the whole deterministic report and the request a model would be sent.
 *
 * The draft is built whether or not a model runs, so the request boundary is visible
 * and testable without a provider, and so `explain` without `--model` is a complete
 * answer rather than a stub.
 */
export function buildExplainDraft(
  file: string,
  schemaLabel: string,
  events: LoadedEvent[],
  options: { maxExcerptEvents: number; sendPaths: boolean },
): ExplainDraft {
  const summary = summarize(file, schemaLabel, events);
  const observations = buildObservations(events);
  const { excerpt, omitted, redacted } = buildExcerpt(events, observations, options.maxExcerptEvents);
  const knownEventIds = new Set(
    events.map((loaded) => asText(asRecord(loaded.event)?.event_id)).filter((id): id is string => id !== null),
  );

  const report: ExplainReport = {
    command: "explain",
    file,
    schema: schemaLabel,
    run_id: summary.run_id,
    status: summary.status,
    events: events.length,
    observations,
    findings: [],
    unverified: deterministicUnverified(summary.status, observations, options.maxExcerptEvents, omitted),
    model: {
      enabled: false,
      ok: false,
      provider: null,
      model: null,
      requests: 0,
      sent_events: excerpt.length,
      request_bytes: 0,
      redacted_fields: redacted,
      unverified: [],
      error: null,
    },
  };

  return {
    report,
    request: {
      task: EXPLAIN_TASK,
      output_contract: ANSWER_CONTRACT,
      observations,
      events: excerpt,
      file: options.sendPaths ? file : null,
      redacted_fields: redacted,
    },
    knownEventIds,
  };
}

/** Reported when no model was asked, so the reader knows nothing here is interpretation. */
export const NO_MODEL_NOTE = "no model was called, so this report only restates what the trace records";

/**
 * Folds one model attempt into the draft.
 *
 * A failed attempt keeps the deterministic observations and records the failure in the
 * `model` section with a non-zero exit code: the model's failure is never presented as
 * a successful explanation, and the deterministic half is not thrown away either.
 */
export function withModelResult(base: ExplainReport, result: ModelResult): ExplainReport {
  if (!result.ok) {
    return {
      ...base,
      findings: [],
      model: {
        enabled: true,
        ok: false,
        provider: result.provider,
        model: result.model,
        requests: result.requests,
        sent_events: result.sent_events,
        request_bytes: result.request_bytes,
        redacted_fields: result.redacted_fields,
        unverified: [],
        error: { kind: result.kind, message: result.message },
      },
    };
  }
  return {
    ...base,
    findings: result.findings,
    model: {
      enabled: true,
      ok: true,
      provider: result.provider,
      model: result.model,
      requests: result.requests,
      sent_events: result.sent_events,
      request_bytes: result.request_bytes,
      redacted_fields: result.redacted_fields,
      unverified: result.unverified,
      error: null,
    },
  };
}
