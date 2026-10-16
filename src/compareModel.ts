/**
 * The model half of `compare`.
 *
 * Everything here is a pure function over loaded events and an already-built
 * deterministic `CompareReport`: no clock, no file system, no network. It restates
 * what moved between two failure profiles as side-anchored observations and builds
 * the minimal excerpt a model may be shown, the same way `explain.ts` does for one
 * trace. The model layer only ever receives what this module produces.
 *
 * The evidence convention is the one thing this module adds to the model layer's
 * vocabulary: both traces may carry the same event id, so a finding cites
 * `a:EVENT_ID` or `b:EVENT_ID` rather than a bare id. `knownEventIds` is built in
 * that form, which is what makes a bare id fail as evidence instead of being bound to
 * whichever file a reader guessed.
 */

import { asRecord, asText, readRunOutcome } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";
import type { CompareReport, ErrorClassComparison, ToolComparison } from "./compare.js";
import type {
  CompareEventExcerpt,
  CompareObservation,
  CompareRequest,
  CompareSide,
  ModelFinding,
  ModelResult,
} from "./model/types.js";
import { ANSWER_CONTRACT, COMPARE_TASK } from "./model/contract.js";
import { redactPayload } from "./model/redact.js";

/** Section of the report describing the model call, whether or not one happened. */
export interface CompareModelSection {
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
   * Why no request was made when `--model` was asked for: there was nothing anchored
   * to ask about. Null whenever a request was made. A skipped call is not a failure,
   * because nothing was attempted.
   */
  skipped: string | null;
  /** Gaps the model itself declared. Kept apart from the deterministic ones. */
  unverified: string[];
  error: { kind: string; message: string } | null;
}

/** The deterministic report plus the model half, as `compare` reports it. */
export interface CompareWithModel extends CompareReport {
  findings: ModelFinding[];
  /** What this comparison does not establish. Deterministic, never model-written. */
  unverified: string[];
  model: CompareModelSection;
}

/** A report ready to render, plus the request that would be sent if a model were asked. */
export interface CompareDraft {
  report: CompareWithModel;
  /** Null when there was nothing anchored to ask about. */
  request: CompareRequest | null;
  skipReason: string | null;
  /** Side-qualified ids of every event in either file, so a finding may cite any of them. */
  knownEventIds: ReadonlySet<string>;
}

/** What an observation is about. Each kind restates a row of the tables above it. */
export type CompareObservationKind = "status_change" | "error_class" | "tool_failure";

/** One side's share of a moved row, stated on its own. */
interface SideStatement {
  kind: CompareObservationKind;
  side: CompareSide;
  event_id: string | null;
  line: number | null;
  statement: string;
}

/** Where one side's first occurrence sits, as a reference a reader can open. */
function anchorOf(side: CompareSide, eventId: string | null, line: number | null): string {
  if (eventId === null || line === null) {
    return "no event recorded";
  }
  return `line ${line}, ${side}:${eventId}`;
}

/** The last terminal event of one trace, with the line it sits on, so it can be cited. */
function terminalEvent(events: LoadedEvent[]): { event_id: string | null; line: number | null } {
  const eventId = readRunOutcome(events).terminal_event_id;
  if (eventId === null) {
    return { event_id: null, line: null };
  }
  for (const { line, event } of events) {
    const record = asRecord(event);
    if (record !== null && asText(record.event_id) === eventId) {
      return { event_id: eventId, line };
    }
  }
  return { event_id: eventId, line: null };
}

/**
 * One observation per side of the status change.
 *
 * Not one observation about the pair: a status change has two terminal events, and a
 * single observation anchored to neither would leave the model with nothing it is
 * allowed to cite while the contract still demands at least one citation.
 */
function statusStatements(report: CompareReport, terminalA: { event_id: string | null; line: number | null }, terminalB: { event_id: string | null; line: number | null }): SideStatement[] {
  if (!report.status_changed) {
    return [];
  }
  const statements: SideStatement[] = [];
  for (const side of ["a", "b"] as const) {
    const run = side === "a" ? report.runs.a : report.runs.b;
    const other = side === "a" ? report.runs.b : report.runs.a;
    const terminal = side === "a" ? terminalA : terminalB;
    statements.push({
      kind: "status_change",
      side,
      event_id: terminal.event_id,
      line: terminal.line,
      statement: `the run ended as ${run.status} (${run.run_id ?? "no run id"}), while the other trace ended as ${other.status}`,
    });
  }
  return statements;
}

/** Both sides of one error-class row, each anchored to that side's first occurrence. */
function classStatements(row: ErrorClassComparison): SideStatement[] {
  const shape = `error class ${row.type} is ${row.verdict}: ${row.a?.count ?? 0} in a, ${row.b?.count ?? 0} in b`;
  const statements: SideStatement[] = [];
  for (const side of ["a", "b"] as const) {
    const sideData = side === "a" ? row.a : row.b;
    if (sideData === null) {
      continue;
    }
    statements.push({
      kind: "error_class",
      side,
      event_id: sideData.first_event_id,
      line: sideData.first_line,
      statement: `${shape}; first occurrence in ${side} at ${anchorOf(side, sideData.first_event_id, sideData.first_line)}`,
    });
  }
  return statements;
}

/** Both sides of one failing-tool row, each anchored to that side's first call. */
function toolStatements(row: ToolComparison): SideStatement[] {
  const shape =
    `tool ${row.tool} failures are ${row.verdict}: ` +
    `${row.failed_a} of ${row.calls_a} calls failed in a, ${row.failed_b} of ${row.calls_b} in b`;
  const statements: SideStatement[] = [];
  for (const side of ["a", "b"] as const) {
    const line = side === "a" ? row.first_line_a : row.first_line_b;
    const eventId = side === "a" ? row.first_event_id_a : row.first_event_id_b;
    // A tool the other trace never called has no event there, and an observation with
    // no anchor is one the model may not cite, so that side is left out rather than
    // stated without evidence.
    if (eventId === null) {
      continue;
    }
    statements.push({
      kind: "tool_failure",
      side,
      event_id: eventId,
      line,
      statement: `${shape}; first call in ${side} at ${anchorOf(side, eventId, line)}`,
    });
  }
  return statements;
}

/**
 * Restates what moved as side-anchored observations.
 *
 * Only rows whose verdict is not `unchanged` are restated: the question `compare`
 * answers is what moved, and a model asked about a row that did not move has nothing
 * to add to the tables above it. Every observation names exactly one file and, where
 * that side has one, exactly one event, so each of them can be cited.
 */
function buildCompareObservations(
  report: CompareReport,
  terminalA: { event_id: string | null; line: number | null },
  terminalB: { event_id: string | null; line: number | null },
): CompareObservation[] {
  // Only rows that moved. The tables above already list the ones that did not, and a
  // model asked about an unchanged row has nothing to add to them.
  const movedClasses = report.classes.filter((row) => row.verdict !== "unchanged");
  const movedTools = report.tools.filter((row) => row.verdict !== "unchanged");
  const statements: SideStatement[] = [
    ...statusStatements(report, terminalA, terminalB),
    ...movedClasses.flatMap(classStatements),
    ...movedTools.flatMap(toolStatements),
  ];
  return statements.map((statement, index) => ({
    id: `obs_${index + 1}`,
    kind: statement.kind,
    side: statement.side,
    event_id: statement.event_id,
    line: statement.line,
    statement: statement.statement,
  }));
}

/**
 * Quotes the events the observations cite, one entry per side per event.
 *
 * Past `maxEvents` the rest are named in `omitted` instead of quoted, and the caller
 * reports that: an event that was named but not quoted is still evidence a reader can
 * open, it just was not sent anywhere.
 *
 * Each payload is passed through `redactPayload` before it is quoted, and the number of
 * values that replaced is returned as `redacted`, so both sides are held to the same
 * boundary and the count covers both files.
 */
function buildCompareExcerpt(
  eventsA: LoadedEvent[],
  eventsB: LoadedEvent[],
  observations: CompareObservation[],
  maxEvents: number,
): { excerpt: CompareEventExcerpt[]; omitted: string[]; redacted: number } {
  const wanted = new Set<string>();
  for (const observation of observations) {
    if (observation.side !== null && observation.event_id !== null) {
      wanted.add(`${observation.side}:${observation.event_id}`);
    }
  }
  const excerpt: CompareEventExcerpt[] = [];
  const omitted: string[] = [];
  let redacted = 0;
  for (const [side, events] of [
    ["a", eventsA],
    ["b", eventsB],
  ] as const) {
    for (const { line, event } of events) {
      const record = asRecord(event);
      const eventId = record === null ? null : asText(record.event_id);
      if (eventId === null || !wanted.has(`${side}:${eventId}`)) {
        continue;
      }
      if (excerpt.length >= maxEvents) {
        omitted.push(`${side}:${eventId}`);
        continue;
      }
      const withheld = redactPayload(asRecord(record?.payload) ?? {});
      redacted += withheld.redacted;
      excerpt.push({
        side,
        event_id: eventId,
        line,
        type: record === null ? "unknown" : asText(record.type) ?? "unknown",
        payload: withheld.payload,
      });
    }
  }
  return { excerpt, omitted, redacted };
}

/** Side-qualified evidence ids of every event in either file. */
function knownEventIdsOf(eventsA: LoadedEvent[], eventsB: LoadedEvent[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [side, events] of [
    ["a", eventsA],
    ["b", eventsB],
  ] as const) {
    for (const { event } of events) {
      const record = asRecord(event);
      const eventId = record === null ? null : asText(record.event_id);
      if (eventId !== null) {
        ids.add(`${side}:${eventId}`);
      }
    }
  }
  return ids;
}

/**
 * What the comparison does not establish, stated without a model.
 *
 * A comparison of two failure profiles says what moved. It does not say why, and it
 * says nothing about the steps that did not fail, so both are listed rather than left
 * for a reader to assume.
 */
function deterministicUnverified(report: CompareReport, omitted: string[], maxExcerptEvents: number): string[] {
  const notes: string[] = [];
  // Read off the verdicts rather than the row count: a class that occurred in both
  // traces and did not move is still a row, and saying "nothing moved" about a pair
  // whose tables are full of unchanged rows is the statement a reader needs.
  const anyMoved =
    report.classes.some((row) => row.verdict !== "unchanged") || report.tools.some((row) => row.verdict !== "unchanged");
  for (const side of ["a", "b"] as const) {
    if (report.runs[side].status === "incomplete") {
      notes.push(`trace ${side} has no terminal event, so how that run ended is not recorded`);
    }
  }
  if (report.runs.a.failures === 0 && report.runs.b.failures === 0) {
    notes.push("neither trace records a failure, so there is no failure profile to explain");
  } else if (report.identical) {
    notes.push("the two failure profiles are identical, so there is no difference for a model to read");
  } else if (!anyMoved) {
    notes.push("only the run status moved; no error class and no failing tool moved, so the traces record no failure to compare");
  } else {
    notes.push("the comparison does not establish why a class or a tool moved, only that it did");
  }
  notes.push(
    "events that did not fail are not part of this comparison, so a difference between two successful runs is not reported here",
  );
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
 * and testable without a provider, and so `compare` without `--model` is a complete
 * answer rather than a stub. The request is null when no observation is anchored to an
 * event: two traces whose failure profiles are identical have no difference to read,
 * and asking a model to explain one would invite it to invent evidence.
 */
export function buildCompareDraft(
  report: CompareReport,
  eventsA: LoadedEvent[],
  eventsB: LoadedEvent[],
  options: { maxExcerptEvents: number; sendPaths: boolean },
): CompareDraft {
  const terminalA = terminalEvent(eventsA);
  const terminalB = terminalEvent(eventsB);
  const observations = buildCompareObservations(report, terminalA, terminalB);
  const { excerpt, omitted, redacted } = buildCompareExcerpt(eventsA, eventsB, observations, options.maxExcerptEvents);

  const base: CompareWithModel = {
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

  const anchored = observations.filter((observation) => observation.event_id !== null).length;
  const knownEventIds = knownEventIdsOf(eventsA, eventsB);
  if (anchored === 0) {
    return {
      report: base,
      request: null,
      skipReason:
        "no observation is anchored to an event, so a model was given nothing it could cite; run explain --model on either trace to ask about that trace's failures",
      knownEventIds,
    };
  }

  return {
    report: base,
    request: {
      task: COMPARE_TASK,
      output_contract: ANSWER_CONTRACT,
      observations,
      events: excerpt,
      file_a: options.sendPaths ? report.files.a : null,
      file_b: options.sendPaths ? report.files.b : null,
      redacted_fields: redacted,
    },
    skipReason: null,
    knownEventIds,
  };
}

/**
 * Reported when no model was asked, so the reader knows nothing here is interpretation.
 * Named apart from `explain`'s note because it names two traces rather than one.
 */
export const COMPARE_NO_MODEL_NOTE = "no model was called, so this report only restates what the two traces record";

/**
 * The report `compare` prints when no model was asked for.
 *
 * The note is appended here rather than inside the draft so that a report built for a
 * model call never claims no model was called, and so the CLI and the tests cannot
 * render two different no-model reports.
 */
export function withoutModel(draft: CompareDraft): CompareWithModel {
  return { ...draft.report, unverified: [...draft.report.unverified, COMPARE_NO_MODEL_NOTE] };
}

/**
 * Folds one model attempt into the draft.
 *
 * A failed attempt keeps the deterministic report and records the failure in the
 * `model` section with a non-zero exit code: the model's failure is never presented
 * as a comparison result, and the deterministic half is not thrown away either.
 */
export function withCompareModelResult(base: CompareWithModel, result: ModelResult): CompareWithModel {
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
export function withSkippedModel(
  base: CompareWithModel,
  reason: string,
  provider: string,
  model: string,
): CompareWithModel {
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
