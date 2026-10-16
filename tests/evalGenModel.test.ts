import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { buildErrors } from "../src/errors.js";
import { buildEvalGen, readInputSummary } from "../src/evalGen.js";
import type { EvalGenReport } from "../src/evalGen.js";
import {
  EVAL_GEN_NO_MODEL_NOTE,
  buildEvalGenDraft,
  withEvalGenModelResult,
  withEvalGenSkippedModel,
  withoutEvalGenModel,
} from "../src/evalGenModel.js";
import type { EvalGenWithModel } from "../src/evalGenModel.js";
import { renderEvalGenJson, renderEvalGenModelJson, renderEvalGenModelText, renderEvalGenText } from "../src/report.js";
import type { ModelResult } from "../src/model/types.js";
import { projectRoot } from "./helpers.js";

function load(name: string): LoadedEvent[] {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function reportOf(name: string): EvalGenReport {
  const events = load(name);
  return buildEvalGen(buildErrors(`examples/${name}`, "bundled", events), readInputSummary(events));
}

function draftOf(name: string, maxExcerptEvents = 50): ReturnType<typeof buildEvalGenDraft> {
  return buildEvalGenDraft(reportOf(name), load(name), { maxExcerptEvents, sendPaths: false });
}

let clock = 0;

/** Builds one loaded event. The timestamp advances so a fixture reads like a real run. */
function loaded(line: number, eventId: string, type: string, payload: unknown): LoadedEvent {
  clock += 1;
  return {
    line,
    event: {
      schema_version: "1",
      event_id: eventId,
      timestamp: new Date(Date.parse("2026-10-14T10:00:00.000Z") + clock).toISOString(),
      type,
      run_id: "run_01",
      payload,
    },
  };
}

/** A trace whose only failure has no terminal event, so `status` is `incomplete`. */
function incompleteTrace(): LoadedEvent[] {
  return [
    loaded(1, "evt_000001", "run.started", { input_summary: "do a thing" }),
    loaded(
      2,
      "evt_000002",
      "error.recorded",
      { error: { type: "boom", message: "it broke" }, fatal: true },
    ),
  ];
}

const FAILED = reportOf("failed.jsonl");

describe("eval-gen --model: one observation per case", () => {
  const draft = draftOf("failed.jsonl");

  it("restates every case, in the class order the report already uses", () => {
    expect(draft.report.cases).toHaveLength(5);
    expect(draft.request?.observations.map((observation) => observation.id)).toEqual([
      "obs_001",
      "obs_002",
      "obs_003",
      "obs_004",
      "obs_005",
    ]);
  });

  it("anchors each observation to the first occurrence the case carries", () => {
    const observations = draft.request?.observations ?? [];
    expect(observations[0]?.event_id).toBe("evt_000016");
    expect(observations[0]?.line).toBe(16);
    expect(observations[1]?.event_id).toBe("evt_000022");
    expect(observations[2]?.event_id).toBe("evt_000015");
    expect(observations[3]?.event_id).toBe("evt_000018");
    expect(observations[4]?.event_id).toBe("evt_000026");
  });

  it("quotes the case's own expectation rather than paraphrasing it", () => {
    const observations = draft.request?.observations ?? [];
    for (const [index, entry] of draft.report.cases.entries()) {
      expect(observations[index]?.statement).toContain(entry.expectation);
      expect(observations[index]?.statement).toContain(entry.case_id);
    }
    // The counts and both anchors are stated too, because a case is those together and
    // a model shown only the sentence would have to guess at the evidence.
    expect(observations[0]?.statement).toContain("2 occurrences, 0 fatal");
    expect(observations[0]?.statement).toContain("from error.recorded x2");
    expect(observations[0]?.statement).toContain("first at line 16 (evt_000016)");
    expect(observations[0]?.statement).toContain("last at line 23 (evt_000023)");
  });

  it("names the tools a case carried", () => {
    const observations = draft.request?.observations ?? [];
    expect(observations[1]?.statement).toContain("tools run_command");
    expect(observations[0]?.statement).not.toContain("tools");
  });
});

describe("eval-gen --model: the excerpt", () => {
  it("quotes exactly the events the cases cite, in file order, and nothing else", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.request?.events.map((event) => event.event_id)).toEqual([
      "evt_000015",
      "evt_000016",
      "evt_000018",
      "evt_000022",
      "evt_000023",
      "evt_000026",
    ]);
    expect(draft.report.model.sent_events).toBe(6);
  });

  it("quotes the payload as the recorder wrote it", () => {
    const draft = draftOf("failed.jsonl");
    const event = draft.request?.events.find((entry) => entry.event_id === "evt_000016");
    expect(event?.type).toBe("error.recorded");
    expect(event?.line).toBe(16);
    expect(event?.payload).toMatchObject({ fatal: false });
  });

  it("names the events past --max-excerpt instead of quoting them", () => {
    const draft = draftOf("failed.jsonl", 3);
    expect(draft.request?.events.map((event) => event.event_id)).toEqual(["evt_000015", "evt_000016", "evt_000018"]);
    expect(draft.report.unverified).toContain(
      "only the first 3 cited events were quoted; evt_000022, evt_000023, evt_000026 are named but not quoted",
    );
  });

  it("lets a finding cite any event in the trace, not only the quoted ones", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.knownEventIds.has("evt_000013")).toBe(true);
    expect(draft.knownEventIds.has("evt_999999")).toBe(false);
  });
});

describe("eval-gen --model: what the cases do not establish", () => {
  it("says a case does not establish why the class happened", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.report.unverified).toContain(
      "a case asserts that an error class does not recur; it does not establish why the class happened",
    );
  });

  it("says a case covers the shape of failure this trace recorded", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.report.unverified).toContain(
      "a case carries the occurrences this trace recorded, so a rerun that fails in a different shape of the same class is not covered by it",
    );
  });

  it("says refusals are not part of what a model reviews", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.report.unverified).toContain(
      "guardrail refusals produce no case, so 1 refused call is not part of what a model reviews",
    );
  });

  it("says the run may have been cut short when the file has no terminal event", () => {
    const report = buildEvalGen(buildErrors("fixture", "bundled", incompleteTrace()), null);
    const draft = buildEvalGenDraft(report, incompleteTrace(), { maxExcerptEvents: 50, sendPaths: false });
    expect(report.status).toBe("incomplete");
    expect(draft.report.unverified).toContain(
      "the file has no terminal event, so the run may have been cut short rather than finished",
    );
  });
});

describe("eval-gen --model: a trace with no case", () => {
  it("makes no request and says why", () => {
    for (const name of ["success.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const draft = draftOf(name);
      expect(draft.request).toBeNull();
      expect(draft.skipReason).toContain("the trace records no failure");
      expect(draft.report.unverified).toEqual(["the trace records no failure, so there is no case for a model to review"]);
    }
  });
});

describe("eval-gen --model: folding one attempt in", () => {
  const base = (): EvalGenWithModel => draftOf("failed.jsonl").report;

  const success: ModelResult = {
    ok: true,
    provider: "openai-compatible",
    model: "stub-model",
    requests: 1,
    sent_events: 6,
    request_bytes: 4096,
    redacted_fields: 0,
    findings: [
      {
        id: "find_1",
        severity: "warning",
        evidence: ["evt_000016"],
        claim: "the two occurrences carry different messages",
        confidence: "medium",
        suggestion: "narrow the assertion",
      },
    ],
    unverified: ["the quoted events do not say whether the two reads were the same mistake"],
  };

  it("keeps the cases and adds the findings on success", () => {
    const report = base();
    const folded = withEvalGenModelResult(report, success);
    expect(folded.cases).toEqual(report.cases);
    expect(folded.findings.map((finding) => finding.evidence)).toEqual([["evt_000016"]]);
    expect(folded.model.ok).toBe(true);
    expect(folded.model.requests).toBe(1);
    expect(folded.model.sent_events).toBe(6);
    expect(folded.model.request_bytes).toBe(4096);
    // The model's own gaps are kept apart from the deterministic ones, not merged in.
    expect(folded.model.unverified).toEqual(["the quoted events do not say whether the two reads were the same mistake"]);
    expect(folded.unverified).toEqual(report.unverified);
    expect(folded.cases).toHaveLength(5);
  });

  it("keeps the cases and records the failure when the model half fails", () => {
    const report = base();
    const folded = withEvalGenModelResult(report, {
      ok: false,
      kind: "http_error",
      message: "the provider answered HTTP 500",
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 6,
      request_bytes: 4096,
      redacted_fields: 0,
    });
    expect(folded.findings).toEqual([]);
    expect(folded.cases).toEqual(report.cases);
    expect(folded.model.ok).toBe(false);
    expect(folded.model.error).toEqual({ kind: "http_error", message: "the provider answered HTTP 500" });
    expect(folded.unverified).toEqual(report.unverified);
  });

  it("records a skipped call as a no-op rather than a failure", () => {
    const folded = withEvalGenSkippedModel(base(), "nothing to review", "openai-compatible", "stub-model");
    expect(folded.model.enabled).toBe(true);
    expect(folded.model.ok).toBe(true);
    expect(folded.model.requests).toBe(0);
    expect(folded.model.sent_events).toBe(0);
    expect(folded.model.skipped).toBe("nothing to review");
    expect(folded.model.error).toBeNull();
    expect(folded.findings).toEqual([]);
  });

  it("appends the no-model note only when no model was asked for", () => {
    const withNote: EvalGenWithModel = withoutEvalGenModel(draftOf("failed.jsonl"));
    expect(withNote.unverified.at(-1)).toBe(EVAL_GEN_NO_MODEL_NOTE);
    expect(base().unverified.at(-1)).not.toBe(EVAL_GEN_NO_MODEL_NOTE);
  });
});

describe("eval-gen --model: the report", () => {
  it("keeps the deterministic keys first and the model half last, in --json mode", () => {
    const report = withoutEvalGenModel(draftOf("failed.jsonl"));
    expect(Object.keys(JSON.parse(renderEvalGenModelJson(report)))).toEqual([
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
      "findings",
      "unverified",
      "model",
    ]);
  });

  it("keeps the deterministic rendering identical to what --out writes", () => {
    const report = withoutEvalGenModel(draftOf("failed.jsonl"));
    // The file never carries the model half, so the deterministic renderers are the ones
    // that have to stay byte-identical to the written bytes.
    expect(renderEvalGenText(FAILED)).toBe(renderEvalGenText(report));
    // The file is the report minus the model half and nothing else: same keys, same
    // order, same bytes, so diffing the file against `--json` shows only the model's
    // contribution as the difference.
    expect(Object.keys(JSON.parse(renderEvalGenModelJson(report))).slice(0, 12)).toEqual(
      Object.keys(JSON.parse(renderEvalGenJson(FAILED))),
    );
    const { findings, unverified, model, ...deterministic } = report;
    expect(findings).toEqual([]);
    expect(unverified.at(-1)).toBe(EVAL_GEN_NO_MODEL_NOTE);
    expect(model.enabled).toBe(false);
    expect(`${JSON.stringify(deterministic, null, 2)}\n`).toBe(renderEvalGenJson(FAILED));
  });

  it("is byte-stable in both output modes", () => {
    const first = draftOf("failed.jsonl");
    const second = draftOf("failed.jsonl");
    for (const render of [renderEvalGenModelText, renderEvalGenModelJson]) {
      expect(render(withoutEvalGenModel(first))).toBe(render(withoutEvalGenModel(second)));
    }
  });

  it("prints the deterministic report before the model half, in terminal mode", () => {
    const report = withoutEvalGenModel(draftOf("failed.jsonl"));
    const text = renderEvalGenModelText(report);
    const deterministic = renderEvalGenText(report);
    expect(text.startsWith(deterministic)).toBe(true);
    expect(text).toContain("findings\n  none");
    expect(text).toContain(EVAL_GEN_NO_MODEL_NOTE);
    expect(text).toContain("model\n  disabled");
  });
});

describe("eval-gen --model: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace eval-gen FILE [--out DIR] [--force] --model`"));
    expect(section.length).toBeGreaterThan(0);
    const block = /\n```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    const text = block?.[1] ?? "";
    // The deterministic half is byte-compared against what the command prints without
    // --model, up to the point where the model's findings begin.
    const without = renderEvalGenModelText(withoutEvalGenModel(draftOf("failed.jsonl")));
    expect(text.startsWith(without.slice(0, without.indexOf("\nfindings\n")))).toBe(true);
    // The model half is checked for the facts a reader relies on rather than byte for
    // byte, because its byte count depends on the provider's answer.
    expect(text).toContain("find_1  warning  confidence medium  evidence evt_000016");
    expect(text).toContain("provider         openai-compatible");
    expect(text).toContain("model            stub-model");
    expect(text).toContain("requests         1");
    expect(text).toContain("events sent      6");
  });
});
