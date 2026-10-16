/**
 * The model half of `eval-gen`.
 *
 * Everything here is a pure function over the deterministic `EvalGenReport` and the
 * loaded events it was built from: no clock, no file system, no network. It restates
 * each generated case as one observation anchored to that case's own evidence, and
 * builds the minimal excerpt a model may be shown, the same way `explain.ts` and
 * `compareModel.ts` do. The model layer only ever receives what this module produces.
 *
 * The one rule this module adds is about what the model is for. The cases are already
 * written; a model reads them against the events they cite and reports what it sees,
 * and it never rewrites an expectation. That is why the written file stays the
 * deterministic report whatever a model says, and why a finding here cites an event id
 * rather than a case id: the event is the thing both the reader and the model can open.
 */

import { asRecord, asText } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";
import type { EvalCase, EvalGenReport } from "./evalGen.js";
import type {
  EvalGenRequest,
  ModelEventExcerpt,
  ModelFinding,
  ModelObservation,
  ModelResult,
} from "./model/types.js";
import { ANSWER_CONTRACT, EVAL_GEN_TASK } from "./model/contract.js";
import { redactPayload } from "./model/redact.js";

/** Section of the report describing the model call, whether or not one happened. */
export interface EvalGenModelSection {
  enabled: boolean;
  ok: boolean;
  provider: string | null;
  model: string | null;
  requests: number;
  sent_events: number;
  request_bytes: number;
  /** Credential-looking payload values withheld from the request. */
  redacted_fields: number;
  /**
   * Why no request was made when `--model` was asked for: there were no cases to
   * review. Null whenever a request was made. A skipped call is not a failure, because
   * nothing was attempted.
   */
  skipped: string | null;
  /** Gaps the model itself declared. Kept apart from the deterministic ones. */
  unverified: string[];
  error: { kind: string; message: string } | null;
}

/** The deterministic report plus the model half, as `eval-gen` reports it. */
export interface EvalGenWithModel extends EvalGenReport {
  findings: ModelFinding[];
  /** What this report does not establish. Deterministic, never model-written. */
  unverified: string[];
  model: EvalGenModelSection;
}

/** A report ready to render, plus the request that would be sent if a model were asked. */
export interface EvalGenDraft {
  report: EvalGenWithModel;
  /** Null when the trace produced no case, so there was nothing to review. */
  request: EvalGenRequest | null;
  skipReason: string | null;
  /** Every event id in the trace, so a finding may cite an unquoted but real event. */
  knownEventIds: ReadonlySet<string>;
}

/** How one anchor reads inside a case statement. */
function anchor(eventId: string | null, line: number | null): string {
  if (eventId === null || line === null) {
    return "no recorded event";
  }
  return `line ${line} (${eventId})`;
}

/**
 * The first occurrence of one case that carries an event id, so the case can be cited.
 *
 * A case whose first occurrence had no id is still restated, with the first one that
 * did: dropping the case would hide it from the review, and the answer contract already
 * forbids a finding from citing nothing.
 */
function anchorOf(entry: EvalCase): { event_id: string | null; line: number | null } {
  for (const occurrence of entry.occurrences) {
    if (occurrence.event_id !== null) {
      return { event_id: occurrence.event_id, line: occurrence.line };
    }
  }
  return { event_id: null, line: null };
}

/**
 * One observation per case, restating the case in the case's own words.
 *
 * The expectation is quoted verbatim rather than paraphrased, so the model reads the
 * assertion this tool actually prints and cannot be seen to have approved a different
 * one. The counts, the sources and the first and last anchors are stated beside it
 * because a case is those things together, and a model shown only the sentence would
 * have to guess at the evidence it rests on.
 */
function caseObservation(entry: EvalCase): ModelObservation {
  const anchorEvent = anchorOf(entry);
  const sources = entry.sources.map((source) => `${source.value} x${source.count}`).join(", ");
  const last = entry.occurrences[entry.occurrences.length - 1];
  const statement =
    `${entry.case_id}: ${entry.expectation}; ` +
    `${entry.count} occurrence${entry.count === 1 ? "" : "s"}, ${entry.fatal} fatal` +
    `${sources.length === 0 ? "" : `, from ${sources}`}` +
    `${entry.tools.length === 0 ? "" : `, tools ${entry.tools.join(", ")}`}` +
    `; first at ${anchor(anchorEvent.event_id, anchorEvent.line)}` +
    `, last at ${anchor(last?.event_id ?? null, last?.line ?? null)}`;
  return {
    id: `obs_${entry.case_id.replace("case_", "")}`,
    kind: "eval_case",
    event_id: anchorEvent.event_id,
    line: anchorEvent.line,
    statement,
  };
}

/**
 * Quotes the events the cases cite, one entry per event, in file order.
 *
 * Exactly the events the cases name and no others: not the events the occurrences
 * relate to, and not the events that did not fail. Past `maxEvents` the rest are named
 * in `omitted` instead of quoted, and the caller reports that, so an event that was
 * named but not sent is still evidence a reader can open.
 *
 * Each payload is passed through `redactPayload` before it is quoted, and the number of
 * values that replaced is returned as `redacted`.
 */
function buildEvalGenExcerpt(
  events: LoadedEvent[],
  cases: EvalCase[],
  maxEvents: number,
): { excerpt: ModelEventExcerpt[]; omitted: string[]; redacted: number } {
  const wanted = new Set<string>();
  for (const entry of cases) {
    for (const occurrence of entry.occurrences) {
      if (occurrence.event_id !== null) {
        wanted.add(occurrence.event_id);
      }
    }
  }
  const excerpt: ModelEventExcerpt[] = [];
  const omitted: string[] = [];
  let redacted = 0;
  for (const { line, event } of events) {
    const record = asRecord(event);
    const eventId = record === null ? null : asText(record.event_id);
    if (eventId === null || !wanted.has(eventId)) {
      continue;
    }
    if (excerpt.length >= maxEvents) {
      omitted.push(eventId);
      continue;
    }
    const withheld = redactPayload(asRecord(record?.payload) ?? {});
    redacted += withheld.redacted;
    excerpt.push({
      event_id: eventId,
      line,
      type: asText(record?.type) ?? "unknown",
      payload: withheld.payload,
    });
  }
  return { excerpt, omitted, redacted };
}

/**
 * What the cases do not establish, stated without a model.
 *
 * A case is an assertion about a rerun, derived from one run's occurrences. It says
 * nothing about why the class happened, and it covers the shape of the failure this
 * trace recorded rather than every shape that class could take. Both are listed rather
 * than left for a reader to assume, because a case file reads like a specification and
 * is not one.
 */
function deterministicUnverified(report: EvalGenReport, omitted: string[], maxExcerptEvents: number): string[] {
  const notes: string[] = [];
  if (report.cases.length === 0) {
    notes.push("the trace records no failure, so there is no case for a model to review");
    return notes;
  }
  if (report.status === "incomplete") {
    notes.push("the file has no terminal event, so the run may have been cut short rather than finished");
  }
  notes.push("a case asserts that an error class does not recur; it does not establish why the class happened");
  notes.push(
    "a case carries the occurrences this trace recorded, so a rerun that fails in a different shape of the same class is not covered by it",
  );
  if (report.refusals > 0) {
    const calls = `${report.refusals} refused call${report.refusals === 1 ? "" : "s"}`;
    notes.push(
      `guardrail refusals produce no case, so ${calls} ${report.refusals === 1 ? "is" : "are"} not part of what a model reviews`,
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
 * Builds the whole report and the request a model would be sent.
 *
 * The draft is built whether or not a model runs, so the request boundary is visible
 * and testable without a provider, and so `eval-gen` without `--model` is a complete
 * answer rather than a stub. The request is null when the trace produced no case: a
 * clean run has nothing to review, and asking a model to review nothing would invite it
 * to invent a failure.
 */
export function buildEvalGenDraft(
  report: EvalGenReport,
  events: LoadedEvent[],
  options: { maxExcerptEvents: number; sendPaths: boolean },
): EvalGenDraft {
  const observations = report.cases.map(caseObservation);
  const { excerpt, omitted, redacted } = buildEvalGenExcerpt(events, report.cases, options.maxExcerptEvents);
  const knownEventIds = new Set(
    events.map((loaded) => asText(asRecord(loaded.event)?.event_id)).filter((id): id is string => id !== null),
  );

  const base: EvalGenWithModel = {
    ...report,
    findings: [],
    unverified: deterministicUnverified(report, omitted, options.maxExcerptEvents),
    model: {
      enabled: false,
      ok: false,
      provider: null,
      model: null,
      requests: 0,
      sent_events: excerpt.length,
      request_bytes: 0,
      redacted_fields: redacted,
      skipped: null,
      unverified: [],
      error: null,
    },
  };

  if (report.cases.length === 0) {
    return {
      report: base,
      request: null,
      skipReason:
        "the trace records no failure, so there is no case for a model to review; run explain --model to ask about the run itself",
      knownEventIds,
    };
  }

  return {
    report: base,
    request: {
      task: EVAL_GEN_TASK,
      output_contract: ANSWER_CONTRACT,
      observations,
      events: excerpt,
      file: options.sendPaths ? report.file : null,
      redacted_fields: redacted,
    },
    skipReason: null,
    knownEventIds,
  };
}

/** Reported when no model was asked, so the reader knows nothing here is interpretation. */
export const EVAL_GEN_NO_MODEL_NOTE = "no model was called, so these cases are only what the trace records";

/**
 * The report `eval-gen` prints when no model was asked for.
 *
 * The note is appended here rather than inside the draft so that a report built for a
 * model call never claims no model was called, and so the CLI and the tests cannot
 * render two different no-model reports.
 */
export function withoutEvalGenModel(draft: EvalGenDraft): EvalGenWithModel {
  return { ...draft.report, unverified: [...draft.report.unverified, EVAL_GEN_NO_MODEL_NOTE] };
}

/**
 * Folds one model attempt into the draft.
 *
 * A failed attempt keeps the deterministic cases and records the failure in the `model`
 * section with a non-zero exit code: the model's failure is never presented as a review
 * of the cases, and the cases themselves are not thrown away either.
 */
export function withEvalGenModelResult(base: EvalGenWithModel, result: ModelResult): EvalGenWithModel {
  if (!result.ok) {
    return {
      ...base,
      findings: [],
      model: {
        ...base.model,
        enabled: true,
        ok: false,
        provider: result.provider,
        model: result.model,
        requests: result.requests,
        sent_events: result.sent_events,
        request_bytes: result.request_bytes,
        redacted_fields: result.redacted_fields,
        skipped: null,
        unverified: [],
        error: { kind: result.kind, message: result.message },
      },
    };
  }
  return {
    ...base,
    findings: result.findings,
    model: {
      ...base.model,
      enabled: true,
      ok: true,
      provider: result.provider,
      model: result.model,
      requests: result.requests,
      sent_events: result.sent_events,
      request_bytes: result.request_bytes,
      redacted_fields: result.redacted_fields,
      skipped: null,
      unverified: result.unverified,
      error: null,
    },
  };
}

/**
 * Records that `--model` was asked for and no request was made.
 *
 * `ok` stays true because nothing failed: nothing was attempted. A caller reading a
 * non-zero exit code here would go looking for a provider problem that does not exist.
 */
export function withEvalGenSkippedModel(
  base: EvalGenWithModel,
  reason: string,
  provider: string,
  model: string,
): EvalGenWithModel {
  return {
    ...base,
    model: {
      ...base.model,
      enabled: true,
      ok: true,
      provider,
      model,
      requests: 0,
      sent_events: 0,
      request_bytes: 0,
      redacted_fields: 0,
      skipped: reason,
      unverified: [],
      error: null,
    },
  };
}
