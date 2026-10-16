import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { buildCompare } from "../src/compare.js";
import {
  COMPARE_NO_MODEL_NOTE,
  buildCompareDraft,
  withCompareModelResult,
  withSkippedModel,
  withoutModel,
} from "../src/compareModel.js";
import type { CompareWithModel } from "../src/compareModel.js";
import { parseModelAnswer } from "../src/model/answer.js";
import { ANSWER_CONTRACT, COMPARE_TASK } from "../src/model/contract.js";
import { COMPARE_EVIDENCE_LABEL } from "../src/model/contract.js";
import { renderCompareText } from "../src/report.js";
import type { ModelResult } from "../src/model/types.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function draftOf(a: string, b: string, options: { maxExcerptEvents?: number; sendPaths?: boolean } = {}) {
  const eventsA = load(a);
  const eventsB = load(b);
  const report = buildCompare(`examples/${a}`, `examples/${b}`, "bundled", eventsA, eventsB);
  return buildCompareDraft(report, eventsA, eventsB, {
    maxExcerptEvents: options.maxExcerptEvents ?? 50,
    sendPaths: options.sendPaths ?? false,
  });
}

/** Every event id of a file, in file order, so anchors can be checked against it. */
function idsOf(name: string): string[] {
  return load(name)
    .map((loaded) => (loaded.event as { event_id?: unknown }).event_id)
    .filter((id): id is string => typeof id === "string");
}

const SUCCESS_IDS = idsOf("success.jsonl");
const FAILED_IDS = idsOf("failed.jsonl");

let clock = 0;

/** One loaded event with a rising timestamp, so a fixture reads like a real run. */
function event(line: number, eventId: string, type: string, payload: unknown, runId = "run_01"): LoadedEvent {
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

/**
 * Two runs that failed the same way and ended differently: one completed, one was
 * cancelled. The only thing that moved is the status, which is the case where a
 * count-only reading of the tables would call the pair identical.
 */
function statusOnlyPair(): { a: LoadedEvent[]; b: LoadedEvent[] } {
  const a = [
    event(1, "evt_000001", "run.started", { task: "t" }),
    event(2, "evt_000002", "error.recorded", { error: { type: "boom", message: "boom happened" }, fatal: false }),
    event(3, "evt_000003", "run.finished", { status: "completed" }),
  ];
  const b = [
    event(1, "evt_000001", "run.started", { task: "t" }),
    event(2, "evt_000002", "error.recorded", { error: { type: "boom", message: "boom happened" }, fatal: false }),
    event(3, "evt_000003", "run.cancelled", { status: "cancelled", reason: "stopped" }),
  ];
  return { a, b };
}

describe("compare --model: observations", () => {
  it("restates every moved row once per side, each anchored to a real event of that side", () => {
    const { report, request } = draftOf("success.jsonl", "failed.jsonl");
    expect(request).not.toBeNull();
    if (request === null) {
      return;
    }
    const observations = request.observations;
    // run_command never appears in the successful trace, so it carries one observation
    // rather than two: a side with no event there has nothing to anchor to.
    expect(observations).toHaveLength(11);
    // 2 for the status change, 6 error classes on the b side only, 2 tools on both sides.
    expect(observations.map((observation) => observation.kind)).toEqual([
      "status_change",
      "status_change",
      ...Array<string>(6).fill("error_class"),
      "tool_failure",
      "tool_failure",
      "tool_failure",
    ]);
    for (const observation of observations) {
      expect(observation.id).toMatch(/^obs_\d+$/);
      expect(observation.event_id).not.toBeNull();
      expect(observation.line).not.toBeNull();
      expect(observation.statement.length).toBeGreaterThan(0);
    }
    // Every anchor is a real event of the side it names, and the line matches.
    for (const observation of observations) {
      const side = observation.side;
      const ids = side === "a" ? SUCCESS_IDS : FAILED_IDS;
      expect(ids).toContain(observation.event_id);
      const loaded = load(side === "a" ? "success.jsonl" : "failed.jsonl").find(
        (entry) => (entry.event as { event_id?: unknown }).event_id === observation.event_id,
      );
      expect(loaded?.line).toBe(observation.line);
    }
  });

  it("anchors a status change to both terminal events rather than to neither", () => {
    const { request } = draftOf("success.jsonl", "cancelled.jsonl");
    expect(request).not.toBeNull();
    if (request === null) {
      return;
    }
    const status = request.observations.filter((observation) => observation.kind === "status_change");
    expect(status).toHaveLength(2);
    expect(status.map((observation) => observation.side)).toEqual(["a", "b"]);
    // The terminal events are real and citable, so the model is never asked to explain
    // a status change while being given nothing it may cite.
    expect(SUCCESS_IDS).toContain(status[0]?.event_id);
    expect(idsOf("cancelled.jsonl")).toContain(status[1]?.event_id);
    expect(request.events.length).toBe(2);
  });

  it("says nothing about a row that did not move", () => {
    const { request } = draftOf("failed.jsonl", "failed.jsonl");
    expect(request).toBeNull();
  });

  it("names only the failing side for a class the other trace never had", () => {
    const { request } = draftOf("success.jsonl", "failed.jsonl");
    expect(request).not.toBeNull();
    if (request === null) {
      return;
    }
    const toolError = request.observations.filter((observation) => observation.statement.includes("tool_error"));
    expect(toolError).toHaveLength(1);
    expect(toolError[0]?.side).toBe("b");
    expect(toolError[0]?.statement).toContain("is new");
    expect(toolError[0]?.statement).toContain("0 in a, 2 in b");
  });
});

describe("compare --model: the request", () => {
  it("quotes the cited events with their side, one entry per side per event", () => {
    const { request } = draftOf("success.jsonl", "failed.jsonl");
    expect(request).not.toBeNull();
    if (request === null) {
      return;
    }
    // Eleven anchored observations, ten quoted events: the failing trace's terminal
    // event carries both the status change and the last error class, and it is quoted
    // once rather than twice.
    expect(request.observations).toHaveLength(11);
    expect(request.events).toHaveLength(10);
    const quoted = new Set(request.events.map((entry) => `${entry.side}:${entry.event_id}`));
    expect(quoted.size).toBe(request.events.length);
    for (const event of request.events) {
      expect(["a", "b"]).toContain(event.side);
      expect(event.side === "a" ? SUCCESS_IDS : FAILED_IDS).toContain(event.event_id);
      expect(event.payload).toBeTypeOf("object");
    }
    // Every quoted event is one an observation cites, and nothing else is.
    for (const observation of request.observations) {
      expect(quoted.has(`${observation.side}:${observation.event_id}`)).toBe(true);
    }
    // Side a is quoted before side b, and inside a side the file order holds.
    const sides = request.events.map((event) => event.side);
    expect(sides).toEqual([...sides].sort());
  });

  it("carries the compare task statement and the same answer contract explain uses", () => {
    const { request } = draftOf("success.jsonl", "failed.jsonl");
    expect(request).not.toBeNull();
    if (request === null) {
      return;
    }
    // Byte equality rather than a substring: the statement is a compile-time constant,
    // and a check that only looked for the evidence convention inside it would let
    // anything ride along in the rest of the text.
    expect(request.task).toBe(COMPARE_TASK);
    expect(request.output_contract).toEqual(ANSWER_CONTRACT);
  });

  it("leaves both file paths out unless --send-paths is given", () => {
    const without = draftOf("success.jsonl", "failed.jsonl");
    expect(without.request?.file_a).toBeNull();
    expect(without.request?.file_b).toBeNull();
    const withPaths = draftOf("success.jsonl", "failed.jsonl", { sendPaths: true });
    expect(withPaths.request?.file_a).toBe("examples/success.jsonl");
    expect(withPaths.request?.file_b).toBe("examples/failed.jsonl");
  });

  it("accepts side-qualified ids from both files and refuses a bare one", () => {
    const { knownEventIds } = draftOf("success.jsonl", "failed.jsonl");
    // Both traces carry evt_000001, so both references exist and neither is the other.
    expect(knownEventIds.has("a:evt_000001")).toBe(true);
    expect(knownEventIds.has("b:evt_000001")).toBe(true);
    expect(knownEventIds.has("evt_000001")).toBe(false);

    const bare = parseModelAnswer(
      JSON.stringify({
        findings: [{ severity: "info", evidence: ["evt_000013"], claim: "x", confidence: "low", suggestion: "y" }],
      }),
      knownEventIds,
      COMPARE_EVIDENCE_LABEL,
    );
    expect(bare.ok).toBe(false);
    if (bare.ok) {
      return;
    }
    expect(bare.kind).toBe("unknown_evidence");
    expect(bare.message).toBe(`findings[0] cites evidence that is not in ${COMPARE_EVIDENCE_LABEL}: evt_000013`);

    const qualified = parseModelAnswer(
      JSON.stringify({
        findings: [{ severity: "info", evidence: ["b:evt_000013"], claim: "x", confidence: "low", suggestion: "y" }],
      }),
      knownEventIds,
      COMPARE_EVIDENCE_LABEL,
    );
    expect(qualified.ok).toBe(true);
  });

  it("names the events it did not quote instead of dropping them", () => {
    const { report, request } = draftOf("success.jsonl", "failed.jsonl", { maxExcerptEvents: 3 });
    expect(request).not.toBeNull();
    if (request === null) {
      return;
    }
    expect(request.events).toHaveLength(3);
    expect(report.unverified.some((note) => note.startsWith("only the first 3 cited events were quoted"))).toBe(true);
    expect(report.unverified.join(" ")).toContain(
      "b:evt_000013, b:evt_000015, b:evt_000016, b:evt_000018, b:evt_000021, b:evt_000022, b:evt_000026 are named but not quoted",
    );
  });
});

describe("compare --model: the deterministic half", () => {
  it("states what a comparison of failure profiles does not establish", () => {
    const { report } = draftOf("success.jsonl", "failed.jsonl");
    expect(report.unverified).toContain("the comparison does not establish why a class or a tool moved, only that it did");
    expect(report.unverified.some((note) => note.startsWith("events that did not fail are not part"))).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.model.enabled).toBe(false);
  });

  it("says so when neither trace failed, and when only the status moved", () => {
    const clean = draftOf("success.jsonl", "spike-run.jsonl");
    expect(clean.report.unverified).toContain("neither trace records a failure, so there is no failure profile to explain");

    const { a, b } = statusOnlyPair();
    const report = buildCompare("a.jsonl", "b.jsonl", "bundled", a, b);
    const statusOnly = buildCompareDraft(report, a, b, { maxExcerptEvents: 50, sendPaths: false });
    // One failure on each side, the same class, a different terminal status: nothing in
    // the tables moved, and the report has to say so rather than stay silent.
    expect(statusOnly.report.differences).toBe(1);
    expect(statusOnly.report.unverified.some((note) => note.startsWith("only the run status moved"))).toBe(true);
    expect(statusOnly.request).not.toBeNull();
    expect(statusOnly.request?.observations.every((observation) => observation.kind === "status_change")).toBe(true);
    expect(statusOnly.request?.events).toHaveLength(2);
  });

  it("builds no request when there is nothing anchored to ask about", () => {
    const identical = draftOf("failed.jsonl", "failed.jsonl");
    expect(identical.request).toBeNull();
    expect(identical.skipReason).toContain("no observation is anchored to an event");
    expect(identical.report.unverified).toContain(
      "the two failure profiles are identical, so there is no difference for a model to read",
    );
  });

  it("appends the no-model note only when no model was asked for", () => {
    const { report } = draftOf("success.jsonl", "failed.jsonl");
    const withNote: CompareWithModel = withoutModel(draftOf("success.jsonl", "failed.jsonl"));
    expect(withNote.unverified.at(-1)).toBe(COMPARE_NO_MODEL_NOTE);
    expect(report.unverified.at(-1)).not.toBe(COMPARE_NO_MODEL_NOTE);
  });
});

describe("compare --model: folding one attempt in", () => {
  const base = (): CompareWithModel => draftOf("success.jsonl", "failed.jsonl").report;

  const success: ModelResult = {
    ok: true,
    provider: "openai-compatible",
    model: "stub-model",
    requests: 1,
    sent_events: 16,
    request_bytes: 4096,
    redacted_fields: 0,
    findings: [
      {
        id: "find_1",
        severity: "warning",
        evidence: ["b:evt_000013"],
        claim: "the loop guard blocked the repeated read in the candidate only",
        confidence: "medium",
        suggestion: "check why the file is read twice",
      },
    ],
    unverified: ["the quoted events do not say why the read repeated"],
  };

  it("keeps the deterministic report and adds the findings on success", () => {
    const report = base();
    const folded = withCompareModelResult(report, success);
    expect(folded.findings.map((finding) => finding.evidence)).toEqual([["b:evt_000013"]]);
    expect(folded.model.ok).toBe(true);
    expect(folded.model.requests).toBe(1);
    expect(folded.model.sent_events).toBe(16);
    expect(folded.model.request_bytes).toBe(4096);
    // The model's own gaps are kept apart from the deterministic ones, not merged in.
    expect(folded.model.unverified).toEqual(["the quoted events do not say why the read repeated"]);
    expect(folded.unverified).toEqual(report.unverified);
    // The deterministic verdict is untouched by what the model said.
    expect(folded.identical).toBe(false);
    expect(folded.differences).toBe(9);
  });

  it("keeps the deterministic report and records the failure when the model half fails", () => {
    const report = base();
    const folded = withCompareModelResult(report, {
      ok: false,
      kind: "http_error",
      message: "the provider answered HTTP 500",
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 16,
      request_bytes: 4096,
      redacted_fields: 0,
    });
    expect(folded.findings).toEqual([]);
    expect(folded.model.ok).toBe(false);
    expect(folded.model.error).toEqual({ kind: "http_error", message: "the provider answered HTTP 500" });
    expect(folded.unverified).toEqual(report.unverified);
    expect(folded.differences).toBe(9);
  });

  it("records a skipped call as a no-op rather than a failure", () => {
    const folded = withSkippedModel(base(), "nothing anchored to ask about", "openai-compatible", "stub-model");
    expect(folded.model.enabled).toBe(true);
    expect(folded.model.ok).toBe(true);
    expect(folded.model.requests).toBe(0);
    expect(folded.model.sent_events).toBe(0);
    expect(folded.model.skipped).toBe("nothing anchored to ask about");
    expect(folded.model.error).toBeNull();
    expect(folded.findings).toEqual([]);
  });
});

describe("compare --model: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace compare FILE FILE --model"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    const text = block?.[1] ?? "";
    // The deterministic half is byte-compared against what the command prints without
    // --model, up to the point where the model's findings begin.
    const without = renderCompareText(withoutModel(draftOf("success.jsonl", "failed.jsonl")));
    expect(text.startsWith(without.slice(0, without.indexOf("\nfindings\n")))).toBe(true);
    // The model half is checked for the facts a reader relies on rather than byte for
    // byte, because its byte count depends on the provider's answer.
    expect(text).toContain("find_1  warning  confidence medium  evidence b:evt_000013");
    expect(text).toContain("find_2  error  confidence high  evidence b:evt_000022");
    expect(text).toContain("provider         openai-compatible");
    expect(text).toContain("model            stub-model");
    expect(text).toContain("requests         1");
    expect(text).toContain("events sent      10");
    expect(text.endsWith("compare: 9 differences in the failure profile\n")).toBe(true);
  });
});
