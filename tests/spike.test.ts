import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAgent, summariseArgs } from "../spike/agent.js";
import { ScriptedModel } from "../spike/model.js";
import type { ScriptedStep } from "../spike/model.js";
import {
  ToolContractError,
  createToolSet,
  requiresPermission,
  resolveInsideWorkdir,
  schemaHash,
  toolSummaries,
} from "../spike/tools.js";
import type { ToolDefinition } from "../spike/tools.js";
import { TraceRecorder } from "../spike/recorder.js";
import type { TraceEvent } from "../spike/recorder.js";
import { createSandbox, parseSpikeArgs, runSpike } from "../spike/cli.js";
import { loadTraceFile } from "../src/loader.js";
import { loadValidator } from "../src/schema.js";
import { validateEvents } from "../src/validate.js";
import { describeEvent } from "../src/analyze.js";
import { payloadOf, projectRoot, readEvents } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "agent-trace-doctor-spike-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function sandbox(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

function fixedClock(startMs: number, stepMs = 1): { now: () => number; ticks: () => void } {
  let current = startMs;
  let ticks = 0;
  return {
    now: () => current,
    ticks: () => {
      ticks += 1;
      current += stepMs;
    },
  };
}

function runPlan(steps: ScriptedStep[], options: { workdir: string; maxSteps?: number }) {
  const sink = capture();
  const recorder = new TraceRecorder({ runId: "run_test", write: sink.write });
  const result = runAgent({
    input: "probe",
    model: new ScriptedModel({ name: "stub", steps }),
    tools: createToolSet(),
    workdir: options.workdir,
    recorder,
    maxSteps: options.maxSteps ?? steps.length,
  });
  return { result, lines: sink.lines, recorder };
}

function typesOf(events: TraceEvent[]): string[] {
  return events.map((event) => event.type);
}

/**
 * The payload of one recorded event, as a plain record. The recorder's payload type
 * is a union of all fourteen contracts, so a test that reads one field of one type
 * would otherwise need a narrowing dance per assertion.
 */
function fields(event: TraceEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

function toolNamed(name: string): ToolDefinition {
  const tool = createToolSet().find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`no tool named ${name}`);
  }
  return tool;
}

/** Validates a set of in-memory events with the product's own validator. */
function checkWithProduct(events: TraceEvent[]): { valid: boolean; messages: string[] } {
  const schema = loadValidator(null);
  if (!schema.ok) {
    throw new Error(`bundled schema did not load: ${schema.message}`);
  }
  const loaded = events.map((event, index) => ({ line: index + 1, event }));
  const report = validateEvents("memory", "bundled", loaded, schema.validate, "validate");
  return { valid: report.valid, messages: report.errors.map((error) => `${error.line}: ${error.message}`) };
}

describe("spike recorder", () => {
  it("assigns sequential unique event ids and one run id", () => {
    const sink = capture();
    const recorder = new TraceRecorder({ runId: "run_seq", write: sink.write });
    recorder.record("run.started", { input_summary: "x" });
    recorder.record("run.finished", { status: "completed" });

    const ids = recorder.events().map((event) => event.event_id);
    expect(ids).toEqual(["evt_000001", "evt_000002"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of recorder.events()) {
      expect(event.run_id).toBe("run_seq");
      expect(event.schema_version).toBe("1");
    }
  });

  it("writes one JSON line per event", () => {
    const sink = capture();
    const recorder = new TraceRecorder({ runId: "run_lines", write: sink.write });
    recorder.record("run.started", { input_summary: "x" });
    recorder.record("run.finished", { status: "completed" });

    expect(sink.lines).toHaveLength(2);
    for (const line of sink.lines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("keeps timestamps non-decreasing and clamps a clock that jumps back", () => {
    const sink = capture();
    let current = 1_000;
    const recorder = new TraceRecorder({
      runId: "run_clock",
      write: sink.write,
      clock: () => current,
    });
    recorder.record("run.started", { input_summary: "x" });
    current = 500;
    recorder.record("model.request.started", { model: "m" });
    current = 2_000;
    recorder.record("run.finished", { status: "completed" });

    const stamps = recorder.events().map((event) => Date.parse(event.timestamp));
    expect(stamps).toEqual([1_000, 1_000, 2_000]);
    // The substitution is reported, not silent.
    expect(recorder.diagnostics()).toEqual({ clampedTimestamps: 1, events: 3 });
  });

  it("formats timestamps as RFC 3339 with milliseconds and a UTC designator", () => {
    const sink = capture();
    const recorder = new TraceRecorder({ runId: "run_fmt", write: sink.write, clock: () => Date.UTC(2026, 9, 14, 10, 30, 15, 250) });
    const event = recorder.record("run.started", { input_summary: "x" });
    expect(event.timestamp).toBe("2026-10-14T10:30:15.250Z");
  });

  it("generates a run id when none is given", () => {
    const sink = capture();
    const recorder = new TraceRecorder({ write: sink.write });
    expect(recorder.runId.length).toBeGreaterThan(0);
    recorder.record("run.started", { input_summary: "x" });
    expect(recorder.events()[0]?.run_id).toBe(recorder.runId);
  });
});

describe("spike tools", () => {
  it("hashes each tool schema distinctly", () => {
    // Regression: the first canonicaliser used JSON.stringify's array replacer, which
    // is a recursive key allowlist. It stripped the fields that tell the schemas
    // apart, so list_dir and read_file hashed identically.
    const [listDir, readFile, writeFile] = createToolSet();
    const hashes = [listDir!, readFile!, writeFile!].map((tool) => schemaHash(tool.parameters));
    expect(new Set(hashes).size).toBe(3);
  });

  it("hashes independently of key order", () => {
    const left = schemaHash({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });
    const right = schemaHash({ required: ["a"], properties: { a: { type: "string" } }, type: "object" });
    expect(left).toBe(right);
  });

  it("hashes depend on the contract, not on formatting", () => {
    const base = { type: "object", properties: { a: { type: "string", description: "one" } } };
    expect(schemaHash(base)).not.toBe(schemaHash({ type: "object", properties: { a: { type: "string", description: "two" } } }));
  });

  it("resolves inside paths and refuses escapes", () => {
    const dir = sandbox("escape");
    expect(resolveInsideWorkdir(dir, "notes/a.md")).toBe(join(dir, "notes/a.md"));
    expect(resolveInsideWorkdir(dir, ".")).toBe(dir);
    for (const escape of ["../outside", "../../etc/hostname", "/etc/hostname"]) {
      expect(() => resolveInsideWorkdir(dir, escape)).toThrow(ToolContractError);
    }
  });

  it("reports a sandbox escape as a path_escape guard, not a plain bad argument", () => {
    const dir = sandbox("guard");
    try {
      resolveInsideWorkdir(dir, "../outside");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolContractError);
      expect((error as ToolContractError).guard).toBe("path_escape");
    }
  });

  it("lists, reads and writes inside the sandbox", () => {
    const dir = sandbox("tools");
    createSandbox(dir);
    const listDir = toolNamed("list_dir");
    const readFile = toolNamed("read_file");
    const writeFile = toolNamed("write_file");

    const listed = listDir.run({ path: "notes" }, { workdir: dir });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.summary.split("\n")).toEqual(["alpha.md", "beta.md", "gamma.md"]);
    }

    const read = readFile.run({ path: "notes/alpha.md" }, { workdir: dir });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.summary).toContain("The first synthetic note");
      expect(read.truncated).toBe(false);
    }

    const written = writeFile.run({ path: "out/report.md", content: "hello" }, { workdir: dir });
    expect(written.ok).toBe(true);
    expect(readFile.run({ path: "out/report.md" }, { workdir: dir }).ok).toBe(true);
  });

  it("truncates a long read explicitly and keeps the full size", () => {
    const dir = sandbox("truncate");
    writeFileSync(join(dir, "big.txt"), "x".repeat(500), "utf8");
    const outcome = toolNamed("read_file").run({ path: "big.txt", max_bytes: 10 }, { workdir: dir });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.truncated).toBe(true);
      expect(outcome.resultBytes).toBe(500);
      expect(outcome.summary.endsWith("[truncated]")).toBe(true);
    }
  });

  it("marks exactly one tool as unavailable and says so in the run summary", () => {
    const summaries = toolSummaries(createToolSet());
    expect(summaries.map((entry) => entry.name)).toEqual(["list_dir", "read_file", "write_file", "fetch_url"]);
    expect(summaries.filter((entry) => !entry.available).map((entry) => entry.name)).toEqual(["fetch_url"]);
  });

  it("requires permission only for tools that can change something", () => {
    for (const tool of createToolSet()) {
      expect(requiresPermission(tool)).toBe(tool.effect !== "none");
    }
  });

  it("refuses a read of a missing file instead of throwing", () => {
    const dir = sandbox("missing");
    const outcome = toolNamed("read_file").run({ path: "nope.md" }, { workdir: dir });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBe("file_not_readable");
    }
  });
});

describe("spike agent", () => {
  it("runs the five-step plan and records the whole arc", () => {
    const dir = sandbox("five-step");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "list_dir", args: { path: "notes" } }] },
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "notes/alpha.md" } }] },
        { kind: "tools", calls: [{ tool: "write_file", args: { path: "report.md", content: "r\n" } }] },
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "report.md" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    expect(result.outcome).toBe("completed");
    expect(result.steps).toBe(5);
    expect(result.finalText).toBe("done");
    expect(typesOf(result.events)).toEqual([
      "run.started",
      "model.request.started",
      "model.response.completed",
      "tool.call.started",
      "tool.call.completed",
      "model.request.started",
      "model.response.completed",
      "tool.call.started",
      "tool.call.completed",
      "model.request.started",
      "model.response.completed",
      "permission.requested",
      "permission.resolved",
      "tool.call.started",
      "tool.call.completed",
      "model.request.started",
      "model.response.completed",
      "tool.call.started",
      "tool.call.completed",
      "model.request.started",
      "model.response.completed",
      "run.finished",
    ]);
  });

  it("separates read-only effects from applied ones", () => {
    const dir = sandbox("effects");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "notes/alpha.md" } }] },
        { kind: "tools", calls: [{ tool: "write_file", args: { path: "report.md", content: "r\n" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const completed = result.events.filter((event) => event.type === "tool.call.completed");
    expect(completed.map((event) => fields(event).effect_disposition)).toEqual(["none", "applied"]);
  });

  it("asks for permission before the write and records who decided", () => {
    const dir = sandbox("permission");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "write_file", args: { path: "report.md", content: "r\n" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const requested = result.events.find((event) => event.type === "permission.requested");
    const resolved = result.events.find((event) => event.type === "permission.resolved");
    const started = result.events.find((event) => event.type === "tool.call.started");
    expect(requested === undefined ? null : fields(requested)).toMatchObject({
      action: "write_file",
      resource: "report.md",
      tool: "write_file",
    });
    expect(resolved === undefined ? null : fields(resolved)).toMatchObject({
      decision: "approved",
      decided_by: "spike-policy",
    });
    // The permission is resolved before the call starts, not after it finished.
    expect(result.events.indexOf(started!)).toBeGreaterThan(result.events.indexOf(resolved!));
  });

  it("records the tool set at run start, including the tool it withheld", () => {
    const dir = sandbox("toolset");
    createSandbox(dir);
    const { result } = runPlan([{ kind: "final", text: "done" }], { workdir: dir });

    const started = result.events.find((event) => event.type === "run.started");
    const config = (started === undefined ? {} : fields(started).config_summary) as Record<string, unknown>;
    const tools = config.tools as Array<{ name: string; schema_hash: string; available: boolean }>;
    expect(tools).toHaveLength(4);
    expect(tools.map((tool) => tool.name)).toEqual(["list_dir", "read_file", "write_file", "fetch_url"]);
    expect(tools.find((tool) => tool.name === "fetch_url")?.available).toBe(false);
    for (const tool of tools) {
      expect(tool.schema_hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("only claims an inline capture when the turn produced text", () => {
    const dir = sandbox("capture");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "list_dir", args: { path: "notes" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const responses = result.events.filter((event) => event.type === "model.response.completed");
    // A tool-calls-only turn produced no body, so it must not claim one is inline.
    expect(fields(responses[0]!).capture).toBeUndefined();
    expect(fields(responses[0]!).output_summary).toBeUndefined();
    expect(fields(responses[1]!)).toMatchObject({ capture: "inline", output_summary: "done" });
  });

  it("fails the run when the step limit is reached without a final answer", () => {
    const dir = sandbox("limit");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "list_dir", args: { path: "notes" } }] },
        { kind: "tools", calls: [{ tool: "list_dir", args: { path: "notes" } }] },
      ],
      { workdir: dir, maxSteps: 2 },
    );

    expect(result.outcome).toBe("failed");
    const failed = result.events.find((event) => event.type === "run.failed");
    expect(fields(failed!).error).toMatchObject({ type: "step_limit_reached" });
  });

  it("refuses a sandbox escape and names the guard class", () => {
    const dir = sandbox("escape-run");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "../../etc/hostname" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const failed = result.events.find((event) => event.type === "tool.call.failed");
    expect(fields(failed!)).toMatchObject({
      tool: "read_file",
      status: "failed",
      error: { type: "argument_contract" },
      guard: "path_escape",
    });
  });

  it("answers a call to a withheld tool and a call to an unknown tool", () => {
    const dir = sandbox("withheld");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "fetch_url", args: { url: "https://example.com" } }] },
        { kind: "tools", calls: [{ tool: "no_such_tool", args: {} }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const failed = result.events.filter((event) => event.type === "tool.call.failed");
    expect(failed.map((event) => (fields(event).error as { type: string }).type)).toEqual([
      "tool_unavailable",
      "unknown_tool",
    ]);
    expect(result.outcome).toBe("completed");
  });

  it("keeps a throwing tool from ending the run", () => {
    const dir = sandbox("throwing");
    createSandbox(dir);
    const sink = capture();
    const recorder = new TraceRecorder({ runId: "run_throw", write: sink.write });
    const tools = createToolSet();
    tools.push({
      name: "boom",
      description: "always throws",
      parameters: { type: "object" },
      effect: "unknown",
      available: true,
      maxResultBytes: 8,
      run() {
        throw new Error("kaboom");
      },
    });
    const result = runAgent({
      input: "probe",
      model: new ScriptedModel({
        name: "stub",
        steps: [
          { kind: "tools", calls: [{ tool: "boom", args: {} }] },
          { kind: "final", text: "done" },
        ],
      }),
      tools,
      workdir: dir,
      recorder,
    });

    expect(result.outcome).toBe("completed");
    const failed = result.events.find((event) => event.type === "tool.call.failed");
    expect(fields(failed!).error).toMatchObject({ type: "tool_threw", message: "kaboom" });
  });

  it("produces a trace the product's own validator accepts", () => {
    const dir = sandbox("self-check");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "list_dir", args: { path: "notes" } }] },
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "notes/alpha.md" } }] },
        { kind: "tools", calls: [{ tool: "write_file", args: { path: "report.md", content: "r\n" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const check = checkWithProduct(result.events);
    expect(check.messages).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it("produces a trace the product's own validator accepts on the failure paths too", () => {
    const dir = sandbox("self-check-failures");
    createSandbox(dir);
    const { result } = runPlan(
      [
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "../outside.md" } }] },
        { kind: "tools", calls: [{ tool: "fetch_url", args: { url: "https://example.com" } }] },
        { kind: "tools", calls: [{ tool: "no_such_tool", args: {} }] },
        { kind: "tools", calls: [{ tool: "read_file", args: { path: "notes/missing.md" } }] },
        { kind: "final", text: "done" },
      ],
      { workdir: dir },
    );

    const check = checkWithProduct(result.events);
    expect(check.messages).toEqual([]);
    expect(check.valid).toBe(true);
  });
});

describe("spike argument summary", () => {
  it("renders scalars and clips long strings", () => {
    expect(summariseArgs({ path: "notes", max_bytes: 10, deep: true })).toBe("path=notes max_bytes=10 deep=true");
    const long = summariseArgs({ content: "y".repeat(100) });
    expect(long).toBe(`content=${"y".repeat(57)}...`);
    expect(long.length).toBeLessThan(80);
  });

  it("names non-scalar shapes without printing them", () => {
    expect(summariseArgs({ list: [1, 2], obj: { a: 1 } })).toBe("list=<array> obj=<object>");
  });

  it("collapses newlines so a value cannot break the timeline row", () => {
    const summary = summariseArgs({ path: "report.md", content: "# Report\n\nWritten by the spike.\n" });
    expect(summary).toBe("path=report.md content=# Report Written by the spike.");
    expect(summary).not.toContain("\n");
  });
});

describe("spike CLI argument parsing", () => {
  it("requires --out", () => {
    expect(parseSpikeArgs([])).toEqual({ ok: false, error: "--out is required" });
  });

  it("accepts both --flag value and --flag=value", () => {
    expect(parseSpikeArgs(["--out", "a.jsonl"])).toEqual({
      ok: true,
      help: false,
      options: { out: "a.jsonl", workdir: null, steps: 5, keep: false, json: false },
    });
    expect(parseSpikeArgs(["--out=a.jsonl", "--workdir=/tmp/x", "--steps=3", "--keep", "--json"])).toEqual({
      ok: true,
      help: false,
      options: { out: "a.jsonl", workdir: "/tmp/x", steps: 3, keep: true, json: true },
    });
  });

  it("rejects an unknown option, a stray argument and a bad --steps", () => {
    expect(parseSpikeArgs(["--out", "a", "--nope"])).toEqual({ ok: false, error: "unknown option --nope" });
    expect(parseSpikeArgs(["--out", "a", "extra"])).toEqual({ ok: false, error: "unexpected argument extra" });
    expect(parseSpikeArgs(["--out", "a", "--steps", "x"])).toEqual({
      ok: false,
      error: "--steps needs a non-negative integer",
    });
    expect(parseSpikeArgs(["--out", "a", "--steps"])).toEqual({
      ok: false,
      error: "--steps needs a non-negative integer",
    });
  });

  it("rejects an option that needs a value but got another flag", () => {
    expect(parseSpikeArgs(["--out", "--json"])).toEqual({ ok: false, error: "--out needs a path" });
    expect(parseSpikeArgs(["--out=a", "--workdir="])).toEqual({ ok: false, error: "--workdir needs a path" });
  });

  it("treats --help as help wherever it appears", () => {
    expect(parseSpikeArgs(["--out", "a", "--help"])).toEqual({ ok: true, help: true });
  });
});

describe("spike CLI runs", () => {
  function io(): { stdout: string[]; stderr: string[]; sink: { stdout: (t: string) => void; stderr: (t: string) => void } } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { stdout, stderr, sink: { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) } };
  }

  it("writes a validating trace and reports the run", () => {
    const out = join(scratch, "cli-run.jsonl");
    const workdir = sandbox("cli-run");
    const channels = io();
    const code = runSpike(["--out", out, "--workdir", workdir, "--keep", "--json"], channels.sink, {
      removeSandbox: () => {},
    });

    expect(code).toBe(0);
    const report = JSON.parse(channels.stdout.join("")) as Record<string, unknown>;
    expect(report).toMatchObject({
      command: "spike-run",
      run_id: "run_spike_05",
      outcome: "completed",
      steps: 5,
      events: 22,
      output: out,
      validation: { schema: "bundled", valid: true, errors: 0 },
    });

    const loaded = loadTraceFile(out);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.events).toHaveLength(22);
    }
  });

  it("prints terminal text by default and keeps its field order", () => {
    const out = join(scratch, "cli-text.jsonl");
    const channels = io();
    const code = runSpike(["--out", out, "--workdir", sandbox("cli-text"), "--keep"], channels.sink, {
      removeSandbox: () => {},
    });

    expect(code).toBe(0);
    const lines = channels.stdout.join("").trimEnd().split("\n");
    expect(lines.map((line) => line.split(" ")[0])).toEqual([
      "run",
      "outcome",
      "steps",
      "events",
      "workdir",
      "trace",
      "validation",
    ]);
  });

  it("exits 1 when the run itself fails", () => {
    const channels = io();
    const code = runSpike(["--out", join(scratch, "cli-fail.jsonl"), "--workdir", sandbox("cli-fail"), "--steps", "2"], channels.sink, {
      removeSandbox: () => {},
    });
    expect(code).toBe(1);
    expect(channels.stdout.join("")).toContain("outcome failed");
  });

  it("exits 1 when the produced trace does not validate", () => {
    const channels = io();
    const code = runSpike(["--out", join(scratch, "cli-bad.jsonl"), "--workdir", sandbox("cli-bad")], channels.sink, {
      removeSandbox: () => {},
      validateTrace: () => ({ valid: false, errors: 3 }),
    });
    expect(code).toBe(1);
    expect(channels.stderr.join("")).toContain("did not validate (3 error(s))");
  });

  it("exits 3 when the trace cannot be written", () => {
    const channels = io();
    const code = runSpike(["--out", join(scratch, "no", "such", "dir", "t.jsonl"), "--workdir", sandbox("cli-unwritable")], channels.sink, {
      removeSandbox: () => {},
    });
    expect(code).toBe(3);
    expect(channels.stderr.join("")).toContain("cannot write the trace");
  });

  it("exits 2 when the sandbox cannot be prepared", () => {
    const channels = io();
    const code = runSpike(["--out", join(scratch, "cli-sandbox.jsonl"), "--workdir", join(scratch, "a-file-not-a-dir")], channels.sink, {
      createSandbox: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(code).toBe(2);
    expect(channels.stderr.join("")).toContain("cannot prepare the sandbox");
  });

  it("exits 64 on an unusable command line and prints usage", () => {
    for (const argv of [[], ["--nope"], ["--out"]]) {
      const channels = io();
      const code = runSpike(argv, channels.sink);
      expect(code).toBe(64);
      expect(channels.stderr.join("")).toContain("usage: spike-run");
    }
  });

  it("prints usage and exits 0 for --help", () => {
    const channels = io();
    const code = runSpike(["--help"], channels.sink);
    expect(code).toBe(0);
    expect(channels.stdout.join("")).toContain("usage: spike-run");
  });

  it("cleans up a sandbox it created", () => {
    const created: string[] = [];
    const removed: string[] = [];
    const channels = io();
    const code = runSpike(["--out", join(scratch, "cli-cleanup.jsonl")], channels.sink, {
      makeSandbox: () => {
        const dir = sandbox(`created-${created.length}`);
        created.push(dir);
        return dir;
      },
      removeSandbox: (dir) => removed.push(dir),
    });
    expect(code).toBe(0);
    expect(created).toHaveLength(1);
    expect(removed).toEqual(created);
  });

  it("keeps a sandbox it created when --keep is given", () => {
    const created: string[] = [];
    const removed: string[] = [];
    const channels = io();
    const code = runSpike(["--out", join(scratch, "cli-keep.jsonl"), "--keep"], channels.sink, {
      makeSandbox: () => {
        const dir = sandbox(`kept-${created.length}`);
        created.push(dir);
        return dir;
      },
      removeSandbox: (dir) => removed.push(dir),
    });
    expect(code).toBe(0);
    expect(created).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  it("leaves no validation scratch directory behind", () => {
    // The self-check writes the produced trace to a temp file so the loader can read
    // it back. That directory used to outlive the call and nothing reaped it: 61 had
    // piled up under the OS temp directory before this was fixed. Counting the
    // prefix before and after is sound because this is the only suite that reaches
    // the default validation path, and tests in one file run in order.
    const prefix = "trace-doctor-check-";
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)).length;
    const channels = io();
    const code = runSpike(["--out", join(scratch, "cli-leak.jsonl")], channels.sink);
    expect(code).toBe(0);
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)).length;
    expect(after).toBe(before);
  });
});

describe("spike committed example", () => {
  it("is a real five-step run that validates against the bundled schema", () => {
    const loaded = loadTraceFile(join(projectRoot, "examples", "spike-run.jsonl"));
    if (!loaded.ok) {
      throw new Error(`the committed spike example did not load: ${loaded.message}`);
    }
    const check = checkWithProduct(loaded.events.map((entry) => entry.event as TraceEvent));
    expect(check.messages).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it("carries the shape the schema revision was made for", () => {
    const events = readEvents("examples/spike-run.jsonl");

    // Five model turns, four tool calls, one permission decision, one terminal event.
    expect(events.filter((event) => event.type === "model.request.started")).toHaveLength(5);
    expect(events.filter((event) => event.type === "model.response.completed")).toHaveLength(5);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(4);
    expect(events.filter((event) => event.type === "permission.requested")).toHaveLength(1);

    // The tool set is recorded at run start, with the withheld tool visible.
    const started = payloadOf(events[0]!);
    const config = started.config_summary as Record<string, unknown>;
    const tools = config.tools as Array<{ name: string; schema_hash: string; available: boolean }>;
    expect(tools.filter((tool) => !tool.available).map((tool) => tool.name)).toEqual(["fetch_url"]);

    // effect_disposition separates the read-only calls from the one that wrote.
    const dispositions = events
      .filter((event) => event.type === "tool.call.completed")
      .map((event) => payloadOf(event).effect_disposition);
    expect(dispositions).toEqual(["none", "none", "applied", "none"]);

    // capture is claimed only on the turns that produced text.
    const responses = events.filter((event) => event.type === "model.response.completed").map((event) => payloadOf(event));
    expect(responses.filter((payload) => payload.capture === "inline")).toHaveLength(2);

    // Every tool call is linked to its request by tool_call_id.
    const startedCalls = events
      .filter((event) => event.type === "tool.call.started")
      .map((event) => payloadOf(event).tool_call_id);
    expect(startedCalls).toEqual(["call_1_1", "call_2_1", "call_3_1", "call_4_1"]);
  });

  it("renders in the product timeline with the effect visible", () => {
    const loaded = loadTraceFile(join(projectRoot, "examples", "spike-run.jsonl"));
    if (!loaded.ok) {
      throw new Error(`the committed spike example did not load: ${loaded.message}`);
    }
    const descriptions = loaded.events.map((entry) => describeEvent(entry.event));
    // "tool result" is the head describeEvent uses for a completed call, which is
    // what distinguishes it from the permission event that also names write_file.
    const results = descriptions.filter((text) => text.startsWith("tool result"));
    expect(results).toHaveLength(4);
    expect(results.filter((text) => text.includes("effect applied"))).toHaveLength(1);
    expect(results.filter((text) => text.includes("effect none"))).toHaveLength(3);
    for (const text of descriptions) {
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
    }
  });

  it("keeps every argument summary on one line", () => {
    // The committed example is regenerated by hand, so it can drift from the code
    // that produced it. The summariseArgs fix that collapses whitespace landed
    // after this file was first generated, and the stale copy kept the multi-line
    // write_file content, which wrapped the timeline row across two lines. This
    // asserts the artifact still matches the code rather than trusting the date.
    const events = readEvents("examples/spike-run.jsonl");
    const summaries = events
      .filter((event) => event.type === "tool.call.started")
      .map((event) => payloadOf(event).args_summary)
      .filter((value): value is string => typeof value === "string");
    expect(summaries).toHaveLength(4);
    for (const summary of summaries) {
      expect(summary).not.toContain("\n");
      expect(summary).not.toContain("\r");
    }
  });
});
