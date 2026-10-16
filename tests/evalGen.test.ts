import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { buildErrors } from "../src/errors.js";
import { buildEvalGen, readInputSummary } from "../src/evalGen.js";
import type { EvalGenReport } from "../src/evalGen.js";
import { renderEvalGenJson, renderEvalGenText } from "../src/report.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function report(name: string): EvalGenReport {
  const events = load(name);
  return buildEvalGen(buildErrors(`examples/${name}`, "bundled", events), readInputSummary(events));
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

function evalGenOf(events: LoadedEvent[]): EvalGenReport {
  return buildEvalGen(buildErrors("fixture", "bundled", events), readInputSummary(events));
}

const FAILED = report("failed.jsonl");
const SPIKE = report("spike-run.jsonl");

describe("eval-gen: cases from a real trace", () => {
  it("hand-checks the case count against the failures the file records", () => {
    expect(FAILED.events).toBe(26);
    expect(FAILED.failures).toBe(7);
    expect(FAILED.errors).toBe(6);
    expect(FAILED.refusals).toBe(1);
    // Six real failures in five classes: tool_error occurs twice.
    expect(FAILED.cases.map((entry) => entry.error_type)).toEqual([
      "tool_error",
      "command_failed",
      "file_not_found",
      "rate_limited",
      "task_failed",
    ]);
    expect(FAILED.cases.map((entry) => entry.count)).toEqual([2, 1, 1, 1, 1]);
  });

  it("keeps every counter reconcilable with the errors report it was built from", () => {
    expect(FAILED.cases.reduce((total, entry) => total + entry.count, 0)).toBe(FAILED.errors);
    expect(FAILED.cases.reduce((total, entry) => total + entry.count, 0) + FAILED.refusals).toBe(FAILED.failures);
    expect(FAILED.cases.reduce((total, entry) => total + entry.occurrences.length, 0)).toBe(FAILED.errors);
  });

  it("carries the scenario and the outcome the run recorded", () => {
    expect(FAILED.run_id).toBe("run_02");
    expect(FAILED.status).toBe("failed");
    expect(FAILED.input_summary).toBe("Summarize the files in notes/ and write report.md");
  });

  it("produces no cases for a run with no failures, which is a normal answer", () => {
    for (const name of ["success.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const clean = report(name);
      expect(clean.cases).toEqual([]);
      expect(clean.failures).toBe(0);
      expect(clean.skipped_refusals).toEqual([]);
    }
  });

  it("numbers cases in class order, so the same file always yields the same ids", () => {
    expect(FAILED.cases.map((entry) => entry.case_id)).toEqual([
      "case_001",
      "case_002",
      "case_003",
      "case_004",
      "case_005",
    ]);
    expect(SPIKE.cases).toEqual([]);
  });
});

describe("eval-gen: evidence binding", () => {
  it("cites only events the file actually carries, at the line the file has them on", () => {
    const errors = buildErrors("examples/failed.jsonl", "bundled", load("failed.jsonl"));
    const byId = new Map(errors.occurrences.map((occurrence) => [occurrence.event_id, occurrence]));
    for (const entry of FAILED.cases) {
      expect(entry.occurrences.length).toBeGreaterThan(0);
      for (const occurrence of entry.occurrences) {
        const source = byId.get(occurrence.event_id);
        expect(source).toBeDefined();
        expect(occurrence).toEqual(source);
        expect(occurrence.line).toBeGreaterThan(0);
      }
      expect(entry.first_event_id).toBe(entry.occurrences[0]?.event_id);
      expect(entry.last_event_id).toBe(entry.occurrences[entry.occurrences.length - 1]?.event_id);
      expect(entry.first_line).toBe(entry.occurrences[0]?.line);
      expect(entry.last_line).toBe(entry.occurrences[entry.occurrences.length - 1]?.line);
    }
  });

  it("quotes the tool_error case with both of its occurrences, in file order", () => {
    const entry = FAILED.cases[0];
    expect(entry?.error_type).toBe("tool_error");
    expect(entry?.occurrences.map((occurrence) => occurrence.line)).toEqual([16, 23]);
    expect(entry?.occurrences.map((occurrence) => occurrence.event_id)).toEqual(["evt_000016", "evt_000023"]);
    expect(entry?.occurrences.map((occurrence) => occurrence.related_event_id)).toEqual(["evt_000015", "evt_000022"]);
  });

  it("names the tools that produced a class and leaves the list empty when none did", () => {
    expect(FAILED.cases.find((entry) => entry.error_type === "command_failed")?.tools).toEqual(["run_command"]);
    expect(FAILED.cases.find((entry) => entry.error_type === "file_not_found")?.tools).toEqual(["read_file"]);
    expect(FAILED.cases.find((entry) => entry.error_type === "rate_limited")?.tools).toEqual([]);
  });

  it("counts fatal only among the occurrences the case carries", () => {
    const events = [
      loaded(1, "evt_000001", "error.recorded", { error: { type: "boom", message: "first" } }),
      loaded(2, "evt_000002", "error.recorded", { error: { type: "boom", message: "second" }, fatal: true }),
    ];
    const entry = evalGenOf(events).cases[0];
    expect(entry?.count).toBe(2);
    expect(entry?.fatal).toBe(1);
  });
});

describe("eval-gen: refusals are not cases", () => {
  it("leaves out a class whose every occurrence was a refusal and names it instead", () => {
    expect(FAILED.skipped_refusals).toEqual(["guardrail_refusal"]);
    expect(FAILED.cases.some((entry) => entry.error_type === "guardrail_refusal")).toBe(false);
  });

  it("keeps the real failures of a class that also had a refusal", () => {
    const events = [
      loaded(1, "evt_000001", "tool.call.failed", {
        tool: "read_file",
        status: "failed",
        error: { type: "blocked", message: "too many reads" },
        duration_ms: 1,
        guardrail_refusal: true,
      }),
      loaded(2, "evt_000002", "tool.call.failed", {
        tool: "read_file",
        status: "failed",
        error: { type: "blocked", message: "disk error" },
        duration_ms: 2,
      }),
    ];
    const generated = evalGenOf(events);
    expect(generated.skipped_refusals).toEqual([]);
    expect(generated.cases).toHaveLength(1);
    const entry = generated.cases[0];
    expect(entry?.error_type).toBe("blocked");
    // The refusal is on line 1 and the real failure on line 2, so a first/last taken from
    // the class rather than from the case would point at the refusal.
    expect(entry?.count).toBe(1);
    expect(entry?.first_line).toBe(2);
    expect(entry?.last_line).toBe(2);
    expect(entry?.occurrences.map((occurrence) => occurrence.event_id)).toEqual(["evt_000002"]);
  });

  it("counts a refusal-only class as skipped even when it is the only failure in the file", () => {
    const events = [
      loaded(1, "evt_000001", "tool.call.failed", {
        tool: "run_command",
        status: "failed",
        error: { type: "guardrail_refusal", message: "blocked on purpose" },
        duration_ms: 1,
        guardrail_refusal: true,
      }),
    ];
    const generated = evalGenOf(events);
    expect(generated.cases).toEqual([]);
    expect(generated.skipped_refusals).toEqual(["guardrail_refusal"]);
    expect(generated.refusals).toBe(1);
    expect(generated.errors).toBe(0);
  });
});

describe("eval-gen: the scenario field", () => {
  it("reads input_summary from run.started and stays null when the recorder wrote none", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", { input_summary: "do the thing" }),
      loaded(2, "evt_000002", "run.failed", { status: "failed", error: { type: "x", message: "y" } }),
    ];
    expect(readInputSummary(events)).toBe("do the thing");
    expect(evalGenOf(events).input_summary).toBe("do the thing");

    const without = [loaded(1, "evt_000001", "run.failed", { status: "failed", error: { type: "x", message: "y" } })];
    expect(readInputSummary(without)).toBeNull();
    expect(evalGenOf(without).input_summary).toBeNull();
  });

  it("takes the first run.started when a file carries more than one", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", { input_summary: "first" }, "run_a"),
      loaded(2, "evt_000002", "run.started", { input_summary: "second" }, "run_a"),
    ];
    expect(readInputSummary(events)).toBe("first");
  });
});

describe("eval-gen: rendering", () => {
  it("prints a stable top-level key order in --json mode", () => {
    expect(Object.keys(JSON.parse(renderEvalGenJson(FAILED)))).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "status",
      "input_summary",
      "events",
      "failures",
      "errors",
      "refusals",
      "cases",
      "skipped_refusals",
    ]);
  });

  it("keeps one key order inside a case too", () => {
    expect(Object.keys(FAILED.cases[0] ?? {})).toEqual([
      "case_id",
      "error_type",
      "expectation",
      "count",
      "fatal",
      "sources",
      "tools",
      "first_line",
      "last_line",
      "first_event_id",
      "last_event_id",
      "occurrences",
    ]);
  });

  it("produces the same bytes twice in both output modes", () => {
    for (const render of [renderEvalGenText, renderEvalGenJson]) {
      expect(render(FAILED)).toBe(render(FAILED));
    }
  });

  it("prints every case row with its evidence, and the skipped refusals at the end", () => {
    const text = renderEvalGenText(FAILED);
    expect(text).toContain("cases     5");
    expect(text).toContain("case_001  tool_error");
    expect(text).toContain("16:evt_000016, 23:evt_000023");
    expect(text).toContain("skipped refusals  guardrail_refusal");
  });

  it("says so when there is nothing to generate", () => {
    expect(renderEvalGenText(SPIKE)).toContain("(no cases)");
    expect(renderEvalGenText(SPIKE)).toContain("skipped refusals  none");
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what the
 * command prints is a documentation bug that reads as a feature, so it is compared here
 * rather than trusted.
 */
describe("eval-gen: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace eval-gen FILE"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(renderEvalGenText(FAILED));
  });
});
