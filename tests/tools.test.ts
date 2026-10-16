import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { renderToolsJson, renderToolsText } from "../src/report.js";
import { UNNAMED_TOOL, buildTools } from "../src/tools.js";
import type { ToolsReport } from "../src/tools.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function tools(name: string): ToolsReport {
  return buildTools(`examples/${name}`, "bundled", load(name));
}

function row(report: ToolsReport, tool: string) {
  const found = report.tools.find((entry) => entry.tool === tool);
  if (found === undefined) {
    throw new Error(`no row for ${tool}; have ${report.tools.map((entry) => entry.tool).join(", ")}`);
  }
  return found;
}

let clock = 0;

/** Builds one loaded event. The timestamp advances so a fixture reads like a real run. */
function loaded(line: number, eventId: string, type: string, payload: unknown, runId = "run_01"): LoadedEvent {
  clock += 1;
  return {
    line,
    event: {
      schema_version: "1",
      event_id: eventId,
      timestamp: new Date(Date.parse("2026-10-14T10:00:00.000Z") + clock).toISOString(),
      type,
      run_id: runId,
      payload,
    },
  };
}

const SPIKE = tools("spike-run.jsonl");
const FAILED = tools("failed.jsonl");

describe("tools: aggregation", () => {
  it("counts calls, completions and failures per tool, hand-checked against the file", () => {
    const failed = FAILED;
    expect(failed.events).toBe(26);
    expect(failed.tool_calls).toBe(7);
    expect(row(failed, "read_file")).toMatchObject({ calls: 5, completed: 3, failed: 2, unresolved: 0 });
    expect(row(failed, "list_files")).toMatchObject({ calls: 1, completed: 1, failed: 0, unresolved: 0 });
    expect(row(failed, "run_command")).toMatchObject({ calls: 1, completed: 0, failed: 1, unresolved: 0 });
  });

  it("reproduces the real spike trace, including the tool that was withheld", () => {
    expect(SPIKE.events).toBe(22);
    expect(SPIKE.tool_calls).toBe(4);
    expect(row(SPIKE, "read_file")).toMatchObject({ calls: 2, completed: 2, failed: 0 });
    expect(row(SPIKE, "list_dir")).toMatchObject({ calls: 1, completed: 1, failed: 0 });
    expect(row(SPIKE, "write_file")).toMatchObject({ calls: 1, completed: 1, failed: 0 });
  });

  it("counts the file in events, not the number of tool calls", () => {
    expect(tools("cancelled.jsonl").events).toBe(8);
    expect(tools("cancelled.jsonl").tool_calls).toBe(1);
    expect(tools("success.jsonl").events).toBe(19);
    expect(tools("success.jsonl").tool_calls).toBe(4);
  });

  it("takes run_id from the first event that carries one", () => {
    expect(tools("failed.jsonl").run_id).toBe("run_02");
    const events = [loaded(1, "evt_000001", "model.request.started", { model: "m" }, "run_first"),
      loaded(2, "evt_000002", "tool.call.started", { tool: "t" }, "run_second")];
    expect(buildTools("f", "bundled", events).run_id).toBe("run_first");
  });

  it("ignores permission events, which name a tool without calling it", () => {
    const events = [
      loaded(1, "evt_000001", "permission.requested", { action: "write_file", tool: "write_file" }),
      loaded(2, "evt_000002", "permission.resolved", { decision: "approved", tool: "write_file" }),
    ];
    const report = buildTools("f", "bundled", events);
    expect(report.tools).toEqual([]);
    expect(report.tool_calls).toBe(0);
  });

  it("buckets a tool call whose payload carries no tool name", () => {
    const events = [loaded(1, "evt_000001", "tool.call.started", {})];
    const report = buildTools("f", "bundled", events);
    expect(report.tools.map((entry) => entry.tool)).toEqual([UNNAMED_TOOL]);
    expect(report.tool_calls).toBe(1);
  });
});

describe("tools: distributions", () => {
  it("collects guards only from failed calls", () => {
    expect(row(FAILED, "read_file").guards).toEqual([{ value: "loop_block", count: 1 }]);
    expect(row(FAILED, "list_files").guards).toEqual([]);
    expect(row(FAILED, "run_command").guards).toEqual([]);
  });

  it("counts guardrail refusals per tool", () => {
    expect(row(FAILED, "read_file").guardrail_refusals).toBe(1);
    expect(row(FAILED, "list_files").guardrail_refusals).toBe(0);
    expect(row(FAILED, "run_command").guardrail_refusals).toBe(0);
  });

  it("collects effects only from completed calls", () => {
    expect(row(SPIKE, "read_file").effects).toEqual([{ value: "none", count: 2 }]);
    expect(row(SPIKE, "write_file").effects).toEqual([{ value: "applied", count: 1 }]);
  });

  it("leaves effects empty when the recorder wrote none, rather than inventing a default", () => {
    expect(row(FAILED, "read_file").effects).toEqual([]);
    expect(row(tools("success.jsonl"), "read_file").effects).toEqual([]);
  });

  it("orders distributions by count, then by value, so equal counts stay stable", () => {
    const events = [
      loaded(1, "evt_000001", "tool.call.completed", { tool: "t", status: "completed", effect_disposition: "unknown" }),
      loaded(2, "evt_000002", "tool.call.completed", { tool: "t", status: "completed", effect_disposition: "applied" }),
      loaded(3, "evt_000003", "tool.call.completed", { tool: "t", status: "completed", effect_disposition: "applied" }),
      loaded(4, "evt_000004", "tool.call.completed", { tool: "t", status: "completed", effect_disposition: "none" }),
    ];
    expect(row(buildTools("f", "bundled", events), "t").effects).toEqual([
      { value: "applied", count: 2 },
      { value: "none", count: 1 },
      { value: "unknown", count: 1 },
    ]);
  });
});

describe("tools: ordering", () => {
  it("orders rows by call count, then by name", () => {
    expect(FAILED.tools.map((entry) => entry.tool)).toEqual(["read_file", "list_files", "run_command"]);
    expect(SPIKE.tools.map((entry) => entry.tool)).toEqual(["read_file", "list_dir", "write_file"]);
  });

  it("breaks a tie on equal counts by name, in both directions", () => {
    const events = [
      loaded(1, "evt_000001", "tool.call.started", { tool: "zeta" }),
      loaded(2, "evt_000002", "tool.call.started", { tool: "alpha" }),
      loaded(3, "evt_000003", "tool.call.started", { tool: "mid" }),
    ];
    expect(buildTools("f", "bundled", events).tools.map((entry) => entry.tool)).toEqual(["alpha", "mid", "zeta"]);
  });
});

describe("tools: traceability", () => {
  it("reports the first and last line and event id where each tool appears", () => {
    const read = row(SPIKE, "read_file");
    expect([read.first_line, read.last_line]).toEqual([8, 19]);
    expect([read.first_event_id, read.last_event_id]).toEqual(["evt_000008", "evt_000019"]);
    expect([row(SPIKE, "list_dir").first_line, row(SPIKE, "list_dir").last_line]).toEqual([4, 5]);
    expect([row(FAILED, "run_command").first_line, row(FAILED, "run_command").last_line]).toEqual([21, 22]);
  });

  it("keeps lines and ids on a tool that only ever failed", () => {
    const events = [loaded(7, "evt_000007", "tool.call.failed", { tool: "t", status: "failed", error: { type: "x", message: "y" } })];
    expect(row(buildTools("f", "bundled", events), "t")).toMatchObject({
      first_line: 7,
      last_line: 7,
      first_event_id: "evt_000007",
      last_event_id: "evt_000007",
    });
  });
});

describe("tools: unresolved calls", () => {
  it("reports a call that neither completed nor failed", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", { input_summary: "x" }),
      loaded(2, "evt_000002", "tool.call.started", { tool: "read_file" }),
      loaded(3, "evt_000003", "tool.call.completed", { tool: "read_file", status: "completed", duration_ms: 1 }),
      loaded(4, "evt_000004", "tool.call.started", { tool: "write_file" }),
      loaded(5, "evt_000005", "run.cancelled", { status: "cancelled", reason: "stopped" }),
    ];
    const report = buildTools("f", "bundled", events);
    expect(row(report, "read_file")).toMatchObject({ calls: 1, completed: 1, failed: 0, unresolved: 0 });
    expect(row(report, "write_file")).toMatchObject({ calls: 1, completed: 0, failed: 0, unresolved: 1 });
  });

  it("reports a negative unresolved when the trace resolves more calls than it starts", () => {
    const events = [loaded(1, "evt_000001", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1 })];
    expect(row(buildTools("f", "bundled", events), "t")).toMatchObject({ calls: 0, completed: 1, failed: 0, unresolved: -1 });
  });

  it("prints an explicit line for a trace with no tool calls at all", () => {
    const events = [loaded(1, "evt_000001", "run.started", { input_summary: "x" })];
    const report = buildTools("f", "bundled", events);
    expect(report.tools).toEqual([]);
    expect(report.tool_calls).toBe(0);
    expect(renderToolsText(report)).toContain("(no tool calls)");
  });
});

describe("tools: declared tool set", () => {
  it("reports the declared set in the order the recorder declared it", () => {
    expect(SPIKE.declared).toEqual([
      { tool: "list_dir", available: true, schema_hash: "980f9bea963a659c", calls: 1 },
      { tool: "read_file", available: true, schema_hash: "dcb18039f39e74c0", calls: 2 },
      { tool: "write_file", available: true, schema_hash: "5d66b6082d82b606", calls: 1 },
      { tool: "fetch_url", available: false, schema_hash: "5dcefaac22363d9a", calls: 0 },
    ]);
  });

  it("reports a declared tool that was never invoked as unused", () => {
    expect(SPIKE.unused).toEqual(["fetch_url"]);
    expect(SPIKE.undeclared).toEqual([]);
    expect(renderToolsText(SPIKE)).toContain("unused");
  });

  it("reports a call to a tool the run did not declare as undeclared", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", {
        input_summary: "x",
        config_summary: { model: "m", max_steps: 3, tools: [{ name: "listed", available: true }] },
      }),
      loaded(2, "evt_000002", "tool.call.started", { tool: "sneaky" }),
    ];
    const report = buildTools("f", "bundled", events);
    expect(report.declared).toEqual([{ tool: "listed", available: true, schema_hash: null, calls: 0 }]);
    expect(report.undeclared).toEqual(["sneaky"]);
    expect(report.unused).toEqual(["listed"]);
  });

  it("leaves undeclared empty when the recorder declared no tool set", () => {
    // Nothing was declared, so no call can be called undeclared. Filling the list with
    // every tool that was called would read like a finding when it is an absence.
    expect(tools("success.jsonl").declared).toEqual([]);
    expect(tools("success.jsonl").undeclared).toEqual([]);
    expect(tools("success.jsonl").unused).toEqual([]);
    expect(renderToolsText(tools("success.jsonl"))).toContain("(none declared)");
  });

  it("survives a declared tool set with an entry that has no name", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", {
        input_summary: "x",
        config_summary: { tools: [{ available: true }, { name: "kept", available: false }] },
      }),
    ];
    expect(buildTools("f", "bundled", events).declared.map((entry) => entry.tool)).toEqual(["kept"]);
  });
});

describe("tools: report stability", () => {
  it("keeps the documented top-level key order", () => {
    expect(Object.keys(SPIKE)).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "events",
      "tool_calls",
      "tools",
      "declared",
      "undeclared",
      "unused",
    ]);
  });

  it("keeps the documented key order inside each row and distribution", () => {
    expect(Object.keys(SPIKE.tools[0] ?? {})).toEqual([
      "tool",
      "calls",
      "completed",
      "failed",
      "unresolved",
      "guardrail_refusals",
      "guards",
      "effects",
      "first_line",
      "last_line",
      "first_event_id",
      "last_event_id",
    ]);
    expect(Object.keys(SPIKE.declared[0] ?? {})).toEqual(["tool", "available", "schema_hash", "calls"]);
    expect(Object.keys(SPIKE.tools[0]?.effects[0] ?? {})).toEqual(["value", "count"]);
  });

  it("produces the same bytes for the same input, in both output modes", () => {
    for (const name of ["success.jsonl", "failed.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const first = tools(name);
      const second = tools(name);
      expect(renderToolsJson(first)).toBe(renderToolsJson(second));
      expect(renderToolsText(first)).toBe(renderToolsText(second));
    }
  });

  it("names the command, the file and the schema label in the report", () => {
    expect(SPIKE.command).toBe("tools");
    expect(SPIKE.file).toBe("examples/spike-run.jsonl");
    expect(SPIKE.schema).toBe("bundled");
  });
});

describe("tools: terminal rendering", () => {
  it("prints a header, one row per tool and the declared set", () => {
    const text = renderToolsText(SPIKE);
    expect(text).toContain("tool calls  4");
    expect(text).toContain("read_file");
    expect(text).toContain("applied x1");
    expect(text).toContain("none x2");
    expect(text).toContain("schema_hash");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("prints a dash for a distribution the recorder never wrote", () => {
    const text = renderToolsText(FAILED);
    expect(text).toContain("loop_block x1");
    const lines = text.split("\n").filter((line) => line.startsWith("list_files"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("  -  ");
  });

  it("pads columns to the widest cell, not to the terminal", () => {
    const wide = renderToolsText(tools("failed.jsonl"));
    const narrow = renderToolsText(tools("cancelled.jsonl"));
    // The header is the same words in both reports; only the padding differs.
    expect(wide.split("\n").some((line) => line.includes("unresolved"))).toBe(true);
    expect(narrow.split("\n").some((line) => line.includes("unresolved"))).toBe(true);
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what the
 * command prints is a documentation bug that reads as a feature, so it is compared here
 * rather than trusted.
 */
describe("tools: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace tools FILE"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(renderToolsText(FAILED));
  });
});
