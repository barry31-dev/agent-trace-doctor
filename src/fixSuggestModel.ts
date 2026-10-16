/**
 * The model half of `fix-suggest`.
 *
 * Everything here is a pure function over the deterministic `FixSuggestReport` and the
 * loaded events it was built from: no clock, no file system, no network. It restates each
 * suggestion as one observation anchored to that suggestion's own evidence, and builds
 * the minimal excerpt a model may be shown, the same way `explain.ts`, `compareModel.ts`
 * and `evalGenModel.ts` do. The model layer only ever receives what this module produces.
 *
 * The one rule this module adds is about what the model is for. The directions are
 * already written; a model reads them against the events they cite and reports what it
 * sees, and it never rewrites an action. That is why a finding here cites an event id
 * rather than a suggestion id: the event is the thing both the reader and the model can
 * open, and a direction that had to be taken on trust is the one this command exists to
 * avoid.
 */

import { asRecord, asText } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";
import type { FixSuggestReport, FixSuggestion } from "./fixSuggest.js";
import type {
  FixSuggestRequest,
  ModelEventExcerpt,
  ModelFinding,
  ModelObservation,
  ModelResult,
} from "./model/types.js";
import { ANSWER_CONTRACT, FIX_SUGGEST_TASK } from "./model/contract.js";
import { redactPayload } from "./model/redact.js";

/** Section of the report describing the model call, whether or not one happened. */
export interface FixSuggestModelSection {
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
   * Why no request was made when `--model` was asked for: the trace produced no
   * suggestion. Null whenever a request was made. A skipped call is not a failure,
   * because nothing was attempted.
   */
  skipped: string | null;
  /** Gaps the model itself declared. Kept apart from the deterministic ones. */
  unverified: string[];
  error: { kind: string; message: string } | null;
}

/** The deterministic report plus the model half, as `fix-suggest` reports it. */
export interface FixSuggestWithModel extends FixSuggestReport {
  findings: ModelFinding[];
  /** What this report does not establish. Deterministic, never model-written. */
  unverified: string[];
  model: FixSuggestModelSection;
}

/** A report ready to render, plus the request that would be sent if a model were asked. */
export interface FixSuggestDraft {
  report: FixSuggestWithModel;
  /** Null when the trace produced no suggestion, so there was nothing to review. */
  request: FixSuggestRequest | null;
  skipReason: string | null;
  /** Every event id in the trace, so a finding may cite an unquoted but real event. */
  knownEventIds: ReadonlySet<string>;
}

/** How one anchor reads inside a suggestion statement. */
function anchor(eventId: string | null, line: number | null): string {
  if (eventId === null || line === null) {
    return "no recorded event";
  }
  return `line ${line} (${eventId})`;
}

/**
 * The first occurrence of one suggestion that carries an event id, so it can be cited.
 *
 * `FixEvidence.event_id` is the id the event carried, which is empty on the two rules
 * whose evidence is not a failure occurrence. A suggestion whose first entry had no id
 * is still restated, with the first one that did: dropping it would hide a direction
 * from the review, and the answer contract already forbids a finding from citing
 * nothing.
 */
function anchorOf(suggestion: FixSuggestion): { event_id: string | null; line: number | null } {
  for (const entry of suggestion.evidence) {
    if (entry.event_id.length > 0) {
      return { event_id: entry.event_id, line: entry.line };
    }
  }
  return { event_id: null, line: null };
}

/**
 * One observation per suggestion, restating the suggestion in its own words.
 *
 * The action is quoted verbatim rather than paraphrased, so the model reads the direction
 * this tool actually prints and cannot be seen to have approved a different one. The rule,
 * the basis and both anchors are stated beside it because a suggestion is those things
 * together, and a model shown only the sentence would have to guess at the evidence it
 * rests on.
 */
function suggestionObservation(suggestion: FixSuggestion): ModelObservation {
  const first = anchorOf(suggestion);
  const last = suggestion.evidence[suggestion.evidence.length - 1];
  const statement =
    `${suggestion.suggestion_id}: ${suggestion.title}; rule ${suggestion.rule}` +
    `${suggestion.error_type === null ? "" : `, class ${suggestion.error_type}`}` +
    `${suggestion.tool === null ? "" : `, tool ${suggestion.tool}`}` +
    `, ${suggestion.count} event${suggestion.count === 1 ? "" : "s"} (${suggestion.fatal} fatal)` +
    `; basis: ${suggestion.basis}` +
    `; action: ${suggestion.action}` +
    `; first at ${anchor(first.event_id, first.line)}` +
    `, last at ${anchor(last?.event_id ?? null, last?.line ?? null)}`;
  return {
    id: `obs_${suggestion.suggestion_id.replace("sug_", "")}`,
    kind: "suggestion",
    event_id: first.event_id,
    line: first.line,
    statement,
  };
}

/**
 * Quotes the events the suggestions cite, one entry per event, in file order.
 *
 * Exactly the events the suggestions name and no others: not the events those relate to,
 * and not the events nothing was derived from. One event may be cited by two rules -- a
 * class whose every occurrence was fatal produces both a `fatal_failure` and a
 * `repeated_error_class` suggestion -- so the wanted set is a set and the file is walked
 * once. Past `maxEvents` the rest are named in `omitted` instead of quoted, and the caller
* reports that, so an event that was named but not sent is still evidence a reader can open.
 *
 * Each payload is passed through `redactPayload` before it is quoted, and the number of
 * values that replaced is returned as `redacted`.
 */
function buildFixSuggestExcerpt(
  events: LoadedEvent[],
  suggestions: FixSuggestion[],
  maxEvents: number,
): { excerpt: ModelEventExcerpt[]; omitted: string[]; redacted: number } {
  const wanted = new Set<string>();
  for (const suggestion of suggestions) {
    for (const entry of suggestion.evidence) {
      if (entry.event_id.length > 0) {
        wanted.add(entry.event_id);
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
 * What the suggestions do not establish, stated without a model.
 *
 * The deterministic notes already say that a direction is not a verified cause, that
 * none of them were executed and that a trace with no pattern is not a healthy run, so
 * none of that is repeated here. What is added is what a review of the directions cannot
 * reach: a truncated file is listed first, because a failure profile read off a prefix is
 * the thing most likely to send a reader the wrong way, which is also why the
 * deterministic half puts `incomplete_run` at the head of the suggestion list.
 */
function deterministicUnverified(
  report: FixSuggestReport,
  omitted: string[],
  maxExcerptEvents: number,
): string[] {
  const notes: string[] = [];
  if (report.suggestions.length === 0) {
    return notes;
  }
  if (report.status === "incomplete") {
    notes.push("the file has no terminal event, so the run may have been cut short rather than finished");
  }
  notes.push(
    "a suggestion covers the events this trace recorded, so a direction about a shape of failure this run did not hit is not among them",
  );
  if (report.refusals > 0) {
    notes.push(
      `guardrail refusals are a separate suggestion from failures, so ${report.refusals} refused call${report.refusals === 1 ? "" : "s"} ${report.refusals === 1 ? "is" : "are"} reviewed as a policy question rather than a broken call`,
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
 * The draft is built whether or not a model runs, so the request boundary is visible and
 * testable without a provider, and so `fix-suggest` without `--model` is a complete answer
 * rather than a stub. The request is null when the trace produced no suggestion: a
 * clean-looking run has nothing to review, and asking a model to review nothing would
 * invite it to invent a direction.
 */
export function buildFixSuggestDraft(
  report: FixSuggestReport,
  events: LoadedEvent[],
  options: { maxExcerptEvents: number; sendPaths: boolean },
): FixSuggestDraft {
  const observations = report.suggestions.map(suggestionObservation);
  const { excerpt, omitted, redacted } = buildFixSuggestExcerpt(events, report.suggestions, options.maxExcerptEvents);
  const knownEventIds = new Set(
    events.map((loaded) => asText(asRecord(loaded.event)?.event_id)).filter((id): id is string => id !== null),
  );

  const base: FixSuggestWithModel = {
    ...report,
    findings: [],
    unverified: [...report.unverified, ...deterministicUnverified(report, omitted, options.maxExcerptEvents)],
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

  if (report.suggestions.length === 0) {
    return {
      report: base,
      request: null,
      skipReason:
        "the trace records no pattern this slice knows how to suggest about, so there is no direction for a model to review; run explain --model to ask about the run itself",
      knownEventIds,
    };
  }

  return {
    report: base,
    request: {
      task: FIX_SUGGEST_TASK,
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
export const FIX_SUGGEST_NO_MODEL_NOTE = "no model was called, so these suggestions are only what the trace records";

/**
 * The report `fix-suggest` prints when no model was asked for.
 *
 * The note is appended here rather than inside the deterministic report so that a report
 * built for a model call never claims no model was called, and so the CLI and the tests
 * cannot render two different no-model reports.
 */
export function withoutFixSuggestModel(draft: FixSuggestDraft): FixSuggestWithModel {
  return { ...draft.report, unverified: [...draft.report.unverified, FIX_SUGGEST_NO_MODEL_NOTE] };
}

/**
 * Folds one model attempt into the draft.
 *
 * A failed attempt keeps the deterministic suggestions and records the failure in the
 * `model` section with a non-zero exit code: the model's failure is never presented as a
 * review of the directions, and the directions themselves are not thrown away either.
 */
export function withFixSuggestModelResult(
  base: FixSuggestWithModel,
  result: ModelResult,
): FixSuggestWithModel {
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
export function withFixSuggestSkippedModel(
  base: FixSuggestWithModel,
  reason: string,
  provider: string,
  model: string,
): FixSuggestWithModel {
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
