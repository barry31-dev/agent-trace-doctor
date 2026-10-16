import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { renderErrorsJson, renderErrorsText } from "../src/report.js";
import { UNKNOWN_ERROR, buildErrors } from "../src/errors.js";
import type { ErrorsReport } from "../src/errors.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function errors(name: string): ErrorsReport {
  return buildErrors(`examples/${name}`, "bundled", load(name));
}

function klass(report: ErrorsReport, type: string) {
  const found = report.classes.find((entry) => entry.type === type);
  if (found === undefined) {
    throw new Error(`no class for ${type}; have ${report.classes.map((entry) => entry.type).join(", ")}`);
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

const FAILED = errors("failed.jsonl");
const SPIKE = errors("spike-run.jsonl");

describe("errors: aggregation", () => {
  it("counts the failures of the real trace, hand-checked against the file", () => {
    expect(FAILED.events).toBe(26);
    expect(FAILED.failures).toBe(7);
    expect(FAILED.errors).toBe(6);
    expect(FAILED.refusals).toBe(1);
    expect(FAILED.fatal).toBe(0);
    expect(FAILED.occurrences).toHaveLength(7);
  });

  it("keeps the header counters reconcilable with the class table", () => {
    expect(FAILED.failures).toBe(FAILED.errors + FAILED.refusals);
    expect(FAILED.classes.reduce((total, row) => total + row.count, 0)).toBe(FAILED.failures);
    expect(FAILED.classes.reduce((total, row) => total + row.refusals, 0)).toBe(FAILED.refusals);
  });

  it("groups occurrences by error class and counts each source event type", () => {
    expect(klass(FAILED, "tool_error")).toMatchObject({ count: 2, fatal: 0, refusals: 0 });
    expect(klass(FAILED, "tool_error").sources).toEqual([{ value: "error.recorded", count: 2 }]);
    expect(klass(FAILED, "file_not_found").sources).toEqual([{ value: "tool.call.failed", count: 1 }]);
    expect(klass(FAILED, "rate_limited").sources).toEqual([{ value: "model.response.failed", count: 1 }]);
    expect(klass(FAILED, "task_failed").sources).toEqual([{ value: "run.failed", count: 1 }]);
  });

  it("carries the first and last line and event id of every class", () => {
    expect(klass(FAILED, "tool_error")).toMatchObject({
      first_line: 16,
      last_line: 23,
      first_event_id: "evt_000016",
      last_event_id: "evt_000023",
    });
  });

  it("keeps the guardrail refusal out of the error total, as the schema requires", () => {
    // The schema says a guardrail refusal must not be counted as a tool error, so the
    // blocked call is tallied under refusals and its own class row, never under errors.
    expect(klass(FAILED, "guardrail_refusal")).toMatchObject({ count: 1, refusals: 1 });
    expect(FAILED.occurrences.filter((entry) => entry.guardrail_refusal === true)).toHaveLength(1);
    expect(FAILED.errors).toBe(6);
  });

  it("records fatal only on error.recorded, and leaves the flag null elsewhere", () => {
    const events = [
      loaded(1, "evt_000001", "error.recorded", { error: { type: "boom", message: "m" }, fatal: true }),
      loaded(2, "evt_000002", "tool.call.failed", {
        tool: "t",
        status: "failed",
        error: { type: "boom", message: "m" },
      }),
    ];
    const report = buildErrors("f", "bundled", events);
    expect(report.fatal).toBe(1);
    expect(report.occurrences.map((entry) => entry.fatal)).toEqual([true, null]);
    expect(klass(report, "boom")).toMatchObject({ count: 2, fatal: 1 });
  });

  it("reads fatal as false when the recorder omitted it, per the schema default", () => {
    const events = [loaded(1, "evt_000001", "error.recorded", { error: { type: "boom", message: "m" } })];
    const report = buildErrors("f", "bundled", events);
    expect(report.fatal).toBe(0);
    expect(report.occurrences[0]?.fatal).toBe(false);
  });

  it("names the tool and the model the failing event was about, and nothing else", () => {
    const failed = FAILED.occurrences.find((entry) => entry.event === "tool.call.failed");
    expect(failed?.tool).toBe("read_file");
    expect(failed?.model).toBeNull();
    const model = FAILED.occurrences.find((entry) => entry.event === "model.response.failed");
    expect(model?.model).toBe("stub-model-1");
    expect(model?.tool).toBeNull();
    const recorded = FAILED.occurrences.find((entry) => entry.event === "error.recorded");
    expect(recorded?.tool).toBeNull();
    expect(recorded?.model).toBeNull();
  });

  it("reports no errors for a clean run, and says the run completed", () => {
    expect(SPIKE.failures).toBe(0);
    expect(SPIKE.classes).toEqual([]);
    expect(SPIKE.occurrences).toEqual([]);
    expect(SPIKE.status).toBe("completed");
  });

  it("says a cancelled run was cancelled, so zero errors cannot read as an all-clear", () => {
    const cancelled = errors("cancelled.jsonl");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.failures).toBe(0);
  });

  it("takes run_id from the first event that carries one", () => {
    expect(errors("failed.jsonl").run_id).toBe("run_02");
    const events = [
      loaded(1, "evt_000001", "model.request.started", { model: "m" }, "run_first"),
      loaded(2, "evt_000002", "tool.call.failed", { tool: "t", error: { type: "x", message: "m" } }, "run_second"),
    ];
    expect(buildErrors("f", "bundled", events).run_id).toBe("run_first");
  });

  it("buckets a failure whose payload carries no error class", () => {
    const events = [loaded(1, "evt_000001", "tool.call.failed", { tool: "t", status: "failed" })];
    const report = buildErrors("f", "bundled", events);
    expect(report.classes.map((row) => row.type)).toEqual([UNKNOWN_ERROR]);
    expect(report.occurrences[0]?.type).toBe(UNKNOWN_ERROR);
    expect(report.occurrences[0]?.message).toBe("");
  });

  it("ignores events that carry no structured error, including run.cancelled", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", { input_summary: "s" }),
      loaded(2, "evt_000002", "run.cancelled", { status: "cancelled", reason: "operator stopped it" }),
      loaded(3, "evt_000003", "tool.call.completed", { tool: "t", status: "completed", duration_ms: 1 }),
      loaded(4, "evt_000004", "permission.resolved", { decision: "denied", decided_by: "user" }),
    ];
    const report = buildErrors("f", "bundled", events);
    expect(report.failures).toBe(0);
    expect(report.classes).toEqual([]);
  });
});

describe("errors: dangling references", () => {
  it("names a related_event_id that no event in the file claims", () => {
    const events = [
      loaded(1, "evt_000001", "tool.call.failed", { tool: "t", error: { type: "x", message: "m" } }),
      loaded(2, "evt_000002", "error.recorded", {
        error: { type: "tool_error", message: "m" },
        related_event_id: "evt_000009",
      }),
    ];
    const report = buildErrors("f", "bundled", events);
    expect(report.dangling_references).toEqual([{ line: 2, event_id: "evt_000002", referenced: "evt_000009" }]);
  });

  it("accepts a related_event_id that points forwards, because the file is read whole", () => {
    const events = [
      loaded(1, "evt_000001", "error.recorded", {
        error: { type: "tool_error", message: "m" },
        related_event_id: "evt_000002",
      }),
      loaded(2, "evt_000002", "tool.call.failed", { tool: "t", error: { type: "x", message: "m" } }),
    ];
    expect(buildErrors("f", "bundled", events).dangling_references).toEqual([]);
  });

  it("reports the bundled examples as carrying no dangling reference", () => {
    for (const name of ["success.jsonl", "failed.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      expect(errors(name).dangling_references).toEqual([]);
    }
  });
});

describe("errors: ordering", () => {
  it("orders classes by count, then by type, so equal counts stay stable", () => {
    const events = [
      loaded(1, "evt_000001", "tool.call.failed", { tool: "t", error: { type: "zeta", message: "m" } }),
      loaded(2, "evt_000002", "tool.call.failed", { tool: "t", error: { type: "alpha", message: "m" } }),
      loaded(3, "evt_000003", "tool.call.failed", { tool: "t", error: { type: "beta", message: "m" } }),
      loaded(4, "evt_000004", "tool.call.failed", { tool: "t", error: { type: "beta", message: "m" } }),
    ];
    expect(buildErrors("f", "bundled", events).classes.map((row) => row.type)).toEqual([
      "beta",
      "alpha",
      "zeta",
    ]);
  });

  it("lists occurrences in file order", () => {
    expect(FAILED.occurrences.map((entry) => entry.line)).toEqual([13, 15, 16, 18, 22, 23, 26]);
  });
});

describe("errors: report shape", () => {
  it("names the command, the file and the schema label in the report", () => {
    expect(SPIKE.command).toBe("errors");
    expect(SPIKE.file).toBe("examples/spike-run.jsonl");
    expect(SPIKE.schema).toBe("bundled");
  });

  it("produces the same bytes for the same input, in both output modes", () => {
    for (const name of ["success.jsonl", "failed.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const first = errors(name);
      const second = errors(name);
      expect(renderErrorsJson(first)).toBe(renderErrorsJson(second));
      expect(renderErrorsText(first)).toBe(renderErrorsText(second));
    }
  });

  it("keeps a stable key order in --json mode", () => {
    expect(Object.keys(JSON.parse(renderErrorsJson(FAILED)))).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "status",
      "events",
      "failures",
      "errors",
      "refusals",
      "fatal",
      "classes",
      "occurrences",
      "dangling_references",
    ]);
  });
});

describe("errors: terminal rendering", () => {
  it("prints the header, one row per class and every occurrence", () => {
    const text = renderErrorsText(FAILED);
    expect(text).toContain("status    failed");
    expect(text).toContain("failures  7");
    expect(text).toContain("tool_error");
    expect(text).toContain("error.recorded x2");
    expect(text).toContain("evt_000016");
    expect(text).toContain("evt_000022");
    expect(text).toContain("refusal");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("prints one line for a run with no failures at all", () => {
    const text = renderErrorsText(SPIKE);
    expect(text).toContain("(no errors)");
    expect(text).not.toContain("occurrences");
    expect(text).toContain("status    completed");
  });

  it("prints a dash for a flag the event type does not carry", () => {
    const text = renderErrorsText(FAILED);
    // Matched on the leading line number so the row is found by its own event id and
    // not by the other row that cites it in its related column.
    const rows = text.split("\n").filter((line) => line.trim().startsWith("15  evt_000015"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(" - ");
  });

  it("folds tool and model into one context column, named by the event column", () => {
    const text = renderErrorsText(FAILED);
    const toolRow = text.split("\n").find((line) => line.includes("evt_000015"));
    const modelRow = text.split("\n").find((line) => line.includes("evt_000018"));
    expect(toolRow).toContain("read_file");
    expect(modelRow).toContain("stub-model-1");
  });

  it("prints a dash for a message the recorder did not write", () => {
    const events = [loaded(1, "evt_000001", "tool.call.failed", { tool: "t", status: "failed" })];
    expect(renderErrorsText(buildErrors("f", "bundled", events))).toContain(" - ");
  });

  it("pads columns to the widest cell, not to the terminal", () => {
    const wide = renderErrorsText(FAILED);
    const narrow = renderErrorsText(SPIKE);
    expect(wide.split("\n").some((line) => line.includes("refusals"))).toBe(true);
    expect(narrow.split("\n").some((line) => line.includes("refusals"))).toBe(true);
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what the
 * command prints is a documentation bug that reads as a feature, so it is compared here
 * rather than trusted.
 */
describe("errors: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace errors FILE"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(renderErrorsText(FAILED));
  });
});
