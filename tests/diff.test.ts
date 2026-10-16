import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffTraces } from "../src/diff.js";
import type { DiffChange, DiffReport } from "../src/diff.js";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { renderDiffJson } from "../src/report.js";
import { projectRoot } from "./helpers.js";

function event(
  eventId: string,
  type: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: "1",
    event_id: eventId,
    timestamp: "2026-10-14T10:00:00.000Z",
    type,
    run_id: "run_01",
    payload,
    ...overrides,
  };
}

function loaded(line: number, value: Record<string, unknown>): LoadedEvent {
  return { line, event: value };
}

function diff(eventsA: LoadedEvent[], eventsB: LoadedEvent[]): DiffReport {
  return diffTraces("a.jsonl", "b.jsonl", "bundled", eventsA, eventsB);
}

function changesOfKind(report: DiffReport, kind: DiffChange["kind"]): DiffChange[] {
  return report.changes.filter((change) => change.kind === kind);
}

function loadExample(name: string): LoadedEvent[] {
  const result = loadTraceFile(join(projectRoot, "examples", name));
  if (!result.ok) {
    throw new Error(`example ${name} did not load: ${result.message}`);
  }
  return result.events;
}

const RUN_STARTED = event("evt_000001", "run.started", { input_summary: "x" });

describe("diff: identical traces", () => {
  it("reports no changes for the same events", () => {
    const events = [loaded(1, RUN_STARTED)];
    const report = diff(events, events);
    expect(report.identical).toBe(true);
    expect(report.changes).toEqual([]);
    expect(report.events).toEqual({ a: 1, b: 1 });
  });

  it("reports no changes when only the wall-clock timestamps differ", () => {
    const a = [loaded(1, event("evt_000001", "run.started", { input_summary: "x" }, { timestamp: "2026-10-14T10:00:00.000Z" }))];
    const b = [loaded(1, event("evt_000001", "run.started", { input_summary: "x" }, { timestamp: "2026-10-15T23:59:59.999Z" }))];
    expect(diff(a, b).identical).toBe(true);
  });
});

describe("diff: run identity", () => {
  it("reports a run_id change once, as a run entry", () => {
    const a = [loaded(1, event("evt_000001", "run.started", { input_summary: "x" }, { run_id: "run_01" }))];
    const b = [loaded(1, event("evt_000001", "run.started", { input_summary: "x" }, { run_id: "run_02" }))];
    expect(diff(a, b).changes).toEqual([
      {
        kind: "run",
        field: "run_id",
        event_id: null,
        type: null,
        line_a: null,
        line_b: null,
        a: "run_01",
        b: "run_02",
        fields: [],
      },
    ]);
  });
});

describe("diff: summary fields", () => {
  function answered(usage: Record<string, number>): LoadedEvent[] {
    return [
      loaded(1, event("evt_000001", "run.started", { input_summary: "x" })),
      loaded(2, event("evt_000002", "model.request.started", { model: "m1" })),
      loaded(3, event("evt_000003", "model.response.completed", { model: "m1", usage, duration_ms: 100 })),
      loaded(4, event("evt_000004", "run.finished", { status: "completed" })),
    ];
  }

  it("reports a token total change as one summary entry", () => {
    const a = answered({ input_tokens: 100, output_tokens: 10 });
    const b = answered({ input_tokens: 200, output_tokens: 10 });
    expect(changesOfKind(diff(a, b), "summary")).toEqual([
      {
        kind: "summary",
        field: "tokens.input",
        event_id: null,
        type: null,
        line_a: null,
        line_b: null,
        a: 100,
        b: 200,
        fields: [],
      },
    ]);
  });

  it("reports a status change with the terminal event of each side", () => {
    const a = answered({ input_tokens: 100, output_tokens: 10 });
    const b = [
      loaded(1, event("evt_000001", "run.started", { input_summary: "x" })),
      loaded(2, event("evt_000002", "run.failed", { status: "failed", error: { type: "task_failed", message: "no" } })),
    ];
    const status = changesOfKind(diff(a, b), "summary").find((change) => change.field === "status");
    expect(status?.a).toBe("completed");
    expect(status?.b).toBe("failed");
    const terminal = changesOfKind(diff(a, b), "summary").find((change) => change.field === "terminal_event_id");
    expect(terminal?.a).toBe("evt_000004");
    expect(terminal?.b).toBe("evt_000002");
  });

  it("reports a model list change", () => {
    const a = [loaded(1, event("evt_000001", "model.request.started", { model: "m1" }))];
    const b = [loaded(1, event("evt_000001", "model.request.started", { model: "m2" }))];
    const models = changesOfKind(diff(a, b), "summary").find((change) => change.field === "models");
    expect(models?.a).toEqual(["m1"]);
    expect(models?.b).toEqual(["m2"]);
  });

  it("reports duration but never the start and end instants", () => {
    const a = [
      loaded(1, event("evt_000001", "run.started", { input_summary: "x" }, { timestamp: "2026-10-14T10:00:00.000Z" })),
      loaded(2, event("evt_000002", "run.finished", { status: "completed" }, { timestamp: "2026-10-14T10:00:01.000Z" })),
    ];
    const b = [
      loaded(1, event("evt_000001", "run.started", { input_summary: "x" }, { timestamp: "2026-10-14T11:00:00.000Z" })),
      loaded(2, event("evt_000002", "run.finished", { status: "completed" }, { timestamp: "2026-10-14T11:00:05.000Z" })),
    ];
    const fields = changesOfKind(diff(a, b), "summary").map((change) => change.field);
    expect(fields).toEqual(["duration_ms"]);
    expect(changesOfKind(diff(a, b), "summary")[0]?.a).toBe(1000);
    expect(changesOfKind(diff(a, b), "summary")[0]?.b).toBe(5000);
  });
});

describe("diff: events", () => {
  it("reports an event only in the second trace as added, with its line", () => {
    const a = [loaded(1, RUN_STARTED)];
    const b = [loaded(1, RUN_STARTED), loaded(2, event("evt_000002", "run.finished", { status: "completed" }))];
    expect(changesOfKind(diff(a, b), "event_added")).toEqual([
      {
        kind: "event_added",
        field: null,
        event_id: "evt_000002",
        type: "run.finished",
        line_a: null,
        line_b: 2,
        a: null,
        b: null,
        fields: [],
      },
    ]);
  });

  it("reports an event only in the first trace as removed, with its line", () => {
    const a = [loaded(1, RUN_STARTED), loaded(2, event("evt_000002", "run.finished", { status: "completed" }))];
    const b = [loaded(1, RUN_STARTED)];
    expect(changesOfKind(diff(a, b), "event_removed")).toEqual([
      {
        kind: "event_removed",
        field: null,
        event_id: "evt_000002",
        type: "run.finished",
        line_a: 2,
        line_b: null,
        a: null,
        b: null,
        fields: [],
      },
    ]);
  });

  it("keeps the line number of each side, so blank lines stay traceable", () => {
    const a = [loaded(3, event("evt_000001", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 1 }))];
    const b = [loaded(5, event("evt_000001", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 2 }))];
    const changed = changesOfKind(diff(a, b), "event_changed");
    expect(changed[0]?.line_a).toBe(3);
    expect(changed[0]?.line_b).toBe(5);
  });

  it("reports a changed payload field with its JSON pointer", () => {
    const a = [loaded(1, event("evt_000001", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 100 }))];
    const b = [loaded(1, event("evt_000001", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 200 }))];
    const report = diff(a, b);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]).toEqual({
      kind: "event_changed",
      field: null,
      event_id: "evt_000001",
      type: "tool.call.completed",
      line_a: 1,
      line_b: 1,
      a: null,
      b: null,
      fields: [{ path: "/payload/result_bytes", a: 100, b: 200 }],
    });
  });

  it("reports a field nested inside the payload", () => {
    const a = [loaded(1, event("evt_000001", "model.response.completed", { model: "m1", usage: { input_tokens: 100, output_tokens: 10 }, duration_ms: 1 }))];
    const b = [loaded(1, event("evt_000001", "model.response.completed", { model: "m1", usage: { input_tokens: 200, output_tokens: 10 }, duration_ms: 1 }))];
    const fields = changesOfKind(diff(a, b), "event_changed")[0]?.fields;
    expect(fields).toEqual([{ path: "/payload/usage/input_tokens", a: 100, b: 200 }]);
  });

  it("reports a field present on one side only as null on the other", () => {
    const a = [loaded(1, event("evt_000001", "tool.call.failed", { tool: "t", status: "failed", error: { type: "x", message: "y" }, duration_ms: 1, guard: "loop_block" }))];
    const b = [loaded(1, event("evt_000001", "tool.call.failed", { tool: "t", status: "failed", error: { type: "x", message: "y" }, duration_ms: 1 }))];
    expect(changesOfKind(diff(a, b), "event_changed")[0]?.fields).toEqual([
      { path: "/payload/guard", a: "loop_block", b: null },
    ]);
  });

  it("reports a type change as a /type difference and keeps the first type on the entry", () => {
    const a = [loaded(1, event("evt_000001", "permission.requested", { action: "write_file", resource: "report.md", tool: "write_file" }))];
    const b = [loaded(1, event("evt_000001", "tool.call.started", { tool: "read_file", tool_call_id: "call_004", args_summary: "path=notes/a.md" }))];
    const changed = changesOfKind(diff(a, b), "event_changed")[0];
    expect(changed?.type).toBe("permission.requested");
    expect(changed?.fields).toEqual([
      { path: "/payload/action", a: "write_file", b: null },
      { path: "/payload/args_summary", a: null, b: "path=notes/a.md" },
      { path: "/payload/resource", a: "report.md", b: null },
      { path: "/payload/tool", a: "write_file", b: "read_file" },
      { path: "/payload/tool_call_id", a: null, b: "call_004" },
      { path: "/type", a: "permission.requested", b: "tool.call.started" },
    ]);
  });

  it("compares arrays as whole values, so a reordered list is one change", () => {
    const a = [loaded(1, event("evt_000001", "tool.call.started", { tool: "t", tags: ["a", "b"] }))];
    const b = [loaded(1, event("evt_000001", "tool.call.started", { tool: "t", tags: ["b", "a"] }))];
    expect(changesOfKind(diff(a, b), "event_changed")[0]?.fields).toEqual([
      { path: "/payload/tags", a: ["a", "b"], b: ["b", "a"] },
    ]);
  });

  it("ignores key order inside payload objects", () => {
    const a = [loaded(1, event("evt_000001", "tool.call.started", { tool: "t", extra: { b: 2, a: 1 } }))];
    const b = [loaded(1, event("evt_000001", "tool.call.started", { tool: "t", extra: { a: 1, b: 2 } }))];
    expect(diff(a, b).identical).toBe(true);
  });

  it("lists event changes by event id, whatever order the arrays are in", () => {
    const a = [
      loaded(1, event("evt_000005", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 1 })),
      loaded(2, event("evt_000003", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 1 })),
    ];
    const b = [
      loaded(1, event("evt_000005", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 2 })),
      loaded(2, event("evt_000003", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1, result_bytes: 2 })),
    ];
    expect(changesOfKind(diff(a, b), "event_changed").map((change) => change.event_id)).toEqual([
      "evt_000003",
      "evt_000005",
    ]);
  });
});

describe("diff: report shape", () => {
  it("prints stable keys for the report and for every change", () => {
    const a = [loaded(1, event("evt_000001", "run.started", { input_summary: "x" }))];
    const b = [loaded(1, event("evt_000001", "run.started", { input_summary: "y" }))];
    const parsed = JSON.parse(renderDiffJson(diff(a, b))) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["command", "schema", "files", "events", "identical", "changes"]);
    const changes = parsed.changes as Record<string, unknown>[];
    expect(Object.keys(changes[0] ?? {})).toEqual([
      "kind",
      "field",
      "event_id",
      "type",
      "line_a",
      "line_b",
      "a",
      "b",
      "fields",
    ]);
    const fields = (changes[0] as { fields: Record<string, unknown>[] }).fields;
    expect(Object.keys(fields[0] ?? {})).toEqual(["path", "a", "b"]);
  });

  it("produces byte-identical output for identical input", () => {
    const a = loadExample("success.jsonl");
    const b = loadExample("failed.jsonl");
    expect(renderDiffJson(diff(a, b))).toBe(renderDiffJson(diff(a, b)));
  });
});

describe("diff: examples", () => {
  it("finds no differences between an example and itself", () => {
    for (const name of ["success.jsonl", "failed.jsonl", "cancelled.jsonl"]) {
      const events = loadExample(name);
      expect(diff(events, events).identical).toBe(true);
    }
  });

  it("compares the success and failed examples the way a reader counts them", () => {
    const report = diff(loadExample("success.jsonl"), loadExample("failed.jsonl"));
    expect(report.events).toEqual({ a: 19, b: 26 });
    expect(report.identical).toBe(false);
    expect(report.changes).toHaveLength(37);

    expect(changesOfKind(report, "run")).toEqual([
      {
        kind: "run",
        field: "run_id",
        event_id: null,
        type: null,
        line_a: null,
        line_b: null,
        a: "run_01",
        b: "run_02",
        fields: [],
      },
    ]);

    expect(changesOfKind(report, "summary").map((change) => change.field)).toEqual([
      "status",
      "terminal_event_id",
      "duration_ms",
      "events",
      "model_requests",
      "model_responses_failed",
      "tool_calls",
      "tool_calls_failed",
      "tool_guardrail_refusals",
      "permissions_requested",
      "permissions_approved",
      "context_compactions",
      "errors_recorded",
      "tokens.input",
      "tokens.output",
      "tokens.cache_read",
    ]);

    expect(changesOfKind(report, "event_changed").map((change) => change.event_id)).toEqual([
      "evt_000003",
      "evt_000008",
      "evt_000009",
      "evt_000010",
      "evt_000011",
      "evt_000012",
      "evt_000013",
      "evt_000014",
      "evt_000015",
      "evt_000016",
      "evt_000017",
      "evt_000018",
      "evt_000019",
    ]);
    expect(changesOfKind(report, "event_added").map((change) => change.event_id)).toEqual([
      "evt_000020",
      "evt_000021",
      "evt_000022",
      "evt_000023",
      "evt_000024",
      "evt_000025",
      "evt_000026",
    ]);
    expect(changesOfKind(report, "event_removed")).toEqual([]);

    const third = changesOfKind(report, "event_changed").find((change) => change.event_id === "evt_000003");
    expect(third?.fields).toEqual([{ path: "/payload/duration_ms", a: 920, b: 960 }]);
    const tenth = changesOfKind(report, "event_changed").find((change) => change.event_id === "evt_000010");
    expect(tenth?.type).toBe("permission.requested");
    // The type changed and five payload members were added, removed or rewritten.
    expect(tenth?.fields).toHaveLength(6);
  });
});
