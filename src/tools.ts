import { asRecord, asText, bumpCount, byCountThenValue, distribution, payloadOf } from "./analyze.js";
import type { Distribution } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";

/**
 * Per-tool aggregation of one validated trace.
 *
 * `summary` answers "how did the run go" and `timeline` answers "what happened in what
 * order"; neither answers "which tool was the problem". This does. It is a pure
 * function over loaded events, like the analyzer and the diff: no clock, no file
 * system, no network, so the same file always produces the same bytes.
 */

/**
 * Bucket for a tool-call event whose payload carries no tool name. The bundled schema
 * requires `tool` on all three tool-call payloads, so this only happens when a laxer
 * schema was passed with `--schema`. The events still have to be counted somewhere:
 * dropping them would make the totals silently disagree with the file.
 */
export const UNNAMED_TOOL = "(unnamed)";

export interface ToolRow {
  tool: string;
  /** `tool.call.started` events: how often the tool was invoked. */
  calls: number;
  completed: number;
  failed: number;
  /**
   * Calls that neither completed nor failed. Arithmetic on the three counters, not a
   * pairing of events: a completed tool call does not carry the `tool_call_id` of the
   * start it answers, so the two cannot be matched line by line. A negative value
   * means the trace records more resolutions than starts.
   */
  unresolved: number;
  guardrail_refusals: number;
  /** Guards recorded on failed calls, most frequent first. */
  guards: Distribution[];
  /** Effect dispositions recorded on completed calls, most frequent first. */
  effects: Distribution[];
  /** First and last line in the file where this tool appears, for traceability. */
  first_line: number | null;
  last_line: number | null;
  first_event_id: string | null;
  last_event_id: string | null;
}

/** One tool the recorder said it offered, and how often it was actually invoked. */
export interface DeclaredTool {
  tool: string;
  /** False when the tool existed but was withheld from the model this run. */
  available: boolean;
  schema_hash: string | null;
  calls: number;
}

export interface ToolsReport {
  command: "tools";
  file: string;
  schema: string;
  run_id: string | null;
  /** Events in the file, not the number of tool calls. */
  events: number;
  tool_calls: number;
  tools: ToolRow[];
  /**
   * The tool set `run.started` declared, in the order it was declared. Empty when the
   * recorder declared none, which is also why `undeclared` stays empty then: with
   * nothing declared, no call can be called undeclared.
   */
  declared: DeclaredTool[];
  undeclared: string[];
  /** Declared tools that were never invoked. */
  unused: string[];
}

interface Accumulator {
  tool: string;
  calls: number;
  completed: number;
  failed: number;
  guardrailRefusals: number;
  guards: Map<string, number>;
  effects: Map<string, number>;
  firstLine: number | null;
  lastLine: number | null;
  firstEventId: string | null;
  lastEventId: string | null;
}

const TOOL_EVENT_TYPES = new Set(["tool.call.started", "tool.call.completed", "tool.call.failed"]);

function rowFor(rows: Map<string, Accumulator>, tool: string): Accumulator {
  const existing = rows.get(tool);
  if (existing !== undefined) {
    return existing;
  }
  const created: Accumulator = {
    tool,
    calls: 0,
    completed: 0,
    failed: 0,
    guardrailRefusals: 0,
    guards: new Map(),
    effects: new Map(),
    firstLine: null,
    lastLine: null,
    firstEventId: null,
    lastEventId: null,
  };
  rows.set(tool, created);
  return created;
}

function byCallsThenName(left: ToolRow, right: ToolRow): number {
  if (left.calls !== right.calls) {
    return right.calls - left.calls;
  }
  return left.tool < right.tool ? -1 : left.tool > right.tool ? 1 : 0;
}

/**
 * Reads the declared tool set out of a `run.started` payload. `config_summary` is open
 * for extension in the schema, so every field is optional here and a recorder that
 * writes something else simply declares nothing.
 */
function readDeclarations(payload: Record<string, unknown>): DeclaredTool[] {
  const config = asRecord(payload.config_summary);
  const tools = config?.tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  const declared: DeclaredTool[] = [];
  for (const entry of tools) {
    const record = asRecord(entry);
    const name = asText(record?.name);
    if (name === null) {
      continue;
    }
    declared.push({
      tool: name,
      available: record?.available === true,
      schema_hash: asText(record?.schema_hash),
      calls: 0,
    });
  }
  return declared;
}

/**
 * Builds the `tools` report. Counters are plain tallies of event types, so a trace that
 * records the same call twice counts twice; nothing is inferred or de-duplicated.
 * Distributions carry only the values the recorder actually wrote, so a run whose
 * recorder never classified effects reports no effects rather than a default that
 * would read like a claim.
 */
export function buildTools(file: string, schemaLabel: string, events: LoadedEvent[]): ToolsReport {
  const rows = new Map<string, Accumulator>();
  const declared: DeclaredTool[] = [];
  let runId: string | null = null;
  let toolCalls = 0;

  for (const { line, event } of events) {
    const record = asRecord(event);
    if (runId === null) {
      const id = asText(record?.run_id);
      if (id !== null) {
        runId = id;
      }
    }

    const type = asText(record?.type);
    const payload = payloadOf(event);

    if (type === "run.started") {
      declared.push(...readDeclarations(payload));
      continue;
    }
    if (type === null || !TOOL_EVENT_TYPES.has(type)) {
      continue;
    }

    const name = asText(payload.tool) ?? UNNAMED_TOOL;
    const row = rowFor(rows, name);
    const eventId = asText(record?.event_id);
    row.lastLine = line;
    if (eventId !== null) {
      row.lastEventId = eventId;
    }
    if (row.firstLine === null) {
      row.firstLine = line;
      row.firstEventId = eventId;
    }

    if (type === "tool.call.started") {
      toolCalls += 1;
      row.calls += 1;
      continue;
    }
    if (type === "tool.call.completed") {
      row.completed += 1;
      const effect = asText(payload.effect_disposition);
      if (effect !== null) {
        bumpCount(row.effects, effect);
      }
      continue;
    }

    row.failed += 1;
    if (payload.guardrail_refusal === true) {
      row.guardrailRefusals += 1;
    }
    const guard = asText(payload.guard);
    if (guard !== null) {
      bumpCount(row.guards, guard);
    }
  }

  const callsByTool = new Map<string, number>();
  for (const row of rows.values()) {
    callsByTool.set(row.tool, row.calls);
  }
  for (const entry of declared) {
    entry.calls = callsByTool.get(entry.tool) ?? 0;
  }

  const declaredNames = new Set(declared.map((entry) => entry.tool));
  const undeclared =
    declared.length === 0 ? [] : Array.from(rows.keys()).filter((name) => !declaredNames.has(name)).sort();
  const unused = declared
    .filter((entry) => entry.calls === 0)
    .map((entry) => entry.tool)
    .sort();

  return {
    command: "tools",
    file,
    schema: schemaLabel,
    run_id: runId,
    events: events.length,
    tool_calls: toolCalls,
    tools: Array.from(rows.values())
      .map((row) => ({
        tool: row.tool,
        calls: row.calls,
        completed: row.completed,
        failed: row.failed,
        unresolved: row.calls - row.completed - row.failed,
        guardrail_refusals: row.guardrailRefusals,
        guards: distribution(row.guards),
        effects: distribution(row.effects),
        first_line: row.firstLine,
        last_line: row.lastLine,
        first_event_id: row.firstEventId,
        last_event_id: row.lastEventId,
      }))
      .sort(byCallsThenName),
    declared,
    undeclared,
    unused,
  };
}
