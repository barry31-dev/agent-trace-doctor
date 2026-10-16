import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadTraceFile } from "../src/loader.js";
import type { LoadedEvent } from "../src/loader.js";
import { buildErrors } from "../src/errors.js";
import { buildFixSuggest } from "../src/fixSuggest.js";
import type { FixSuggestion, FixSuggestReport } from "../src/fixSuggest.js";
import {
  FIX_SUGGEST_NO_MODEL_NOTE,
  buildFixSuggestDraft,
  withFixSuggestModelResult,
  withFixSuggestSkippedModel,
  withoutFixSuggestModel,
} from "../src/fixSuggestModel.js";
import type { FixSuggestWithModel } from "../src/fixSuggestModel.js";
import {
  renderFixSuggestJson,
  renderFixSuggestModelJson,
  renderFixSuggestModelText,
  renderFixSuggestText,
} from "../src/report.js";
import type { ModelResult } from "../src/model/types.js";
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

function draftOf(name: string, maxExcerptEvents = 50, sendPaths = false): ReturnType<typeof buildFixSuggestDraft> {
  return buildFixSuggestDraft(reportOf(name), load(name), { maxExcerptEvents, sendPaths });
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

/**
 * A trace whose two fatal occurrences of one class make both `fatal_failure` and
 * `repeated_error_class` fire over the same events.
 */
function sharedEvidenceTrace(): LoadedEvent[] {
  return [
    loaded(1, "evt_000001", "run.started", { input_summary: "do a thing" }),
    loaded(2, "evt_000002", "error.recorded", { error: { type: "boom", message: "first" }, fatal: true }),
    loaded(3, "evt_000003", "error.recorded", { error: { type: "boom", message: "second" }, fatal: true }),
    loaded(4, "evt_000004", "run.failed", { reason: "two booms" }),
  ];
}

const FAILED = reportOf("failed.jsonl");

describe("fix-suggest --model: one observation per suggestion", () => {
  const draft = draftOf("failed.jsonl");

  it("restates every suggestion, in the rule order the report already uses", () => {
    expect(draft.report.suggestions).toHaveLength(4);
    expect(draft.request?.observations.map((observation) => observation.id)).toEqual([
      "obs_001",
      "obs_002",
      "obs_003",
      "obs_004",
    ]);
  });

  it("anchors each observation to the first event the suggestion was derived from", () => {
    const observations = draft.request?.observations ?? [];
    expect(observations[0]?.event_id).toBe("evt_000016");
    expect(observations[0]?.line).toBe(16);
    expect(observations[1]?.event_id).toBe("evt_000015");
    expect(observations[2]?.event_id).toBe("evt_000022");
    expect(observations[3]?.event_id).toBe("evt_000013");
  });

  it("quotes the suggestion's own action rather than paraphrasing it", () => {
    const observations = draft.request?.observations ?? [];
    for (const [index, entry] of draft.report.suggestions.entries()) {
      expect(observations[index]?.statement).toContain(entry.action);
      expect(observations[index]?.statement).toContain(entry.suggestion_id);
      expect(observations[index]?.statement).toContain(entry.rule);
    }
    // The counts and both anchors are stated too, because a suggestion is those together
    // and a model shown only the sentence would have to guess at the evidence.
    expect(observations[0]?.statement).toContain("2 events (0 fatal)");
    expect(observations[0]?.statement).toContain("first at line 16 (evt_000016)");
    expect(observations[0]?.statement).toContain("last at line 23 (evt_000023)");
  });

  it("names the class and the tool a suggestion rests on", () => {
    const observations = draft.request?.observations ?? [];
    expect(observations[0]?.statement).toContain("class tool_error");
    expect(observations[1]?.statement).toContain("tool read_file");
    // The refusal suggestion rests on neither, so it says so rather than inventing one.
    expect(observations[3]?.statement).not.toContain("class ");
    expect(observations[3]?.statement).not.toContain("tool ");
  });

  it("falls back to a later event when a suggestion's first evidence carries no id", () => {
    // The two rules whose evidence is not a failure occurrence write an empty id when the
    // event has none. Such a suggestion is still restated rather than dropped, and the
    // answer contract already forbids a finding from citing nothing.
    const first = FAILED.suggestions[0];
    if (first === undefined) {
      throw new Error("the failed example produced no suggestion to re-anchor");
    }
    const report: FixSuggestReport = {
      ...FAILED,
      suggestions: [
        { ...first, evidence: [{ line: 4, event_id: "", event: "permission.resolved", note: "no id here", fatal: null }, ...first.evidence] },
      ],
    };
    const draft = buildFixSuggestDraft(report, load("failed.jsonl"), { maxExcerptEvents: 50, sendPaths: false });
    expect(draft.request?.observations[0]?.event_id).toBe("evt_000016");
    expect(draft.request?.observations[0]?.statement).toContain("first at line 16 (evt_000016)");
  });

  it("says an anchor is missing when no evidence entry carries an id", () => {
    const first = FAILED.suggestions[0];
    if (first === undefined) {
      throw new Error("the failed example produced no suggestion to re-anchor");
    }
    const report: FixSuggestReport = {
      ...FAILED,
      suggestions: [
        { ...first, evidence: [{ line: 4, event_id: "", event: "permission.resolved", note: "no id here", fatal: null }] },
      ],
    };
    const draft = buildFixSuggestDraft(report, load("failed.jsonl"), { maxExcerptEvents: 50, sendPaths: false });
    expect(draft.request?.observations[0]?.event_id).toBeNull();
    expect(draft.request?.observations[0]?.statement).toContain("first at no recorded event");
    // A suggestion whose evidence carries no id names nothing, so it contributes nothing
    // to the excerpt either: a quoted event is one a reader can open.
    expect(draft.request?.events).toEqual([]);
    expect(draft.report.model.sent_events).toBe(0);
  });
});

describe("fix-suggest --model: the excerpt", () => {
  it("quotes exactly the events the suggestions cite, in file order, and nothing else", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.request?.events.map((event) => event.event_id)).toEqual([
      "evt_000013",
      "evt_000015",
      "evt_000016",
      "evt_000022",
      "evt_000023",
    ]);
    expect(draft.report.model.sent_events).toBe(5);
  });

  it("quotes one event once even when two rules cite it", () => {
    // A class whose every occurrence was fatal fires both `fatal_failure` and
    // `repeated_error_class` over the same occurrences, so the same event is cited twice.
    const events = sharedEvidenceTrace();
    const report = buildFixSuggest(buildErrors("synthetic.jsonl", "bundled", events), events);
    const rules = report.suggestions.map((suggestion) => suggestion.rule);
    expect(rules).toContain("fatal_failure");
    expect(rules).toContain("repeated_error_class");
    const draft = buildFixSuggestDraft(report, events, { maxExcerptEvents: 50, sendPaths: false });
    expect(draft.request?.events.map((event) => event.event_id)).toEqual(["evt_000002", "evt_000003"]);
    expect(draft.report.model.sent_events).toBe(2);
  });

  it("names the events past --max-excerpt instead of dropping them", () => {
    const draft = draftOf("failed.jsonl", 2);
    expect(draft.request?.events.map((event) => event.event_id)).toEqual(["evt_000013", "evt_000015"]);
    const note = draft.report.unverified.find((line) => line.includes("are named but not quoted"));
    expect(note).toContain("only the first 2 cited events were quoted");
    expect(note).toContain("evt_000016, evt_000022, evt_000023");
  });

  it("keeps every event id of the trace as evidence, quoted or not", () => {
    const draft = draftOf("failed.jsonl", 2);
    for (const id of ["evt_000013", "evt_000016", "evt_000022", "evt_000023"]) {
      expect(draft.knownEventIds.has(id)).toBe(true);
    }
    // An event nothing was derived from is still real evidence a finding may cite.
    expect(draft.knownEventIds.has("evt_000001")).toBe(true);
  });

  it("keeps the file path out unless the caller opted in", () => {
    expect(draftOf("failed.jsonl").request?.file).toBeNull();
    expect(draftOf("failed.jsonl", 50, true).request?.file).toBe("examples/failed.jsonl");
  });

  it("quotes the payload as the recorder wrote it", () => {
    const draft = draftOf("failed.jsonl");
    const quoted = draft.request?.events.find((event) => event.event_id === "evt_000016");
    expect(quoted?.type).toBe("error.recorded");
    expect(quoted?.payload).toMatchObject({ error: { type: "tool_error" } });
  });
});

describe("fix-suggest --model: what the report does not establish", () => {
  it("does not repeat what the deterministic report already says", () => {
    const draft = draftOf("failed.jsonl");
    for (const note of FAILED.unverified) {
      expect(draft.report.unverified.filter((line) => line === note)).toHaveLength(1);
    }
  });

  it("says a truncated file may be a prefix, because that is what misleads a reader first", () => {
    const events: LoadedEvent[] = [
      loaded(1, "evt_000001", "run.started", { input_summary: "do a thing" }),
      loaded(2, "evt_000002", "error.recorded", { error: { type: "boom", message: "it broke" }, fatal: true }),
    ];
    const report = buildFixSuggest(buildErrors("synthetic.jsonl", "bundled", events), events);
    const draft = buildFixSuggestDraft(report, events, { maxExcerptEvents: 50, sendPaths: false });
    expect(report.status).toBe("incomplete");
    expect(report.suggestions[0]?.rule).toBe("incomplete_run");
    expect(draft.report.unverified).toContain(
      "the file has no terminal event, so the run may have been cut short rather than finished",
    );
  });

  it("says a direction is limited to the shapes this run hit", () => {
    const draft = draftOf("failed.jsonl");
    expect(draft.report.unverified).toContain(
      "a suggestion covers the events this trace recorded, so a direction about a shape of failure this run did not hit is not among them",
    );
  });

  it("says a refusal is reviewed as a policy question rather than a broken call", () => {
    const draft = draftOf("failed.jsonl");
    const note = draft.report.unverified.find((line) => line.includes("guardrail refusals"));
    expect(note).toContain("1 refused call is reviewed as a policy question");
  });
});

describe("fix-suggest --model: the no-model report", () => {
  it("appends the note only when no model was asked, and never in the other mode", () => {
    const without = withoutFixSuggestModel(draftOf("failed.jsonl"));
    expect(without.unverified[without.unverified.length - 1]).toBe(FIX_SUGGEST_NO_MODEL_NOTE);
    // The CLI folds an attempt into the draft's own report, never into the no-model one:
    // a report built for a model call must not claim no model was called.
    const answered = withFixSuggestModelResult(draftOf("failed.jsonl").report, {
      ok: true,
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 5,
      request_bytes: 100,
      redacted_fields: 0,
      findings: [],
      unverified: [],
    });
    expect(answered.unverified).not.toContain(FIX_SUGGEST_NO_MODEL_NOTE);
  });

  it("keeps the deterministic half byte for byte, whatever the model half adds", () => {
    const report = reportOf("failed.jsonl");
    const draft = draftOf("failed.jsonl");
    const answered = withFixSuggestModelResult(draft.report, {
      ok: true,
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 5,
      request_bytes: 100,
      redacted_fields: 0,
      findings: [
        {
          id: "find_1",
          severity: "warning",
          evidence: ["evt_000016"],
          claim: "the two occurrences carry different messages",
          confidence: "medium",
          suggestion: "read both before looking for one cause",
        },
      ],
      unverified: ["the quoted events do not say whether the two reads were the same mistake"],
    });

    const parsed = JSON.parse(renderFixSuggestModelJson(answered)) as Record<string, unknown>;
    delete parsed.findings;
    delete parsed.model;
    parsed.unverified = report.unverified;
    expect(`${JSON.stringify(parsed, null, 2)}\n`).toBe(renderFixSuggestJson(report));

    // The terminal rendering opens with the same deterministic block in both modes.
    const lines = renderFixSuggestModelText(answered).split("\n");
    const deterministic = renderFixSuggestText(report).split("\n");
    // Up to the blank line before the unverified block: the header and the suggestions,
    // which is the answer to the question the command was asked.
    const cut = deterministic.indexOf("unverified") - 1;
    expect(lines.slice(0, cut)).toEqual(deterministic.slice(0, cut));
  });

  it("renders the same bytes for the same trace twice", () => {
    const first = renderFixSuggestModelJson(withoutFixSuggestModel(draftOf("failed.jsonl")));
    const second = renderFixSuggestModelJson(withoutFixSuggestModel(draftOf("failed.jsonl")));
    expect(second).toBe(first);
  });
});

describe("fix-suggest --model: one attempt folded in", () => {
  /** The report the CLI folds an attempt into: the draft's own, never the no-model one. */
  function base(): FixSuggestWithModel {
    return draftOf("failed.jsonl").report;
  }

  it("keeps the suggestions and records the failure when the model could not be used", () => {
    const failure: ModelResult = {
      ok: false,
      kind: "bad_shape",
      message: "the model answer is not JSON",
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 5,
      request_bytes: 7057,
      redacted_fields: 0,
    };
    const report = withFixSuggestModelResult(base(), failure);
    expect(report.findings).toEqual([]);
    expect(report.model.ok).toBe(false);
    expect(report.model.enabled).toBe(true);
    expect(report.model.error).toEqual({ kind: "bad_shape", message: failure.message });
    expect(report.suggestions).toHaveLength(4);
    expect(report.unverified).not.toContain(FIX_SUGGEST_NO_MODEL_NOTE);
  });

  it("records a skipped call as a no-op rather than a failure", () => {
    const report = withFixSuggestSkippedModel(base(), "nothing to review", "openai-compatible", "stub-model");
    expect(report.model.ok).toBe(true);
    expect(report.model.enabled).toBe(true);
    expect(report.model.requests).toBe(0);
    expect(report.model.sent_events).toBe(0);
    expect(report.model.skipped).toBe("nothing to review");
    expect(report.model.error).toBeNull();
  });

  it("keeps the model's own gaps apart from the deterministic ones", () => {
    const report = withFixSuggestModelResult(base(), {
      ok: true,
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 5,
      request_bytes: 7057,
      redacted_fields: 0,
      findings: [],
      unverified: ["the quoted events do not say why the tool failed"],
    });
    expect(report.model.unverified).toEqual(["the quoted events do not say why the tool failed"]);
    for (const note of report.model.unverified) {
      expect(report.unverified).not.toContain(note);
    }
  });
});

describe("fix-suggest --model: no request when there is nothing to review", () => {
  it("builds no request for a trace with no suggestion", () => {
    for (const name of ["success.jsonl", "spike-run.jsonl"]) {
      const draft = draftOf(name);
      expect(draft.request).toBeNull();
      expect(draft.skipReason).toContain("there is no direction for a model to review");
      expect(draft.report.model.sent_events).toBe(0);
      expect(draft.report.suggestions).toHaveLength(0);
    }
  });

  it("still reports the cancelled example's one direction", () => {
    const draft = draftOf("cancelled.jsonl");
    expect(draft.request).not.toBeNull();
    expect(draft.report.suggestions.map((suggestion) => suggestion.rule)).toEqual(["permission_denied"]);
    expect(draft.request?.events.map((event) => event.event_id)).toEqual(["evt_000007"]);
  });
});
