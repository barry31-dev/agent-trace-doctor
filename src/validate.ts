import type { ErrorObject, ValidateFunction } from "ajv";
import { ajvErrorPath } from "./schema.js";
import type { LoadedEvent } from "./loader.js";

export interface ReportError {
  /** 1-based line in the trace file, or null when the failure is not tied to a line. */
  line: number | null;
  event_id: string | null;
  /** "schema", one invariant name, "load" for an unreadable input or "write" for undeliverable output. */
  check: string;
  /** JSON pointer inside the event; empty for load failures. */
  path: string;
  keyword: string | null;
  message: string;
}

export interface ValidationReport {
  /** The command the report belongs to. `summary` and `timeline` reuse this shape. */
  command: string;
  file: string;
  schema: string;
  events: number;
  valid: boolean;
  errors: ReportError[];
}

function eventIdOf(event: unknown): string | null {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return null;
  }
  const value = (event as Record<string, unknown>).event_id;
  return typeof value === "string" ? value : null;
}

function schemaErrorsFor(loaded: LoadedEvent, errors: ErrorObject[]): ReportError[] {
  const eventId = eventIdOf(loaded.event);
  return errors
    // A failed if/then branch is reported twice: once for each member it rejects and
    // once as the umbrella "must match \"then\" schema". Only the members are useful.
    .filter((error) => error.keyword !== "if")
    .map((error) => ({
      line: loaded.line,
      event_id: eventId,
      check: "schema",
      path: ajvErrorPath(error),
      keyword: error.keyword,
      message: error.message ?? "is not valid",
    }));
}

/**
 * Cross-line rules a single-event schema cannot express. Each one is reported once per
 * offending line, so a long file cannot produce an unbounded wall of duplicates.
 */
function invariantErrors(events: LoadedEvent[]): ReportError[] {
  const errors: ReportError[] = [];
  const firstLineByEventId = new Map<string, number>();
  const reportedRunIds = new Set<string>();
  let firstRunId: string | null = null;
  let firstRunIdLine = 0;
  let previousTimestamp: { line: number; ms: number } | null = null;

  for (const { line, event } of events) {
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      continue;
    }
    const record = event as Record<string, unknown>;
    const eventId = eventIdOf(event);

    if (typeof record.event_id === "string") {
      const firstLine = firstLineByEventId.get(record.event_id);
      if (firstLine === undefined) {
        firstLineByEventId.set(record.event_id, line);
      } else {
        errors.push({
          line,
          event_id: eventId,
          check: "duplicate_event_id",
          path: "/event_id",
          keyword: null,
          message: `event_id "${record.event_id}" is already used on line ${firstLine}`,
        });
      }
    }

    if (typeof record.timestamp === "string") {
      const ms = Date.parse(record.timestamp);
      if (Number.isFinite(ms)) {
        if (previousTimestamp !== null && ms < previousTimestamp.ms) {
          errors.push({
            line,
            event_id: eventId,
            check: "timestamp_order",
            path: "/timestamp",
            keyword: null,
            message: `timestamp "${record.timestamp}" is earlier than the one on line ${previousTimestamp.line}`,
          });
        }
        previousTimestamp = { line, ms };
      }
    }

    if (typeof record.run_id === "string") {
      if (firstRunId === null) {
        firstRunId = record.run_id;
        firstRunIdLine = line;
      } else if (record.run_id !== firstRunId && !reportedRunIds.has(record.run_id)) {
        reportedRunIds.add(record.run_id);
        errors.push({
          line,
          event_id: eventId,
          check: "single_run_id",
          path: "/run_id",
          keyword: null,
          message: `run_id "${record.run_id}" differs from "${firstRunId}" on line ${firstRunIdLine}`,
        });
      }
    }
  }

  return errors;
}

/** Report for an input the tool could not read at all: no event was validated. */
export function reportForInputFailure(
  file: string,
  schemaLabel: string,
  message: string,
  command = "validate",
): ValidationReport {
  return {
    command,
    file,
    schema: schemaLabel,
    events: 0,
    valid: false,
    errors: [{ line: null, event_id: null, check: "load", path: "", keyword: null, message }],
  };
}

/**
 * Report for output that was produced and then could not be delivered. Separate from
 * `reportForInputFailure` because the two want different things done about them: the
 * trace was fine, the cases exist, and the problem is a directory, a permission or a
 * file that would have been replaced. A caller reading "input could not be read" would
 * go and look at the trace, which is not where the problem is.
 */
export function reportForWriteFailure(
  file: string,
  schemaLabel: string,
  message: string,
  command = "eval-gen",
): ValidationReport {
  return {
    command,
    file,
    schema: schemaLabel,
    events: 0,
    valid: false,
    errors: [{ line: null, event_id: null, check: "write", path: "", keyword: null, message }],
  };
}

/**
 * Validates every loaded event plus the cross-line invariants. Errors are sorted by
 * line, and Array.prototype.sort is stable, so equal lines keep schema-then-invariant
 * order and the report is byte-identical for identical input.
 */
export function validateEvents(
  file: string,
  schemaLabel: string,
  events: LoadedEvent[],
  validate: ValidateFunction,
  command = "validate",
): ValidationReport {
  const errors: ReportError[] = [];
  for (const loaded of events) {
    if (validate(loaded.event) !== true) {
      errors.push(...schemaErrorsFor(loaded, validate.errors ?? []));
    }
  }
  errors.push(...invariantErrors(events));
  errors.sort((left, right) => (left.line ?? 0) - (right.line ?? 0));
  return {
    command,
    file,
    schema: schemaLabel,
    events: events.length,
    valid: errors.length === 0,
    errors,
  };
}
