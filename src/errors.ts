import { asRecord, asText, bumpCount, distribution, payloadOf, readRunOutcome } from "./analyze.js";
import type { Distribution, RunStatus } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";

/**
 * Failure aggregation of one validated trace.
 *
 * `summary` answers how the run went and `tools` answers which tool misbehaved;
 * neither answers "what went wrong, how often, and on which line". This does. Like the
 * analyzer and the diff it is a pure function over loaded events: no clock, no file
 * system, no network, so the same file always produces the same bytes.
 */

/**
 * Event types whose payload carries a structured `error`. `run.cancelled` is absent on
 * purpose: it records a `reason`, not an error, so a run an operator stopped is not a
 * run that failed, and counting it as one would put a cancellation in the same list as
 * a crash.
 */
const ERROR_EVENT_TYPES = new Set(["error.recorded", "tool.call.failed", "model.response.failed", "run.failed"]);

/**
 * Bucket for a failure event whose payload carries no error class. The bundled schema
 * requires `error.type` on all four event types, so this only happens when a laxer
 * schema was passed with `--schema`. The event still has to be counted somewhere:
 * dropping it would make the totals silently disagree with the file.
 */
export const UNKNOWN_ERROR = "(unnamed)";

/** One failure, exactly as the recorder wrote it. */
export interface ErrorOccurrence {
  line: number;
  event_id: string;
  /** The event type that carried the error, not the error class itself. */
  event: string;
  /** `error.type`, the stable error class. */
  type: string;
  /** `error.message`, the human-readable text. Empty when the recorder wrote none. */
  message: string;
  /** `error.recorded.fatal`. Null on event types that have no such field. */
  fatal: boolean | null;
  /** `tool.call.failed.guardrail_refusal`. Null on event types that have no such field. */
  guardrail_refusal: boolean | null;
  /** `error.recorded.related_event_id`, null when the recorder wrote none. */
  related_event_id: string | null;
  /** `tool.call.failed.tool`, null on event types that name no tool. */
  tool: string | null;
  /** `model.response.failed.model`, null on event types that name no model. */
  model: string | null;
}

/** Every occurrence of one error class. */
export interface ErrorClassRow {
  type: string;
  count: number;
  /** How many of these were recorded as fatal. */
  fatal: number;
  /** How many of these were guardrail refusals. */
  refusals: number;
  /** Event types that produced this class, most frequent first. */
  sources: Distribution[];
  first_line: number | null;
  last_line: number | null;
  first_event_id: string | null;
  last_event_id: string | null;
}

/** A `related_event_id` that points at an event the file does not carry. */
export interface DanglingReference {
  line: number;
  event_id: string;
  /** The id the event points at, which no event in the file claims. */
  referenced: string;
}

export interface ErrorsReport {
  command: "errors";
  file: string;
  schema: string;
  run_id: string | null;
  /** How the run ended, so "no errors" cannot be misread as an all-clear. */
  status: RunStatus;
  /** Events in the file, not the number of failures. */
  events: number;
  /**
   * Every failure event, `errors` and `refusals` together. Stated explicitly because
   * the two are reported apart, so a reader can reconcile the header against the class
   * table and the occurrence list, both of which total this number.
   */
  failures: number;
  /**
   * Failures that are not guardrail refusals. The schema says a refusal must not be
   * counted as a tool error, because the call was blocked on purpose rather than
   * breaking, so the two are kept apart here instead of being summed into one number
   * that would rank a designed block above a real crash.
   */
  errors: number;
  /** Guardrail refusals, reported apart from `errors` for the same reason. */
  refusals: number;
  fatal: number;
  classes: ErrorClassRow[];
  occurrences: ErrorOccurrence[];
  dangling_references: DanglingReference[];
}

interface ClassAccumulator {
  type: string;
  count: number;
  fatal: number;
  refusals: number;
  sources: Map<string, number>;
  firstLine: number | null;
  lastLine: number | null;
  firstEventId: string | null;
  lastEventId: string | null;
}

function classFor(rows: Map<string, ClassAccumulator>, type: string): ClassAccumulator {
  const existing = rows.get(type);
  if (existing !== undefined) {
    return existing;
  }
  const created: ClassAccumulator = {
    type,
    count: 0,
    fatal: 0,
    refusals: 0,
    sources: new Map(),
    firstLine: null,
    lastLine: null,
    firstEventId: null,
    lastEventId: null,
  };
  rows.set(type, created);
  return created;
}

function byCountThenType(left: ErrorClassRow, right: ErrorClassRow): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  return left.type < right.type ? -1 : left.type > right.type ? 1 : 0;
}

/**
 * Builds the `errors` report. Counters are plain tallies of event types, so a trace
 * that records the same failure twice counts twice; nothing is inferred or
 * de-duplicated. `sources` carries only the event types that actually produced the
 * class, and `tool` / `model` stay null on events that name neither, so no field is
 * ever given a value the recorder did not write.
 */
export function buildErrors(file: string, schemaLabel: string, events: LoadedEvent[]): ErrorsReport {
  // Read first, so a `related_event_id` can be checked against the whole file rather
  // than against the events that happened to precede it.
  const knownEventIds = new Set<string>();
  for (const { event } of events) {
    const id = asText(asRecord(event)?.event_id);
    if (id !== null) {
      knownEventIds.add(id);
    }
  }

  const classes = new Map<string, ClassAccumulator>();
  const occurrences: ErrorOccurrence[] = [];
  const danglingReferences: DanglingReference[] = [];
  let runId: string | null = null;
  let errors = 0;
  let refusals = 0;
  let fatal = 0;

  for (const { line, event } of events) {
    const record = asRecord(event);
    if (runId === null) {
      const id = asText(record?.run_id);
      if (id !== null) {
        runId = id;
      }
    }

    const eventType = asText(record?.type);
    if (eventType === null || !ERROR_EVENT_TYPES.has(eventType)) {
      continue;
    }

    const payload = payloadOf(event);
    const error = asRecord(payload.error);
    const errorType = asText(error?.type) ?? UNKNOWN_ERROR;
    const message = asText(error?.message) ?? "";
    const eventId = asText(record?.event_id) ?? "";
    // Only `tool.call.failed` carries the flag and only `error.recorded` carries `fatal`,
    // so both stay null elsewhere rather than being reported as false, which would read
    // as "the recorder said this was not fatal" when it said nothing of the kind.
    const refusal = eventType === "tool.call.failed" ? payload.guardrail_refusal === true : null;
    // `fatal` defaults to false when absent, per the schema, so it is a real boolean on
    // error.recorded and null on the event types that have no such field at all.
    const isFatal = eventType === "error.recorded" ? payload.fatal === true : null;
    const relatedEventId = eventType === "error.recorded" ? asText(payload.related_event_id) : null;
    const tool = eventType === "tool.call.failed" ? asText(payload.tool) : null;
    const model = asText(payload.model);

    if (refusal === true) {
      refusals += 1;
    } else {
      errors += 1;
    }
    if (isFatal === true) {
      fatal += 1;
    }
    if (relatedEventId !== null && !knownEventIds.has(relatedEventId)) {
      danglingReferences.push({ line, event_id: eventId, referenced: relatedEventId });
    }

    occurrences.push({
      line,
      event_id: eventId,
      event: eventType,
      type: errorType,
      message,
      fatal: isFatal,
      guardrail_refusal: refusal,
      related_event_id: relatedEventId,
      tool,
      model,
    });

    const row = classFor(classes, errorType);
    row.count += 1;
    if (isFatal === true) {
      row.fatal += 1;
    }
    if (refusal === true) {
      row.refusals += 1;
    }
    bumpCount(row.sources, eventType);
    row.lastLine = line;
    row.lastEventId = eventId;
    if (row.firstLine === null) {
      row.firstLine = line;
      row.firstEventId = eventId;
    }
  }

  return {
    command: "errors",
    file,
    schema: schemaLabel,
    run_id: runId,
    status: readRunOutcome(events).status,
    events: events.length,
    failures: occurrences.length,
    errors,
    refusals,
    fatal,
    classes: Array.from(classes.values())
      .map((row) => ({
        type: row.type,
        count: row.count,
        fatal: row.fatal,
        refusals: row.refusals,
        sources: distribution(row.sources),
        first_line: row.firstLine,
        last_line: row.lastLine,
        first_event_id: row.firstEventId,
        last_event_id: row.lastEventId,
      }))
      .sort(byCountThenType),
    occurrences,
    dangling_references: danglingReferences,
  };
}
