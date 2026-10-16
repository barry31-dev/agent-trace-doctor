import type { LoadedEvent } from "./loader.js";

/**
 * Deterministic analysis of a validated trace. Nothing here touches the network, the
 * clock or the file system: the same events always produce the same report, which is
 * what makes the output comparable between two runs and safe to paste into an issue.
 */

type EventRecord = Record<string, unknown>;

// Exported because the diff compares the same event shape as the analyzer reads.

export function asRecord(value: unknown): EventRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as EventRecord) : null;
}

export function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asInstant(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function payloadOf(event: unknown): EventRecord {
  return asRecord(asRecord(event)?.payload) ?? {};
}

/** One value of one distribution and how often it occurred. */
export interface Distribution {
  value: string;
  count: number;
}

export function bumpCount(counts: Map<string, number>, value: string): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

/**
 * Order by count descending, then by value, so the dominant entry comes first and two
 * runs with the same counts still print in the same order. Plain comparison rather
 * than `localeCompare`, which would make the order depend on the machine's locale.
 */
export function byCountThenValue(left: Distribution, right: Distribution): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
}

/** Turns a tally into a distribution, ordered so the same input always prints the same. */
export function distribution(counts: Map<string, number>): Distribution[] {
  return Array.from(counts, ([value, count]) => ({ value, count })).sort(byCountThenValue);
}

function field(event: unknown, name: string): unknown {
  return asRecord(event)?.[name];
}

function sentence(head: string, details: (string | null)[]): string {
  const body = clause(details);
  return body === null ? head : `${head}: ${body}`;
}

function clause(details: (string | null)[]): string | null {
  const kept = details.filter((item): item is string => item !== null && item.length > 0);
  return kept.length === 0 ? null : kept.join("; ");
}

function detail(value: unknown, suffix: string): string | null {
  const count = asCount(value);
  return count === null ? null : `${count} ${suffix}`;
}

function errorText(value: unknown): string {
  const error = asRecord(value);
  if (error === null) {
    return "unknown error";
  }
  const type = asText(error.type);
  const message = asText(error.message);
  if (type !== null && message !== null && message.length > 0) {
    return `${type}: ${message}`;
  }
  return type ?? message ?? "unknown error";
}

/**
 * Renders the effect disposition of a completed tool call. Absent stays absent: a
 * recorder that did not classify its tools should not be given a default that reads
 * like a claim.
 */
function effectText(value: unknown): string | null {
  const effect = asText(value);
  return effect === null ? null : `effect ${effect}`;
}

/**
 * One line describing one event. Every payload field is optional in the schema, so
 * each part is emitted only when the recorder actually wrote it; a missing field
 * never turns into "undefined" or "null" in the text.
 */
export function describeEvent(event: unknown): string {
  const type = asText(field(event, "type")) ?? "unknown";
  const payload = payloadOf(event);
  switch (type) {
    case "run.started":
      return sentence("run started", [asText(payload.input_summary)]);
    case "run.finished":
      return sentence("run finished", [asText(payload.status), asText(payload.output_summary)]);
    case "run.failed":
      return sentence("run failed", [asText(payload.status), errorText(payload.error)]);
    case "run.cancelled":
      return sentence("run cancelled", [asText(payload.status), asText(payload.reason)]);
    case "model.request.started":
      return sentence("model request", [asText(payload.model), detail(payload.messages, "messages")]);
    case "model.response.completed": {
      const usage = asRecord(payload.usage);
      const tokens =
        usage === null
          ? null
          : clause([
              `${asCount(usage.input_tokens) ?? 0} input / ${asCount(usage.output_tokens) ?? 0} output tokens`,
              detail(usage.cache_read_tokens, "cache read"),
              detail(usage.cache_write_tokens, "cache write"),
              detail(usage.reasoning_tokens, "reasoning"),
            ]);
      return sentence("model response", [
        asText(payload.model),
        detail(payload.duration_ms, "ms"),
        tokens,
        asText(payload.finish_reason),
      ]);
    }
    case "model.response.failed":
      return sentence("model response failed", [
        asText(payload.model),
        detail(payload.duration_ms, "ms"),
        errorText(payload.error),
      ]);
    case "tool.call.started":
      return sentence("tool call", [
        asText(payload.tool),
        asText(payload.tool_call_id),
        asText(payload.args_summary),
      ]);
    case "tool.call.completed":
      return sentence("tool result", [
        asText(payload.tool),
        detail(payload.duration_ms, "ms"),
        detail(payload.result_bytes, "bytes"),
        payload.result_truncated === true ? "truncated" : null,
        effectText(payload.effect_disposition),
      ]);
    case "tool.call.failed":
      return sentence("tool failed", [
        asText(payload.tool),
        detail(payload.duration_ms, "ms"),
        asText(payload.guard) === null ? null : `guard ${asText(payload.guard)}`,
        payload.guardrail_refusal === true ? "guardrail refusal" : null,
        errorText(payload.error),
      ]);
    case "permission.requested":
      return sentence("permission requested", [
        asText(payload.action),
        asText(payload.resource),
        asText(payload.tool) === null ? null : `tool ${asText(payload.tool)}`,
      ]);
    case "permission.resolved":
      return sentence("permission resolved", [
        asText(payload.decision),
        asText(payload.decided_by) === null ? null : `by ${asText(payload.decided_by)}`,
      ]);
    case "context.compacted": {
      const beforeTokens = asCount(payload.before_tokens);
      const afterTokens = asCount(payload.after_tokens);
      const beforeMessages = asCount(payload.before_messages);
      const afterMessages = asCount(payload.after_messages);
      return sentence("context compacted", [
        asText(payload.strategy),
        beforeTokens === null || afterTokens === null ? null : `${beforeTokens} to ${afterTokens} tokens`,
        beforeMessages === null || afterMessages === null ? null : `${beforeMessages} to ${afterMessages} messages`,
      ]);
    }
    case "error.recorded":
      return sentence("error recorded", [
        errorText(payload.error),
        payload.fatal === true ? "fatal" : null,
        asText(payload.related_event_id) === null ? null : `related ${asText(payload.related_event_id)}`,
      ]);
    default:
      return sentence(type, []);
  }
}

/** Run status as the last terminal event recorded it. */
export type RunStatus = "completed" | "failed" | "cancelled" | "incomplete";

export interface TokenTotals {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
}

export interface SummaryReport {
  command: "summary";
  file: string;
  schema: string;
  run_id: string | null;
  status: RunStatus;
  terminal_event_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  events: number;
  models: string[];
  model_requests: number;
  model_responses_completed: number;
  model_responses_failed: number;
  tool_calls: number;
  tool_calls_completed: number;
  tool_calls_failed: number;
  tool_guardrail_refusals: number;
  permissions_requested: number;
  permissions_approved: number;
  permissions_denied: number;
  context_compactions: number;
  errors_recorded: number;
  errors_fatal: number;
  tokens: TokenTotals;
}

const TERMINAL_STATUS: Record<string, RunStatus> = {
  "run.finished": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
};

/**
 * Run status as the last terminal event recorded it, plus that event's id. `errors`
 * needs the status to avoid answering "no errors" on a run that was cancelled rather
 * than finished, which would read like an all-clear.
 */
export function readRunOutcome(events: LoadedEvent[]): { status: RunStatus; terminal_event_id: string | null } {
  let status: RunStatus = "incomplete";
  let terminalEventId: string | null = null;
  for (const { event } of events) {
    const type = asText(field(event, "type"));
    if (type === null) {
      continue;
    }
    const recorded = TERMINAL_STATUS[type];
    if (recorded !== undefined) {
      status = recorded;
      terminalEventId = asText(field(event, "event_id"));
    }
  }
  return { status, terminal_event_id: terminalEventId };
}

function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
}

const USAGE_KEYS = ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"] as const;

function addUsage(totals: TokenTotals, payload: EventRecord): void {
  const usage = asRecord(payload.usage);
  if (usage === null) {
    return;
  }
  for (const key of USAGE_KEYS) {
    const value = asCount(usage[key]);
    if (value === null) {
      continue;
    }
    totals[key.replace("_tokens", "") as keyof TokenTotals] += value;
  }
}

/**
 * Aggregates one trace. Counters are plain tallies of event types, so a trace that
 * records the same thing twice counts twice; nothing is inferred or de-duplicated.
 * Token counters are the values the recorder reported, summed as-is: whether a cache
 * read already sits inside `input_tokens` is a provider question, not one this tool
 * answers.
 */
export function summarize(file: string, schemaLabel: string, events: LoadedEvent[]): SummaryReport {
  const tokens = emptyTokens();
  const models = new Set<string>();
  let runId: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let startedMs: number | null = null;
  let endedMs: number | null = null;
  let modelRequests = 0;
  let modelCompleted = 0;
  let modelFailed = 0;
  let toolCalls = 0;
  let toolCompleted = 0;
  let toolFailed = 0;
  let guardrailRefusals = 0;
  let permissionsRequested = 0;
  let permissionsApproved = 0;
  let permissionsDenied = 0;
  let compactions = 0;
  let errorsRecorded = 0;
  let errorsFatal = 0;

  const outcome = readRunOutcome(events);
  for (const { event } of events) {
    const type = asText(field(event, "type"));
    const payload = payloadOf(event);

    if (runId === null) {
      const id = asText(field(event, "run_id"));
      if (id !== null) {
        runId = id;
      }
    }

    const timestamp = asText(field(event, "timestamp"));
    const instant = asInstant(timestamp);
    if (instant !== null) {
      if (startedMs === null) {
        startedMs = instant;
        startedAt = timestamp;
      }
      endedMs = instant;
      endedAt = timestamp;
    }

    switch (type) {
      case "model.request.started":
        modelRequests += 1;
        break;
      case "model.response.completed":
        modelCompleted += 1;
        addUsage(tokens, payload);
        break;
      case "model.response.failed":
        modelFailed += 1;
        break;
      case "tool.call.started":
        toolCalls += 1;
        break;
      case "tool.call.completed":
        toolCompleted += 1;
        break;
      case "tool.call.failed":
        toolFailed += 1;
        if (payload.guardrail_refusal === true) {
          guardrailRefusals += 1;
        }
        break;
      case "permission.requested":
        permissionsRequested += 1;
        break;
      case "permission.resolved":
        if (payload.decision === "approved") {
          permissionsApproved += 1;
        } else if (payload.decision === "denied") {
          permissionsDenied += 1;
        }
        break;
      case "context.compacted":
        compactions += 1;
        break;
      case "error.recorded":
        errorsRecorded += 1;
        if (payload.fatal === true) {
          errorsFatal += 1;
        }
        break;
      default:
        break;
    }

    const model = asText(payload.model);
    if (model !== null && (type === "model.request.started" || type?.startsWith("model.response."))) {
      models.add(model);
    }
  }

  return {
    command: "summary",
    file,
    schema: schemaLabel,
    run_id: runId,
    status: outcome.status,
    terminal_event_id: outcome.terminal_event_id,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: startedMs !== null && endedMs !== null ? endedMs - startedMs : null,
    events: events.length,
    models: Array.from(models).sort(),
    model_requests: modelRequests,
    model_responses_completed: modelCompleted,
    model_responses_failed: modelFailed,
    tool_calls: toolCalls,
    tool_calls_completed: toolCompleted,
    tool_calls_failed: toolFailed,
    tool_guardrail_refusals: guardrailRefusals,
    permissions_requested: permissionsRequested,
    permissions_approved: permissionsApproved,
    permissions_denied: permissionsDenied,
    context_compactions: compactions,
    errors_recorded: errorsRecorded,
    errors_fatal: errorsFatal,
    tokens,
  };
}

export interface TimelineEntry {
  index: number;
  step: number;
  line: number;
  event_id: string;
  timestamp: string;
  offset_ms: number;
  duration_ms: number | null;
  type: string;
  summary: string;
}

export interface EventAnnotation {
  index: number;
  step: number;
  line: number;
  event_id: string;
  timestamp: string;
  offset_ms: number;
  duration_ms: number | null;
}

/**
 * The position facts every per-event report needs: where the event sits in the file,
 * which model round asked for it, how far into the run it happened and how long it
 * took. Shared by `timeline` and `show` so the two commands cannot disagree about
 * where an event is, which would make the same line number mean two things.
 */
export function annotateEvents(events: LoadedEvent[]): EventAnnotation[] {
  const rows: EventAnnotation[] = [];
  let step = 0;
  let firstMs: number | null = null;

  for (const { line, event } of events) {
    const type = asText(field(event, "type")) ?? "unknown";
    if (type === "model.request.started") {
      step += 1;
    }
    const timestamp = asText(field(event, "timestamp")) ?? "";
    const instant = asInstant(timestamp);
    if (firstMs === null && instant !== null) {
      firstMs = instant;
    }
    rows.push({
      index: rows.length + 1,
      step: Math.max(step, 1),
      line,
      event_id: asText(field(event, "event_id")) ?? "",
      timestamp,
      offset_ms: instant !== null && firstMs !== null ? instant - firstMs : 0,
      duration_ms: asCount(payloadOf(event).duration_ms),
    });
  }

  return rows;
}

export interface TimelineReport {
  command: "timeline";
  file: string;
  schema: string;
  run_id: string | null;
  steps: number;
  events: TimelineEntry[];
}

/**
 * One row per event, in file order. `step` counts model rounds: it advances on every
 * `model.request.started`, so the events between two model requests share a step and
 * a reader can see which round produced which tool call. `offset_ms` is relative to
 * the first event, the one wall-clock number a reader compares.
 */
export function buildTimeline(file: string, schemaLabel: string, events: LoadedEvent[]): TimelineReport {
  const annotations = annotateEvents(events);
  const rows: TimelineEntry[] = [];
  let runId: string | null = null;

  for (let position = 0; position < events.length; position += 1) {
    const annotation = annotations[position];
    const loaded = events[position];
    if (annotation === undefined || loaded === undefined) {
      continue;
    }
    const { event } = loaded;
    if (runId === null) {
      const id = asText(field(event, "run_id"));
      if (id !== null) {
        runId = id;
      }
    }
    rows.push({
      ...annotation,
      type: asText(field(event, "type")) ?? "unknown",
      summary: describeEvent(event),
    });
  }

  return {
    command: "timeline",
    file,
    schema: schemaLabel,
    run_id: runId,
    steps: rows.reduce((highest, row) => Math.max(highest, row.step), 0),
    events: rows,
  };
}
