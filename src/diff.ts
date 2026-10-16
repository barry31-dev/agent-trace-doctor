import type { LoadedEvent } from "./loader.js";
import { asRecord, asText, summarize } from "./analyze.js";
import type { SummaryReport } from "./analyze.js";

/**
 * Deterministic comparison of two validated traces. The tool reports structural
 * differences only: it never decides that two different events "mean the same thing",
 * so a rewritten step shows up as the events it actually is, added and removed rather
 * than quietly merged. Like the analyzer, nothing here touches the network, the clock
 * or the file system.
 */

export type DiffChangeKind = "run" | "summary" | "event_added" | "event_removed" | "event_changed";

export interface DiffFieldChange {
  /** JSON pointer into the compared content, e.g. `/payload/usage/input_tokens`. */
  path: string;
  /** Value in the first trace; `null` when the field is absent there. */
  a: unknown;
  /** Value in the second trace; `null` when the field is absent there. */
  b: unknown;
}

export interface DiffChange {
  kind: DiffChangeKind;
  /** Compared field name for `run` and `summary` changes; `null` for event changes. */
  field: string | null;
  /** Event id when the change is tied to one event; `null` otherwise. */
  event_id: string | null;
  /** Event type in the first trace, or in the second for events only present there. */
  type: string | null;
  /** 1-based line in the first trace; `null` when the entry is not in it. */
  line_a: number | null;
  /** 1-based line in the second trace; `null` when the entry is not in it. */
  line_b: number | null;
  /** Value in the first trace, for `run` and `summary` changes; `null` otherwise. */
  a: unknown;
  /** Value in the second trace, for `run` and `summary` changes; `null` otherwise. */
  b: unknown;
  /** Leaf-level differences, for `event_changed` only; empty for every other kind. */
  fields: DiffFieldChange[];
}

export interface DiffReport {
  command: "diff";
  schema: string;
  files: { a: string; b: string };
  events: { a: number; b: number };
  identical: boolean;
  changes: DiffChange[];
}

/**
 * Summary fields the diff compares, in report order. `command`, `file` and `schema`
 * describe the report itself rather than the trace, and `started_at` / `ended_at` are
 * wall-clock instants that differ between any two runs; `duration_ms` carries the
 * timing signal instead. `run_id` is compared separately, as the run identity.
 */
const COMPARED_SUMMARY_FIELDS: readonly (readonly [string, (summary: SummaryReport) => unknown])[] = [
  ["status", (summary) => summary.status],
  ["terminal_event_id", (summary) => summary.terminal_event_id],
  ["duration_ms", (summary) => summary.duration_ms],
  ["events", (summary) => summary.events],
  ["models", (summary) => summary.models],
  ["model_requests", (summary) => summary.model_requests],
  ["model_responses_completed", (summary) => summary.model_responses_completed],
  ["model_responses_failed", (summary) => summary.model_responses_failed],
  ["tool_calls", (summary) => summary.tool_calls],
  ["tool_calls_completed", (summary) => summary.tool_calls_completed],
  ["tool_calls_failed", (summary) => summary.tool_calls_failed],
  ["tool_guardrail_refusals", (summary) => summary.tool_guardrail_refusals],
  ["permissions_requested", (summary) => summary.permissions_requested],
  ["permissions_approved", (summary) => summary.permissions_approved],
  ["permissions_denied", (summary) => summary.permissions_denied],
  ["context_compactions", (summary) => summary.context_compactions],
  ["errors_recorded", (summary) => summary.errors_recorded],
  ["errors_fatal", (summary) => summary.errors_fatal],
  ["tokens.input", (summary) => summary.tokens.input],
  ["tokens.output", (summary) => summary.tokens.output],
  ["tokens.cache_read", (summary) => summary.tokens.cache_read],
  ["tokens.cache_write", (summary) => summary.tokens.cache_write],
  ["tokens.reasoning", (summary) => summary.tokens.reasoning],
];

/**
 * Canonical text for one value: object keys are sorted, so two values that differ only
 * in key order compare equal. Arrays keep their order, because reordering a list is a
 * difference the tool reports rather than smooths over.
 */
function canonical(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function pointerSegment(segment: string): string {
  return `/${segment.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

/**
 * Walks two compared values and records every leaf that differs. Objects are walked
 * key by key over the union of their keys, so a field that exists on one side only is
 * reported with `null` on the other. Everything else (primitives, arrays) compares as
 * one whole value. The schema declares no nullable fields, so a recorded `null` and an
 * absent field are reported the same way.
 */
function collectFieldChanges(path: string, left: unknown, right: unknown, out: DiffFieldChange[]): void {
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (leftRecord !== null && rightRecord !== null) {
    const keys = Array.from(new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])).sort();
    for (const key of keys) {
      collectFieldChanges(`${path}${pointerSegment(key)}`, leftRecord[key], rightRecord[key], out);
    }
    return;
  }
  if (canonical(left) !== canonical(right)) {
    out.push({ path, a: left ?? null, b: right ?? null });
  }
}

/**
 * The part of an event the diff compares: the type and the payload. `schema_version`
 * is a constant, `event_id` is the alignment key, and `timestamp` and `run_id` are
 * run-specific, so none of them can produce a meaningful per-event difference. The
 * run identity is reported once, at the run level.
 */
function projection(event: unknown): Record<string, unknown> {
  const record = asRecord(event) ?? {};
  return { type: asText(record.type) ?? "unknown", payload: asRecord(record.payload) ?? {} };
}

function eventType(event: unknown): string {
  return asText(asRecord(event)?.type) ?? "unknown";
}

function indexById(events: LoadedEvent[]): Map<string, LoadedEvent> {
  const index = new Map<string, LoadedEvent>();
  for (const loaded of events) {
    const eventId = asText(asRecord(loaded.event)?.event_id);
    // Validation rejects duplicate ids, so the first occurrence is the only one; the
    // guard keeps a hand-built input deterministic all the same.
    if (eventId !== null && !index.has(eventId)) {
      index.set(eventId, loaded);
    }
  }
  return index;
}

function valueChange(kind: "run" | "summary", field: string, a: unknown, b: unknown): DiffChange {
  return {
    kind,
    field,
    event_id: null,
    type: null,
    line_a: null,
    line_b: null,
    a,
    b,
    fields: [],
  };
}

/**
 * Compares two validated traces. Both sides must have passed `validateEvents` first:
 * the caller relies on that for unique event ids, non-decreasing timestamps and one
 * run id per file, none of which this function re-checks.
 */
export function diffTraces(
  fileA: string,
  fileB: string,
  schemaLabel: string,
  eventsA: LoadedEvent[],
  eventsB: LoadedEvent[],
): DiffReport {
  const summaryA = summarize(fileA, schemaLabel, eventsA);
  const summaryB = summarize(fileB, schemaLabel, eventsB);
  const changes: DiffChange[] = [];

  if (canonical(summaryA.run_id) !== canonical(summaryB.run_id)) {
    changes.push(valueChange("run", "run_id", summaryA.run_id, summaryB.run_id));
  }
  for (const [field, read] of COMPARED_SUMMARY_FIELDS) {
    const a = read(summaryA);
    const b = read(summaryB);
    if (canonical(a) !== canonical(b)) {
      changes.push(valueChange("summary", field, a, b));
    }
  }

  const byIdA = indexById(eventsA);
  const byIdB = indexById(eventsB);
  // Event ids are zero-padded and fixed-length, so lexicographic order is numeric
  // order and the report lists events the way a reader counts them.
  const eventIds = Array.from(new Set([...byIdA.keys(), ...byIdB.keys()])).sort();
  for (const eventId of eventIds) {
    const left = byIdA.get(eventId);
    const right = byIdB.get(eventId);
    if (left === undefined) {
      if (right === undefined) {
        continue;
      }
      changes.push({
        kind: "event_added",
        field: null,
        event_id: eventId,
        type: eventType(right.event),
        line_a: null,
        line_b: right.line,
        a: null,
        b: null,
        fields: [],
      });
      continue;
    }
    if (right === undefined) {
      changes.push({
        kind: "event_removed",
        field: null,
        event_id: eventId,
        type: eventType(left.event),
        line_a: left.line,
        line_b: null,
        a: null,
        b: null,
        fields: [],
      });
      continue;
    }
    const fields: DiffFieldChange[] = [];
    collectFieldChanges("", projection(left.event), projection(right.event), fields);
    if (fields.length > 0) {
      changes.push({
        kind: "event_changed",
        field: null,
        event_id: eventId,
        type: eventType(left.event),
        line_a: left.line,
        line_b: right.line,
        a: null,
        b: null,
        fields,
      });
    }
  }

  return {
    command: "diff",
    schema: schemaLabel,
    files: { a: fileA, b: fileB },
    events: { a: eventsA.length, b: eventsB.length },
    identical: changes.length === 0,
    changes,
  };
}
