import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asRecord, asText } from "../src/analyze.js";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { buildErrors } from "../src/errors.js";
import { buildFixSuggest, FIX_RULES } from "../src/fixSuggest.js";
import type { FixSuggestReport } from "../src/fixSuggest.js";
import { renderFixSuggestJson, renderFixSuggestText } from "../src/report.js";
import { buildFixSuggestDraft, withoutFixSuggestModel } from "../src/fixSuggestModel.js";
import { renderFixSuggestModelText } from "../src/report.js";
import { DEFAULT_MAX_EXCERPT_EVENTS } from "../src/model/config.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function reportOf(name: string): FixSuggestReport {
  const events = load(name);
  return buildFixSuggest(buildErrors(`examples/${name}`, "bundled", events), events);
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

function suggest(events: LoadedEvent[]): FixSuggestReport {
  return buildFixSuggest(buildErrors("fixture", "bundled", events), events);
}

/** One failure event. `extra` carries the fields only some event types have. */
function failure(line: number, eventId: string, errorType: string, extra: Record<string, unknown> = {}): LoadedEvent {
  return loaded(line, eventId, "error.recorded", { error: { type: errorType, message: `${errorType} happened` }, ...extra });
}

const FAILED = reportOf("failed.jsonl");

describe("fix-suggest: suggestions from a real trace", () => {
  it("hand-checks the suggestion list of the real failed trace", () => {
    expect(FAILED.suggestions.map((entry) => entry.suggestion_id)).toEqual(["sug_001", "sug_002", "sug_003", "sug_004"]);
    expect(FAILED.suggestions.map((entry) => entry.rule)).toEqual([
      "repeated_error_class",
      "tool_failure",
      "tool_failure",
      "guardrail_refusals",
    ]);
    expect(FAILED.suggestions.map((entry) => entry.error_type ?? entry.tool ?? "the run")).toEqual([
      "tool_error",
      "read_file",
      "run_command",
      "the run",
    ]);
    expect(FAILED.suggestions.map((entry) => entry.count)).toEqual([2, 1, 1, 1]);
  });

  it("repeats the header the errors report carries, so the two reconcile", () => {
    expect(FAILED.file).toBe("examples/failed.jsonl");
    expect(FAILED.schema).toBe("bundled");
    expect(FAILED.run_id).toBe("run_02");
    expect(FAILED.status).toBe("failed");
    expect(FAILED.input_summary).toBe("Summarize the files in notes/ and write report.md");
    expect(FAILED.events).toBe(26);
    expect(FAILED.failures).toBe(7);
    expect(FAILED.errors).toBe(6);
    expect(FAILED.refusals).toBe(1);
  });

  it("keeps every counter of every suggestion equal to the evidence listed beside it", () => {
    for (const suggestion of FAILED.suggestions) {
      expect(suggestion.count).toBe(suggestion.evidence.length);
      expect(suggestion.fatal).toBe(suggestion.evidence.filter((entry) => entry.fatal === true).length);
      expect(suggestion.first_line).toBe(suggestion.evidence[0]?.line ?? null);
      expect(suggestion.last_line).toBe(suggestion.evidence[suggestion.evidence.length - 1]?.line ?? null);
    }
  });

  it("cites only events the file really carries, with the line and id errors reports", () => {
    const byId = new Map(load("failed.jsonl").map((entry) => [asText(asRecord(entry.event)?.event_id) ?? "", entry]));
    for (const suggestion of FAILED.suggestions) {
      for (const evidence of suggestion.evidence) {
        const found = byId.get(evidence.event_id);
        expect(found).toBeDefined();
        expect(found?.line).toBe(evidence.line);
        expect(asText(asRecord(found?.event)?.type)).toBe(evidence.event);
      }
    }
  });

  it("says what every suggestion rests on and what it does not establish", () => {
    for (const suggestion of FAILED.suggestions) {
      expect(suggestion.basis.length).toBeGreaterThan(0);
      expect(suggestion.does_not_establish.length).toBeGreaterThan(0);
      expect(suggestion.does_not_establish).not.toBe(suggestion.basis);
      expect(FIX_RULES).toContain(suggestion.rule);
    }
  });

  it("counts a refused call apart from a failed one and says so in the basis", () => {
    const readFile = FAILED.suggestions.find((entry) => entry.tool === "read_file");
    expect(readFile?.count).toBe(1);
    expect(readFile?.basis).toBe("read_file has 1 failed call in this trace, plus 1 refused call reported apart");
    // The refusal is its own suggestion, not part of the tool's failure count.
    const refusals = FAILED.suggestions.find((entry) => entry.rule === "guardrail_refusals");
    expect(refusals?.evidence.map((entry) => entry.event_id)).toEqual(["evt_000013"]);
  });

  it("names the denied permission of the cancelled trace, with who denied it", () => {
    const cancelled = reportOf("cancelled.jsonl");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.suggestions.map((entry) => entry.rule)).toEqual(["permission_denied"]);
    expect(cancelled.suggestions[0]?.title).toBe("1 permission request was denied");
    expect(cancelled.suggestions[0]?.evidence).toEqual([
      {
        line: 7,
        event_id: "evt_000007",
        event: "permission.resolved",
        note: "permission denied by user",
        fatal: null,
      },
    ]);
  });

  it("produces no suggestion for a trace with no pattern, and says that is not an all-clear", () => {
    for (const name of ["success.jsonl", "spike-run.jsonl"]) {
      const report = reportOf(name);
      expect(report.suggestions).toEqual([]);
      expect(report.unverified).toContain(
        "the trace records no pattern this slice knows how to suggest about, which is not a claim that the run was healthy",
      );
    }
  });

  it("says nothing about whether a model was called, because that is the invocation's business", () => {
    for (const name of ["success.jsonl", "cancelled.jsonl", "failed.jsonl", "spike-run.jsonl"]) {
      // Whether a model answered is a fact about how the command was run, not about how
      // the suggestions were derived, so the deterministic report does not claim either
      // way. The CLI appends the note when no --model was passed.
      expect(reportOf(name).unverified.join("\n")).not.toContain("no model was called");
    }
  });
});

describe("fix-suggest: the rules", () => {
  it("reports a run with no terminal event first, anchored to the last event in the file", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", { input_summary: "do the thing" }),
      failure(2, "evt_000002", "boom"),
      failure(3, "evt_000003", "boom"),
    ];
    const report = suggest(events);
    expect(report.status).toBe("incomplete");
    expect(report.suggestions.map((entry) => entry.rule)).toEqual(["incomplete_run", "repeated_error_class"]);
    expect(report.suggestions[0]?.title).toBe("the trace has no terminal event");
    expect(report.suggestions[0]?.evidence).toEqual([
      { line: 3, event_id: "evt_000003", event: "error.recorded", note: "the last event in the file", fatal: null },
    ]);
    expect(report.suggestions[0]?.basis).toContain("none of them is run.finished, run.failed or run.cancelled");
  });

  it("reports a reference that points at an event the file does not carry", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", {}),
      failure(2, "evt_000002", "broken_ref", { related_event_id: "evt_999" }),
      loaded(3, "evt_000003", "run.failed", { error: { type: "task_failed", message: "gave up" } }),
    ];
    const report = suggest(events);
    expect(report.suggestions.map((entry) => entry.rule)).toEqual(["dangling_reference"]);
    expect(report.suggestions[0]?.basis).toBe("line 2: evt_000002 points at evt_999");
    expect(report.suggestions[0]?.evidence[0]?.note).toBe("points at evt_999, which no event in the file claims");
  });

  it("suggests the fatal occurrences alone, and only when there are any", () => {
    const fatalEvents = [
      loaded(1, "evt_000001", "run.started", {}),
      failure(2, "evt_000002", "boom", { fatal: true }),
      failure(3, "evt_000003", "boom", { fatal: false }),
      loaded(4, "evt_000004", "run.failed", { error: { type: "boom", message: "gave up" } }),
    ];
    const report = suggest(fatalEvents);
    const fatal = report.suggestions.find((entry) => entry.rule === "fatal_failure");
    expect(fatal?.count).toBe(1);
    expect(fatal?.fatal).toBe(1);
    expect(fatal?.title).toBe("1 occurrence of boom was recorded fatal");
    expect(fatal?.evidence.map((entry) => entry.event_id)).toEqual(["evt_000002"]);
    expect(fatal?.basis).toBe("class boom has 1 fatal occurrence of 3 in this trace");
    // The same class also repeated, which is a second suggestion over all three.
    const repeated = report.suggestions.find((entry) => entry.rule === "repeated_error_class");
    expect(repeated?.count).toBe(3);
    expect(report.suggestions.map((entry) => entry.rule)).toEqual(["fatal_failure", "repeated_error_class"]);
  });

  it("does not repeat a class that occurred once", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", {}),
      failure(2, "evt_000002", "once"),
      loaded(3, "evt_000003", "run.finished", {}),
    ];
    expect(suggest(events).suggestions).toEqual([]);
  });

  it("orders failing tools by how often they failed, then by name", () => {
    const events = [
      loaded(1, "evt_000001", "run.started", {}),
      loaded(2, "evt_000002", "tool.call.failed", { tool: "alpha", error: { type: "x", message: "no" } }),
      loaded(3, "evt_000003", "tool.call.failed", { tool: "beta", error: { type: "y", message: "no" } }),
      loaded(4, "evt_000004", "tool.call.failed", { tool: "beta", error: { type: "z", message: "no" } }),
      loaded(5, "evt_000005", "run.finished", {}),
    ];
    const report = suggest(events);
    expect(report.suggestions.map((entry) => entry.tool)).toEqual(["beta", "alpha"]);
    expect(report.suggestions[0]?.title).toBe("the tool beta failed 2 times");
    expect(report.suggestions[1]?.title).toBe("the tool alpha failed 1 time");
  });

  it("ignores an approved permission and counts each denied one", () => {
    const base = [
      loaded(1, "evt_000001", "run.started", {}),
      loaded(2, "evt_000002", "permission.resolved", { decision: "approved", decided_by: "user" }),
      loaded(3, "evt_000003", "run.finished", {}),
    ];
    expect(suggest(base).suggestions).toEqual([]);

    const denied = suggest([
      ...base.slice(0, 2),
      loaded(3, "evt_000003", "permission.resolved", { decision: "denied" }),
      loaded(4, "evt_000004", "permission.resolved", { decision: "denied", decided_by: "policy" }),
      loaded(5, "evt_000005", "run.finished", {}),
    ]);
    expect(denied.suggestions.map((entry) => entry.rule)).toEqual(["permission_denied"]);
    expect(denied.suggestions[0]?.count).toBe(2);
    expect(denied.suggestions[0]?.title).toBe("2 permission requests were denied");
    // A denial with no decider reads as a denial, not as a missing field.
    expect(denied.suggestions[0]?.evidence.map((entry) => entry.note)).toEqual([
      "permission denied",
      "permission denied by policy",
    ]);
  });
});

describe("fix-suggest: the report", () => {
  it("prints the same bytes twice in both output modes", () => {
    for (const extra of [[], ["--json"]]) {
      const first = buildFixSuggest(buildErrors("f", "bundled", load("failed.jsonl")), load("failed.jsonl"));
      const second = buildFixSuggest(buildErrors("f", "bundled", load("failed.jsonl")), load("failed.jsonl"));
      const render = extra.length === 0 ? renderFixSuggestText : renderFixSuggestJson;
      expect(render(first)).toBe(render(second));
    }
  });

  it("keeps the terminal report and the JSON report about the same suggestions", () => {
    const text = renderFixSuggestText(FAILED);
    for (const suggestion of FAILED.suggestions) {
      expect(text).toContain(suggestion.suggestion_id);
      expect(text).toContain(suggestion.rule);
      expect(text).toContain(suggestion.action);
      expect(text).toContain(suggestion.does_not_establish);
    }
    expect(Object.keys(JSON.parse(renderFixSuggestJson(FAILED)))).toEqual([
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
      "suggestions",
      "unverified",
    ]);
    expect(Object.keys(JSON.parse(renderFixSuggestJson(FAILED)).suggestions[0])).toEqual([
      "suggestion_id",
      "rule",
      "title",
      "action",
      "error_type",
      "tool",
      "count",
      "fatal",
      "first_line",
      "last_line",
      "first_event_id",
      "last_event_id",
      "evidence",
      "basis",
      "does_not_establish",
    ]);
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what the
 * command prints is a documentation bug that reads as a feature, so it is compared here
 * rather than trusted.
 */
describe("fix-suggest: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace fix-suggest FILE"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(
      renderFixSuggestModelText(
        withoutFixSuggestModel(
          buildFixSuggestDraft(FAILED, load("failed.jsonl"), {
            maxExcerptEvents: DEFAULT_MAX_EXCERPT_EVENTS,
            sendPaths: false,
          }),
        ),
      ),
    );
  });
});
