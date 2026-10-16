/**
 * Trace recorder for the mini agent spike.
 *
 * The recorder owns the three things a trace consumer must be able to rely on:
 * sequential unique event ids, non-decreasing timestamps and exactly one run id per
 * file. It is deliberately the only place in the spike that knows the wire shape of
 * an event: the agent loop and the tools speak in the types below, and this module
 * turns them into schema-version-1 JSON lines.
 *
 * Nothing here reads the clock implicitly. Both the clock and the line writer are
 * injected, so a test can pin an instant and capture output without touching the
 * file system.
 */

/** Whether a completed tool call left anything behind outside the process. */
export type EffectDisposition = "none" | "applied" | "unknown";

/** Which model slot a request or response belongs to. */
export type ModelRole = "main" | "reference" | "aggregator";

/** Where the body of a model response lives. */
export type CaptureMode = "inline" | "inline_from_stream" | "db_ref";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
}

export interface StructuredError {
  type: string;
  message: string;
}

/** One entry in the tool set offered to the model for a run. */
export interface ToolSummary {
  name: string;
  schema_hash: string;
  available: boolean;
}

export interface RunStartedPayload {
  input_summary: string;
  config_summary?: Record<string, unknown>;
}

export interface RunFinishedPayload {
  status: "completed";
  output_summary?: string;
}

export interface ModelRequestStartedPayload {
  model: string;
  messages?: number;
  role?: ModelRole;
  slot_label?: string;
}

export interface ModelResponseCompletedPayload {
  model: string;
  usage: TokenUsage;
  duration_ms: number;
  finish_reason?: string;
  role?: ModelRole;
  slot_label?: string;
  streamed?: boolean;
  capture?: CaptureMode;
  output_summary?: string;
}

export interface ModelResponseFailedPayload {
  model: string;
  error: StructuredError;
  duration_ms?: number;
}

export interface ToolCallStartedPayload {
  tool: string;
  tool_call_id?: string;
  args_summary?: string;
}

export interface ToolCallCompletedPayload {
  tool: string;
  status: "completed";
  duration_ms: number;
  result_bytes?: number;
  result_truncated?: boolean;
  effect_disposition?: EffectDisposition;
}

export interface ToolCallFailedPayload {
  tool: string;
  status: "failed";
  error: StructuredError;
  duration_ms: number;
  guard?: string;
  guardrail_refusal?: boolean;
  result_bytes?: number;
}

export interface PermissionRequestedPayload {
  action: string;
  resource?: string;
  tool?: string;
}

export interface PermissionResolvedPayload {
  decision: "approved" | "denied";
  decided_by?: string;
}

/** The event bodies this recorder writes, keyed by event type. */
export interface RecorderEvents {
  "run.started": RunStartedPayload;
  "run.finished": RunFinishedPayload;
  "run.failed": { status: "failed"; error: StructuredError; output_summary?: string };
  "run.cancelled": { status: "cancelled"; reason?: string };
  "model.request.started": ModelRequestStartedPayload;
  "model.response.completed": ModelResponseCompletedPayload;
  "model.response.failed": ModelResponseFailedPayload;
  "tool.call.started": ToolCallStartedPayload;
  "tool.call.completed": ToolCallCompletedPayload;
  "tool.call.failed": ToolCallFailedPayload;
  "permission.requested": PermissionRequestedPayload;
  "permission.resolved": PermissionResolvedPayload;
}

export type RecorderEventType = keyof RecorderEvents;

/** A complete trace event, exactly as it appears on one JSONL line. */
export interface TraceEvent {
  schema_version: "1";
  event_id: string;
  timestamp: string;
  type: RecorderEventType;
  run_id: string;
  payload: RecorderEvents[RecorderEventType];
}

export interface RecorderOptions {
  /** Groups the events of this run. Generated when omitted. */
  runId?: string;
  /** Epoch milliseconds. Defaults to `Date.now`. */
  clock?: () => number;
  /** Receives one JSON line per event, newline included. */
  write?: (line: string) => void;
}

/** What the recorder had to do to keep its own invariants true. */
export interface RecorderDiagnostics {
  /** Number of events whose observed clock reading was earlier than the previous one. */
  clampedTimestamps: number;
  /** Total events written. */
  events: number;
}

const SCHEMA_VERSION = "1" as const;

/**
 * Formats epoch milliseconds as an RFC 3339 instant with millisecond precision and
 * an explicit UTC designator, which is what the schema's `date-time` format expects.
 */
export function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Writes trace events as JSONL. One recorder per run: the run id and the event
 * counter live on the instance, so two runs sharing one recorder would share one
 * run id, which the schema forbids.
 */
export class TraceRecorder {
  readonly runId: string;

  private readonly clock: () => number;
  private readonly write: (line: string) => void;
  private readonly written: TraceEvent[] = [];
  private counter = 0;
  private lastMs: number | null = null;
  private clamped = 0;

  constructor(options: RecorderOptions = {}) {
    this.runId = options.runId ?? `run_${Math.random().toString(36).slice(2, 10)}`;
    this.clock = options.clock ?? (() => Date.now());
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  /**
   * Records one event and returns it. The event id is assigned here, never by the
   * caller, so the sequence has no gaps and no duplicates even when two code paths
   * record in the same tick.
   */
  record<T extends RecorderEventType>(type: T, payload: RecorderEvents[T]): TraceEvent {
    this.counter += 1;
    const event: TraceEvent = {
      schema_version: SCHEMA_VERSION,
      event_id: `evt_${String(this.counter).padStart(6, "0")}`,
      timestamp: this.nextTimestamp(),
      type,
      run_id: this.runId,
      payload,
    };
    this.written.push(event);
    this.write(`${JSON.stringify(event)}\n`);
    return event;
  }

  /** Events written so far, in file order. */
  events(): readonly TraceEvent[] {
    return this.written;
  }

  /** What the recorder had to do to keep its own invariants true. */
  diagnostics(): RecorderDiagnostics {
    return { clampedTimestamps: this.clamped, events: this.written.length };
  }

  /**
   * The next timestamp, never earlier than the previous one. A clock that jumps
   * backwards (NTP step, manual change) would otherwise produce a file the
   * validator rejects for `timestamp_order`, which would make a perfectly good run
   * unreadable. Clamping keeps the file valid and the count of clamped events is
   * reported in the diagnostics, so the substitution is visible rather than silent.
   */
  private nextTimestamp(): string {
    const observed = this.clock();
    if (this.lastMs !== null && observed < this.lastMs) {
      this.clamped += 1;
      return formatTimestamp(this.lastMs);
    }
    this.lastMs = observed;
    return formatTimestamp(observed);
  }
}
