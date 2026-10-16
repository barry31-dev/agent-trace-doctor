import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTimeline, describeEvent, summarize } from "../src/analyze.js";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { projectRoot } from "./helpers.js";
import type { TraceEvent } from "./helpers.js";

function loaded(name: string): LoadedEvent[] {
  const result = loadTraceFile(join(projectRoot, "examples", name));
  if (!result.ok) {
    throw new Error(`fixture ${name} did not load: ${result.message}`);
  }
  return result.events;
}

function event(eventId: string, timestamp: string, type: string, payload: Record<string, unknown>): TraceEvent {
  return { schema_version: "1", event_id: eventId, timestamp, type, run_id: "run_test", payload };
}

function wrap(events: TraceEvent[]): LoadedEvent[] {
  return events.map((value, index) => ({ line: index + 1, event: value }));
}

const MINIMAL_PAYLOADS: Record<string, Record<string, unknown>> = {
  "run.started": { input_summary: "do a thing" },
  "run.finished": { status: "completed" },
  "run.failed": { status: "failed", error: { type: "task_failed", message: "no result" } },
  "run.cancelled": { status: "cancelled" },
  "model.request.started": { model: "m" },
  "model.response.completed": { model: "m", usage: { input_tokens: 1, output_tokens: 2 }, duration_ms: 3 },
  "model.response.failed": { model: "m", error: { type: "rate_limited", message: "429" } },
  "tool.call.started": { tool: "read_file" },
  "tool.call.completed": { tool: "read_file", status: "completed", duration_ms: 5 },
  "tool.call.failed": { tool: "read_file", status: "failed", error: { type: "x", message: "y" }, duration_ms: 5 },
  "permission.requested": { action: "write_file" },
  "permission.resolved": { decision: "approved" },
  "context.compacted": { strategy: "rolling_summary" },
  "error.recorded": { error: { type: "tool_error", message: "boom" } },
};

describe("analyze: describeEvent", () => {
  it("describes every declared event type without leaking placeholders", () => {
    for (const [type, payload] of Object.entries(MINIMAL_PAYLOADS)) {
      const text = describeEvent(event("evt_000001", "2026-10-14T10:00:00.000Z", type, payload));
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
      expect(text).not.toContain("[object");
    }
  });

  it("adds optional detail only when the recorder wrote it", () => {
    const bare = describeEvent(
      event("evt_000001", "2026-10-14T10:00:00.000Z", "tool.call.completed", {
        tool: "read_file",
        status: "completed",
        duration_ms: 5,
      }),
    );
    const full = describeEvent(
      event("evt_000002", "2026-10-14T10:00:00.000Z", "tool.call.completed", {
        tool: "read_file",
        status: "completed",
        duration_ms: 5,
        result_bytes: 2048,
        result_truncated: true,
      }),
    );
    expect(bare).toBe("tool result: read_file; 5 ms");
    expect(full).toBe("tool result: read_file; 5 ms; 2048 bytes; truncated");
  });

  it("marks a guardrail refusal apart from a real tool failure", () => {
    const refused = describeEvent(
      event("evt_000001", "2026-10-14T10:00:00.000Z", "tool.call.failed", {
        tool: "read_file",
        status: "failed",
        error: { type: "guardrail_refusal", message: "blocked" },
        duration_ms: 1,
        guard: "loop_block",
        guardrail_refusal: true,
      }),
    );
    const real = describeEvent(
      event("evt_000002", "2026-10-14T10:00:00.000Z", "tool.call.failed", {
        tool: "read_file",
        status: "failed",
        error: { type: "file_not_found", message: "gone" },
        duration_ms: 1,
      }),
    );
    expect(refused).toContain("guard loop_block");
    expect(refused).toContain("guardrail refusal");
    expect(real).not.toContain("guardrail refusal");
  });

  it("survives an event that is not an object", () => {
    expect(describeEvent("nope")).toBe("unknown");
    expect(describeEvent(null)).toBe("unknown");
    expect(describeEvent({ type: "run.started" })).toBe("run started");
    expect(describeEvent({ type: "no.such.type" })).toBe("no.such.type");
  });
});

describe("analyze: summarize", () => {
  it("counts the success example the way the file reads", () => {
    const summary = summarize("examples/success.jsonl", "bundled", loaded("success.jsonl"));
    expect(summary.command).toBe("summary");
    expect(summary.run_id).toBe("run_01");
    expect(summary.status).toBe("completed");
    expect(summary.terminal_event_id).toBe("evt_000019");
    expect(summary.started_at).toBe("2026-10-14T10:00:00.000Z");
    expect(summary.ended_at).toBe("2026-10-14T10:00:04.630Z");
    expect(summary.duration_ms).toBe(4630);
    expect(summary.events).toBe(19);
    expect(summary.models).toEqual(["stub-model-1"]);
    expect(summary.model_requests).toBe(3);
    expect(summary.model_responses_completed).toBe(3);
    expect(summary.model_responses_failed).toBe(0);
    expect(summary.tool_calls).toBe(4);
    expect(summary.tool_calls_completed).toBe(4);
    expect(summary.tool_calls_failed).toBe(0);
    expect(summary.permissions_requested).toBe(1);
    expect(summary.permissions_approved).toBe(1);
    expect(summary.permissions_denied).toBe(0);
    expect(summary.context_compactions).toBe(1);
    expect(summary.errors_recorded).toBe(0);
    expect(summary.tokens).toEqual({ input: 9090, output: 682, cache_read: 6144, cache_write: 0, reasoning: 0 });
  });

  it("separates refusals from real failures in the failed example", () => {
    const summary = summarize("examples/failed.jsonl", "bundled", loaded("failed.jsonl"));
    expect(summary.status).toBe("failed");
    expect(summary.tool_calls_failed).toBe(3);
    expect(summary.tool_guardrail_refusals).toBe(1);
    expect(summary.model_responses_failed).toBe(1);
    expect(summary.errors_recorded).toBe(2);
    expect(summary.errors_fatal).toBe(0);
    expect(summary.permissions_requested).toBe(0);
    expect(summary.events).toBe(26);
  });

  it("reports a cancelled run with its denied permission", () => {
    const summary = summarize("examples/cancelled.jsonl", "bundled", loaded("cancelled.jsonl"));
    expect(summary.status).toBe("cancelled");
    expect(summary.terminal_event_id).toBe("evt_000008");
    expect(summary.permissions_denied).toBe(1);
    expect(summary.errors_recorded).toBe(0);
    expect(summary.duration_ms).toBe(1810);
  });

  it("says incomplete when no terminal event was recorded", () => {
    const events = wrap([
      event("evt_000001", "2026-10-14T10:00:00.000Z", "run.started", { input_summary: "x" }),
      event("evt_000002", "2026-10-14T10:00:01.000Z", "model.request.started", { model: "m" }),
    ]);
    const summary = summarize("memory.jsonl", "bundled", events);
    expect(summary.status).toBe("incomplete");
    expect(summary.terminal_event_id).toBeNull();
    expect(summary.duration_ms).toBe(1000);
  });

  it("counts tokens only from completed responses", () => {
    const events = wrap([
      event("evt_000001", "2026-10-14T10:00:00.000Z", "model.response.completed", {
        model: "m",
        usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 4 },
        duration_ms: 1,
      }),
      event("evt_000002", "2026-10-14T10:00:01.000Z", "model.response.failed", {
        model: "m",
        error: { type: "rate_limited", message: "429" },
        duration_ms: 1,
      }),
      event("evt_000003", "2026-10-14T10:00:02.000Z", "model.response.completed", {
        model: "n",
        usage: { input_tokens: 5, output_tokens: 1, reasoning_tokens: 7 },
        duration_ms: 1,
      }),
    ]);
    const summary = summarize("memory.jsonl", "bundled", events);
    expect(summary.tokens).toEqual({ input: 15, output: 3, cache_read: 4, cache_write: 0, reasoning: 7 });
    expect(summary.models).toEqual(["m", "n"]);
  });

  it("returns a null duration when no timestamp can be parsed", () => {
    const events = wrap([event("evt_000001", "not-a-timestamp", "run.started", { input_summary: "x" })]);
    const summary = summarize("memory.jsonl", "bundled", events);
    expect(summary.duration_ms).toBeNull();
    expect(summary.started_at).toBeNull();
    expect(summary.ended_at).toBeNull();
  });

  it("produces the same report for the same input", () => {
    const events = loaded("failed.jsonl");
    expect(JSON.stringify(summarize("f", "bundled", events))).toBe(JSON.stringify(summarize("f", "bundled", events)));
  });
});

describe("analyze: buildTimeline", () => {
  it("keeps file order, line numbers and event ids", () => {
    const timeline = buildTimeline("examples/success.jsonl", "bundled", loaded("success.jsonl"));
    expect(timeline.command).toBe("timeline");
    expect(timeline.run_id).toBe("run_01");
    expect(timeline.events).toHaveLength(19);
    expect(timeline.events.map((entry) => entry.index)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(timeline.events.map((entry) => entry.line)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(timeline.events[0]?.event_id).toBe("evt_000001");
    expect(timeline.events[18]?.event_id).toBe("evt_000019");
    expect(timeline.events[0]?.offset_ms).toBe(0);
    expect(timeline.events[18]?.offset_ms).toBe(4630);
  });

  it("advances the step on every model request", () => {
    const timeline = buildTimeline("examples/success.jsonl", "bundled", loaded("success.jsonl"));
    expect(timeline.steps).toBe(3);
    expect(timeline.events[0]?.step).toBe(1);
    expect(timeline.events[12]?.step).toBe(1);
    expect(timeline.events[13]?.step).toBe(2);
    expect(timeline.events[16]?.step).toBe(3);
  });

  it("keeps line numbers when blank lines are skipped", () => {
    const events = wrap([
      event("evt_000001", "2026-10-14T10:00:00.000Z", "run.started", { input_summary: "x" }),
      event("evt_000002", "2026-10-14T10:00:01.000Z", "run.finished", { status: "completed" }),
    ]);
    events[1] = { line: 4, event: events[1]?.event };
    const timeline = buildTimeline("memory.jsonl", "bundled", events);
    expect(timeline.events.map((entry) => entry.line)).toEqual([1, 4]);
    expect(timeline.events[1]?.offset_ms).toBe(1000);
  });

  it("carries the per-event duration when the recorder wrote one", () => {
    const timeline = buildTimeline("examples/failed.jsonl", "bundled", loaded("failed.jsonl"));
    expect(timeline.events[0]?.duration_ms).toBeNull();
    expect(timeline.events[2]?.duration_ms).toBe(960);
  });

  it("produces the same rows for the same input", () => {
    const events = loaded("failed.jsonl");
    expect(JSON.stringify(buildTimeline("f", "bundled", events))).toBe(JSON.stringify(buildTimeline("f", "bundled", events)));
  });
});
