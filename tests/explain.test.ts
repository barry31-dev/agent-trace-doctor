import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeEvent } from "../src/analyze.js";
import { buildExplainDraft, buildExcerpt, buildObservations, NO_MODEL_NOTE, withModelResult } from "../src/explain.js";
import type { ExplainObservation } from "../src/explain.js";
import type { ExplainReport } from "../src/explain.js";
import { loadTraceFile } from "../src/loader.js";
import type { ModelResult } from "../src/model/types.js";
import { renderExplainText } from "../src/report.js";
import { projectRoot } from "./helpers.js";

function load(name: string) {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function draft(name: string, options: { maxExcerptEvents?: number; sendPaths?: boolean } = {}) {
  return buildExplainDraft(`examples/${name}`, "bundled", load(name), {
    maxExcerptEvents: options.maxExcerptEvents ?? 50,
    sendPaths: options.sendPaths ?? false,
  });
}

const SUCCESS = draft("success.jsonl");
const FAILED = draft("failed.jsonl");
const CANCELLED = draft("cancelled.jsonl");
const SPIKE = draft("spike-run.jsonl");

describe("explain: observations", () => {
  it("puts the outcome first, the evidence in file order and the last turn last", () => {
    expect(FAILED.report.observations.map((observation) => [observation.kind, observation.event_id])).toEqual([
      ["run_outcome", "evt_000026"],
      ["tool_failure", "evt_000013"],
      ["tool_failure", "evt_000015"],
      ["error_recorded", "evt_000016"],
      ["model_failure", "evt_000018"],
      ["tool_failure", "evt_000022"],
      ["error_recorded", "evt_000023"],
      ["last_model_turn", "evt_000025"],
    ]);
  });

  it("numbers observations obs_1 upward in report order", () => {
    expect(FAILED.report.observations.map((observation) => observation.id)).toEqual([
      "obs_1",
      "obs_2",
      "obs_3",
      "obs_4",
      "obs_5",
      "obs_6",
      "obs_7",
      "obs_8",
    ]);
  });

  it("keeps the line number of every observation so it can be traced back", () => {
    for (const observation of FAILED.report.observations) {
      expect(observation.line).toBe(Number(observation.event_id?.slice(4)));
    }
  });

  it("records a denied permission for a cancelled run", () => {
    expect(CANCELLED.report.observations.map((observation) => [observation.kind, observation.event_id])).toEqual([
      ["run_outcome", "evt_000008"],
      ["permission_denied", "evt_000007"],
      ["last_model_turn", "evt_000003"],
    ]);
    expect(CANCELLED.report.status).toBe("cancelled");
  });

  it("quotes a tool the run itself declared unavailable", () => {
    const withheld = SPIKE.report.observations.filter((observation) => observation.kind === "withheld_tool");
    expect(withheld).toHaveLength(1);
    expect(withheld[0]?.event_id).toBe("evt_000001");
    expect(withheld[0]?.statement).toBe("run.started declares tool fetch_url unavailable");
  });

  it("reuses the timeline description so one event cannot be described two ways", () => {
    const events = load("failed.jsonl");
    const observations = buildObservations(events);
    for (const observation of observations) {
      if (observation.kind === "withheld_tool") {
        continue;
      }
      const loaded = events.find((candidate) => candidate.line === observation.line);
      expect(loaded).toBeDefined();
      expect(observation.statement).toBe(describeEvent(loaded?.event));
    }
  });
});

describe("explain: excerpt", () => {
  it("quotes exactly the events the observations cite, in file order", () => {
    const cited = FAILED.report.observations.map((observation) => observation.event_id);
    expect(FAILED.request.events.map((event) => event.event_id)).toEqual([...cited].sort());
    expect(FAILED.request.events.map((event) => event.event_id)).not.toEqual(cited);
  });

  it("carries the payload of each quoted event and its line number", () => {
    const quoted = FAILED.request.events.find((event) => event.event_id === "evt_000013");
    expect(quoted?.line).toBe(13);
    expect(quoted?.type).toBe("tool.call.failed");
    expect(quoted?.payload).toBeTypeOf("object");
  });

  it("names but does not quote the events past the cap", () => {
    const capped = draft("failed.jsonl", { maxExcerptEvents: 2 });
    expect(capped.request.events.map((event) => event.event_id)).toEqual(["evt_000013", "evt_000015"]);
    expect(capped.report.unverified).toContain(
      "only the first 2 cited events were quoted; evt_000016, evt_000018, evt_000022, evt_000023, evt_000025, evt_000026 are named but not quoted",
    );
  });

  it("omits the file path from the request unless the caller opts in", () => {
    expect(FAILED.request.file).toBeNull();
    expect(draft("failed.jsonl", { sendPaths: true }).request.file).toBe("examples/failed.jsonl");
  });

  it("sends the task and the answer contract, so the shape enforced is the shape promised", async () => {
    const { ANSWER_CONTRACT, EXPLAIN_TASK } = await import("../src/model/contract.js");
    expect(FAILED.request.task).toBe(EXPLAIN_TASK);
    expect(FAILED.request.output_contract).toEqual(ANSWER_CONTRACT);
  });

  it("knows every event id in the trace, not only the quoted ones", () => {
    const ids = new Set(load("failed.jsonl").map((loaded) => (loaded.event as { event_id: string }).event_id));
    expect([...FAILED.knownEventIds].sort()).toEqual([...ids].sort());
    expect(FAILED.knownEventIds.has("evt_000001")).toBe(true);
  });
});

describe("explain: what the report does not establish", () => {
  it("says so when the trace records no cause at all", () => {
    expect(SUCCESS.report.unverified).toEqual([
      "the trace records no failed model call, failed tool call, recorded error or denied permission, so it does not state a cause",
    ]);
  });

  it("says so when the run has no terminal event", () => {
    const events = load("success.jsonl").slice(0, 4);
    const report = buildExplainDraft("x.jsonl", "bundled", events, { maxExcerptEvents: 50, sendPaths: false }).report;
    expect(report.status).toBe("incomplete");
    expect(report.unverified[0]).toBe("the file has no terminal event, so the final outcome of the run is not recorded");
  });

  it("keeps the deterministic notes when a model runs, and never mixes in model notes", () => {
    const ok: ModelResult = {
      ok: true,
      provider: "openai-compatible",
      model: "stub",
      requests: 1,
      sent_events: 8,
      request_bytes: 1234,
      redacted_fields: 0,
      findings: [],
      unverified: ["the quoted events do not say why the rate limit hit"],
    };
    const report = withModelResult(FAILED.report, ok);
    expect(report.unverified).toEqual([]);
    expect(report.model.unverified).toEqual(["the quoted events do not say why the rate limit hit"]);
  });
});

describe("explain: folding in a model result", () => {
  it("records the transport facts of a successful call", () => {
    const report = withModelResult(FAILED.report, {
      ok: true,
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 8,
      request_bytes: 4321,
      redacted_fields: 0,
      findings: [
        {
          id: "find_1",
          severity: "warning",
          evidence: ["evt_000013"],
          claim: "the first write failed because the directory was missing",
          confidence: "medium",
          suggestion: "create the directory before the first write",
        },
      ],
      unverified: [],
    });
    expect(report.findings).toHaveLength(1);
    expect(report.model).toEqual({
      enabled: true,
      ok: true,
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 8,
      request_bytes: 4321,
      redacted_fields: 0,
      unverified: [],
      error: null,
    });
  });

  it("keeps the deterministic observations when the model fails and says so", () => {
    const report = withModelResult(FAILED.report, {
      ok: false,
      kind: "timeout",
      message: "the provider did not answer within 60000 ms",
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 8,
      request_bytes: 4321,
      redacted_fields: 0,
    });
    expect(report.observations).toEqual(FAILED.report.observations);
    expect(report.findings).toEqual([]);
    expect(report.model.ok).toBe(false);
    expect(report.model.error).toEqual({ kind: "timeout", message: "the provider did not answer within 60000 ms" });
  });

  it("never presents a model failure as a model success", () => {
    const report = withModelResult(FAILED.report, {
      ok: false,
      kind: "http_error",
      message: "the provider answered HTTP 500",
      provider: "openai-compatible",
      model: "stub-model",
      requests: 1,
      sent_events: 8,
      request_bytes: 4321,
      redacted_fields: 0,
    });
    expect(report.model.enabled).toBe(true);
    expect(report.model.ok).toBe(false);
    expect(report.findings).toEqual([]);
  });
});

describe("explain: determinism", () => {
  it("produces byte-identical reports for the same input", () => {
    const render = (name: string): string =>
      JSON.stringify(buildExplainDraft(`examples/${name}`, "bundled", load(name), { maxExcerptEvents: 50, sendPaths: false }).report);
    expect(render("failed.jsonl")).toBe(render("failed.jsonl"));
    expect(render("failed.jsonl")).toBe(JSON.stringify(FAILED.report));
  });

  it("is byte-stable across a reordered read of the same file", () => {
    const events = load("failed.jsonl");
    const first = buildExplainDraft("a.jsonl", "bundled", events, { maxExcerptEvents: 50, sendPaths: false });
    const second = buildExplainDraft("a.jsonl", "bundled", [...events], { maxExcerptEvents: 50, sendPaths: false });
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
  });
});

describe("explain: buildExcerpt", () => {
  it("returns nothing when no observation cites an event", () => {
    const { excerpt, omitted } = buildExcerpt(load("success.jsonl"), [], 50);
    expect(excerpt).toEqual([]);
    expect(omitted).toEqual([]);
  });

  it("ignores observations with no event id rather than quoting everything", () => {
    const { excerpt } = buildExcerpt(load("success.jsonl"), [
      { id: "obs_1", kind: "run_outcome", event_id: null, line: null, statement: "nothing" },
    ], 50);
    expect(excerpt).toEqual([]);
  });

  it("counts an observation whose id is not in the file as omitted rather than quoting it", () => {
    const { excerpt, omitted } = buildExcerpt(load("success.jsonl"), [
      { id: "obs_1", kind: "run_outcome", event_id: "evt_999999", line: 1, statement: "nothing" },
    ], 50);
    expect(excerpt).toEqual([]);
    expect(omitted).toEqual([]);
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what the
 * command prints is a documentation bug that reads as a feature, so it is compared here
 * rather than trusted.
 */
/**
 * The request boundary, exercised on a trace that carries credentials.
 *
 * The schema allows payload fields the tool does not know about, so a recorder can put
 * anything there, and one of those fields can be a key. These tests hold the two halves
 * of the boundary apart: the excerpt a model would be shown loses the values, and the
 * loaded event the engineer reads keeps them.
 */
describe("explain: the request boundary", () => {
  const SECRET_EVENT = {
    schema_version: "1",
    event_id: "evt_000001",
    timestamp: "2026-10-14T10:00:00.000Z",
    type: "tool.call.failed",
    run_id: "run_01",
    payload: {
      tool: "fetch",
      api_key: "sk-live-not-a-real-key",
      headers: { authorization: "Bearer not-a-real-token", accept: "application/json" },
      retries: 2,
    },
  };
  const EVENTS = [{ line: 1, event: SECRET_EVENT }];
  const OBSERVATION: ExplainObservation = {
    id: "obs_1",
    kind: "tool_failure",
    event_id: "evt_000001",
    line: 1,
    statement: "tool failed: fetch",
  };

  it("withholds credential-looking values from the excerpt and keeps the shape", () => {
    const { excerpt, redacted } = buildExcerpt(EVENTS, [OBSERVATION], 50);
    expect(redacted).toBe(2);
    expect(excerpt).toEqual([
      {
        event_id: "evt_000001",
        line: 1,
        type: "tool.call.failed",
        payload: {
          tool: "fetch",
          api_key: "[redacted]",
          headers: { authorization: "[redacted]", accept: "application/json" },
          retries: 2,
        },
      },
    ]);
  });

  it("carries the count into the draft's report and its request", () => {
    const built = buildExplainDraft("examples/secret.jsonl", "bundled", EVENTS, {
      maxExcerptEvents: 50,
      sendPaths: false,
    });
    expect(built.report.model.redacted_fields).toBe(2);
    expect(built.request?.redacted_fields).toBe(2);
  });

  it("keeps the value in the loaded event, because only the request is a boundary", () => {
    const payload = (SECRET_EVENT.payload as Record<string, unknown>).api_key;
    expect(payload).toBe("sk-live-not-a-real-key");
    expect(JSON.stringify(EVENTS)).toContain("sk-live-not-a-real-key");
  });

  it("withholds nothing from a trace whose payloads carry no credential-looking field", () => {
    const { redacted } = buildExcerpt(load("failed.jsonl"), buildObservations(load("failed.jsonl")), 50);
    expect(redacted).toBe(0);
  });
});

describe("explain: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace explain FILE`"));
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    const rendered = buildExplainDraft(
      "examples/failed.jsonl",
      "bundled",
      load("failed.jsonl"),
      { maxExcerptEvents: 50, sendPaths: false },
    ).report;
    const withNote = { ...rendered, unverified: [...rendered.unverified, NO_MODEL_NOTE] };
    expect(block?.[1]).toBe(renderExplainText(withNote));
  });
});

describe("explain: no-model note", () => {
  it("names the reason nothing here is an interpretation", () => {
    expect(NO_MODEL_NOTE).toBe("no model was called, so this report only restates what the trace records");
  });

  it("is appended by the caller, not by the draft, so a model run does not inherit it", () => {
    expect(SUCCESS.report.unverified).not.toContain(NO_MODEL_NOTE);
    const withNote: ExplainReport = { ...SUCCESS.report, unverified: [...SUCCESS.report.unverified, NO_MODEL_NOTE] };
    expect(withNote.unverified).toContain(NO_MODEL_NOTE);
  });
});
