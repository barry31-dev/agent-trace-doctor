import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { renderCompareJson, renderCompareText } from "../src/report.js";
import { buildCompare } from "../src/compare.js";
import type { CompareReport } from "../src/compare.js";
import { buildCompareDraft, withoutModel } from "../src/compareModel.js";
import type { CompareWithModel } from "../src/compareModel.js";
import { buildErrors } from "../src/errors.js";
import type { ErrorsReport } from "../src/errors.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function errorsOf(name: string): ErrorsReport {
  return buildErrors(`examples/${name}`, "bundled", load(name));
}

/**
 * The report the CLI prints for this pair: the deterministic comparison plus the
 * model half with the model switched off, which is what `compare` without `--model`
 * renders. Routing the tests through the draft keeps the rendered output the same
 * bytes the command produces.
 */
function compare(a: string, b: string): CompareWithModel {
  const eventsA = load(a);
  const eventsB = load(b);
  const report = buildCompare(`examples/${a}`, `examples/${b}`, "bundled", eventsA, eventsB);
  return withoutModel(buildCompareDraft(report, eventsA, eventsB, { maxExcerptEvents: 50, sendPaths: false }));
}

function klass(report: CompareReport, type: string) {
  const found = report.classes.find((entry) => entry.type === type);
  if (found === undefined) {
    throw new Error(`no class for ${type}; have ${report.classes.map((entry) => entry.type).join(", ")}`);
  }
  return found;
}

/** Wraps a hand-built report the way the CLI does, so rendering sees the whole report. */
function withModel(report: CompareReport, a: LoadedEvent[], b: LoadedEvent[]): CompareWithModel {
  return withoutModel(buildCompareDraft(report, a, b, { maxExcerptEvents: 50, sendPaths: false }));
}

function tool(report: CompareReport, name: string) {
  const found = report.tools.find((entry) => entry.tool === name);
  if (found === undefined) {
    throw new Error(`no tool row for ${name}; have ${report.tools.map((entry) => entry.tool).join(", ")}`);
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

/** One `error.recorded` event, the simplest carrier of a class and a fatal flag. */
function failure(line: number, eventId: string, type: string, fatal = false, runId = "run_01"): LoadedEvent {
  return loaded(line, eventId, "error.recorded", { error: { type, message: `${type} happened` }, fatal }, runId);
}

const BASELINE_VS_CANDIDATE = compare("success.jsonl", "failed.jsonl");
const CANDIDATE_VS_BASELINE = compare("failed.jsonl", "success.jsonl");
const SELF = compare("failed.jsonl", "failed.jsonl");

describe("compare: run facts", () => {
  it("reports both runs and their failure totals, hand-checked against the files", () => {
    expect(BASELINE_VS_CANDIDATE.command).toBe("compare");
    expect(BASELINE_VS_CANDIDATE.files).toEqual({ a: "examples/success.jsonl", b: "examples/failed.jsonl" });
    expect(BASELINE_VS_CANDIDATE.runs.a).toEqual({
      run_id: "run_01",
      status: "completed",
      events: 19,
      failures: 0,
      errors: 0,
      refusals: 0,
      fatal: 0,
    });
    expect(BASELINE_VS_CANDIDATE.runs.b).toEqual({
      run_id: "run_02",
      status: "failed",
      events: 26,
      failures: 7,
      errors: 6,
      refusals: 1,
      fatal: 0,
    });
  });

  it("counts the status change as one difference, so a cancelled run is not an all-clear", () => {
    const cancelled = compare("success.jsonl", "cancelled.jsonl");
    expect(cancelled.status_changed).toBe(true);
    expect(cancelled.classes).toEqual([]);
    expect(cancelled.tools).toEqual([]);
    expect(cancelled.differences).toBe(1);
    expect(cancelled.identical).toBe(false);
    expect(renderCompareText(cancelled)).toContain("(no failures in either trace)");
  });

  it("treats two clean but unrelated runs as identical failure profiles", () => {
    // success.jsonl and spike-run.jsonl share no run id and almost no events, but
    // neither failed. The failure profile is what this command compares; the shape of
    // a successful run is diff's business.
    const pair = compare("success.jsonl", "spike-run.jsonl");
    expect(pair.status_changed).toBe(false);
    expect(pair.differences).toBe(0);
    expect(pair.identical).toBe(true);
    expect(renderCompareText(pair)).toContain("ok: identical failure profiles");
  });
});

describe("compare: error classes", () => {
  it("marks every class of the failing trace as new, with counts, deltas and locations", () => {
    expect(BASELINE_VS_CANDIDATE.classes).toHaveLength(6);
    expect(BASELINE_VS_CANDIDATE.classes.map((row) => row.type)).toEqual([
      "tool_error",
      "command_failed",
      "file_not_found",
      "guardrail_refusal",
      "rate_limited",
      "task_failed",
    ]);
    for (const row of BASELINE_VS_CANDIDATE.classes) {
      expect(row.verdict).toBe("new");
      expect(row.a).toBeNull();
      expect(row.b).not.toBeNull();
      expect(row.delta).toBe(row.b?.count ?? 0);
    }
    const toolError = klass(BASELINE_VS_CANDIDATE, "tool_error");
    expect(toolError.b).toEqual({
      count: 2,
      fatal: 0,
      refusals: 0,
      first_line: 16,
      first_event_id: "evt_000016",
    });
  });

  it("mirrors every verdict when the two files are swapped", () => {
    expect(CANDIDATE_VS_BASELINE.classes).toHaveLength(6);
    for (const row of CANDIDATE_VS_BASELINE.classes) {
      expect(row.verdict).toBe("resolved");
      expect(row.a).not.toBeNull();
      expect(row.b).toBeNull();
      expect(row.delta).toBe(-(row.a?.count ?? 0));
    }
    // The count of differences is symmetric: swapping the files moves the same rows.
    expect(CANDIDATE_VS_BASELINE.differences).toBe(BASELINE_VS_CANDIDATE.differences);
  });

  it("reports unchanged rows when a trace is compared with itself", () => {
    expect(SELF.identical).toBe(true);
    expect(SELF.differences).toBe(0);
    for (const row of SELF.classes) {
      expect(row.verdict).toBe("unchanged");
      expect(row.delta).toBe(0);
      expect(row.fatal_delta).toBe(0);
      expect(row.refusals_delta).toBe(0);
    }
    expect(renderCompareText(SELF)).toContain("ok: identical failure profiles");
  });

  it("calls a same-count change in composition shifted, with the reason in the cell", () => {
    // One failure on each side, fatal only on the second: the count holds still while
    // the profile gets worse, which a count-only verdict would report as unchanged.
    const a = [failure(1, "evt_000001", "boom", false)];
    const b = [failure(1, "evt_000001", "boom", true)];
    const report = buildCompare("a.jsonl", "b.jsonl", "bundled", a, b);
    const row = klass(report, "boom");
    expect(row.delta).toBe(0);
    expect(row.fatal_delta).toBe(1);
    expect(row.verdict).toBe("shifted");
    expect(report.differences).toBe(1);
    expect(renderCompareText(withModel(report, a, b))).toContain("shifted (fatal +1)");
  });

  it("orders classes by movement, then by the second trace's count, then by name", () => {
    // P moves by three, Q and Q2 by two each with the same second-trace count, R does
    // not move at all.
    const a = [failure(1, "evt_000001", "P"), failure(2, "evt_000002", "R")];
    const b = [
      failure(1, "evt_000001", "P"),
      failure(2, "evt_000002", "P"),
      failure(3, "evt_000003", "P"),
      failure(4, "evt_000004", "P"),
      failure(5, "evt_000005", "Q"),
      failure(6, "evt_000006", "Q"),
      failure(7, "evt_000007", "Q2"),
      failure(8, "evt_000008", "Q2"),
      failure(9, "evt_000009", "R"),
    ];
    const report = buildCompare("a.jsonl", "b.jsonl", "bundled", a, b);
    expect(report.classes.map((row) => row.type)).toEqual(["P", "Q", "Q2", "R"]);
    expect(report.classes.map((row) => row.verdict)).toEqual(["increased", "new", "new", "unchanged"]);
  });
});

describe("compare: failing tools", () => {
  it("lists only the tools that failed somewhere, with both sides and the delta", () => {
    // list_files completed in both traces, so it is not part of a failure profile.
    expect(BASELINE_VS_CANDIDATE.tools.map((row) => row.tool)).toEqual(["read_file", "run_command"]);
    const readFile = tool(BASELINE_VS_CANDIDATE, "read_file");
    expect(readFile.calls_a).toBe(2);
    expect(readFile.calls_b).toBe(5);
    expect(readFile.failed_a).toBe(0);
    expect(readFile.failed_b).toBe(2);
    expect(readFile.refusals_b).toBe(1);
    expect(readFile.failed_delta).toBe(2);
    expect(readFile.verdict).toBe("increased");
    expect(readFile.first_line_a).toBe(6);
    expect(readFile.first_event_id_b).toBe("evt_000006");
  });

  it("calls a tool absent from the other trace new or resolved, not merely increased", () => {
    // run_command never appears in success.jsonl, so the a side is a tool row that
    // does not exist rather than a counter that reads zero.
    expect(tool(BASELINE_VS_CANDIDATE, "run_command").verdict).toBe("new");
    expect(tool(CANDIDATE_VS_BASELINE, "run_command").verdict).toBe("resolved");
    expect(tool(CANDIDATE_VS_BASELINE, "read_file").verdict).toBe("decreased");
  });

  it("reconciles the listed failures with the tool failures the errors report counts", () => {
    for (const name of ["success.jsonl", "failed.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const side = errorsOf(name);
      const toolFailures = side.occurrences.filter((entry) => entry.event === "tool.call.failed").length;
      const report = compare(name, "success.jsonl");
      const listed = name === "success.jsonl" ? report.runs.b : report.runs.a;
      expect(listed.failures).toBe(side.failures);
      const listedToolFailures =
        name === "success.jsonl"
          ? report.tools.reduce((sum, row) => sum + row.failed_b, 0)
          : report.tools.reduce((sum, row) => sum + row.failed_a, 0);
      expect(listedToolFailures).toBe(toolFailures);
      // Every class count sums to the side's failure total, header against table.
      const classTotal = report.classes.reduce((sum, row) => {
        const sideRow = name === "success.jsonl" ? row.b : row.a;
        return sum + (sideRow?.count ?? 0);
      }, 0);
      expect(classTotal).toBe(side.failures);
    }
  });
});

describe("compare: output stability", () => {
  it("produces byte-identical terminal and JSON output for the same input", () => {
    const again = compare("success.jsonl", "failed.jsonl");
    expect(renderCompareText(again)).toBe(renderCompareText(BASELINE_VS_CANDIDATE));
    expect(renderCompareJson(again)).toBe(renderCompareJson(BASELINE_VS_CANDIDATE));
  });

  it("keeps the JSON keys in the order of the interfaces", () => {
    const report = JSON.parse(renderCompareJson(BASELINE_VS_CANDIDATE)) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual([
      "command",
      "schema",
      "files",
      "runs",
      "status_changed",
      "classes",
      "tools",
      "differences",
      "identical",
      "findings",
      "unverified",
      "model",
    ]);
    // The model half keeps its own key order, pinned here so a field added to one
    // command's model section without the other is visible.
    expect(Object.keys(report.model as Record<string, unknown>)).toEqual([
      "enabled",
      "ok",
      "provider",
      "model",
      "requests",
      "sent_events",
      "request_bytes",
      "redacted_fields",
      "skipped",
      "unverified",
      "error",
    ]);
    expect(Object.keys(report.runs as Record<string, unknown>)).toEqual(["a", "b"]);
    const first = (report.classes as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(first)).toEqual(["type", "a", "b", "delta", "fatal_delta", "refusals_delta", "verdict"]);
    expect(Object.keys((first.b as Record<string, unknown>) ?? {})).toEqual([
      "count",
      "fatal",
      "refusals",
      "first_line",
      "first_event_id",
    ]);
    const firstTool = (report.tools as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(firstTool)).toEqual([
      "tool",
      "calls_a",
      "calls_b",
      "failed_a",
      "failed_b",
      "refusals_a",
      "refusals_b",
      "failed_delta",
      "first_line_a",
      "first_line_b",
      "first_event_id_a",
      "first_event_id_b",
      "verdict",
    ]);
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what
 * the command prints is a documentation bug that reads as a feature, so it is
 * compared here rather than trusted.
 */
describe("compare: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace compare FILE FILE"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(renderCompareText(BASELINE_VS_CANDIDATE));
  });
});
