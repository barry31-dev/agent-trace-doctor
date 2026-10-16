/**
 * Command line for the mini agent spike.
 *
 * `spike-run` builds a sandbox, runs the five-step scripted agent inside it, writes
 * the resulting trace and then validates that trace with the product's own
 * validator before reporting success. The self-check is the point: a recorder that
 * emits a file its own tool rejects is a bug, and this is the cheapest place to
 * catch it.
 *
 * This is a development tool, not part of the published CLI. It exists to
 * answer one question: what does a real five-step run look like in the trace
 * format, and what does the schema fail to express?
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "./agent.js";
import type { AgentRunResult } from "./agent.js";
import { ScriptedModel } from "./model.js";
import { createToolSet } from "./tools.js";
import { TraceRecorder } from "./recorder.js";
import { loadTraceFile } from "../src/loader.js";
import { BUNDLED_SCHEMA_LABEL, loadValidator } from "../src/schema.js";
import { validateEvents } from "../src/validate.js";

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_UNREADABLE = 2;
export const EXIT_REPORT_FAILED = 3;
/** EX_USAGE: the command line itself could not be understood. */
export const EXIT_USAGE = 64;

const USAGE = `usage: spike-run --out FILE [options]

Runs a five-step mini agent inside a throwaway sandbox and writes the trace it
produces. The trace is then validated with the bundled schema; if it does not
validate, the command exits 1 and says why.

Options:
  --out FILE       write the trace here ("-" for stdout)
  --workdir DIR    use this directory as the sandbox (default: a fresh temp dir)
  --steps N        model turns to allow (default: 5)
  --keep           do not delete a sandbox this command created
  --json           print the run report as JSON instead of terminal text
  -h, --help       show this message

Exit codes:
  0   the run completed and its trace validated
  1   the run failed, or its trace did not validate
  2   the sandbox could not be prepared, or the run threw
  3   the report could not be written
  64  the command line could not be understood`;

export interface SpikeIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

interface ParsedOptions {
  out: string;
  workdir: string | null;
  steps: number;
  keep: boolean;
  json: boolean;
}

type ParseResult =
  | { ok: true; help: true }
  | { ok: true; help: false; options: ParsedOptions }
  | { ok: false; error: string };

export function parseSpikeArgs(argv: string[]): ParseResult {
  let out: string | null = null;
  let workdir: string | null = null;
  let steps = 5;
  let keep = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--keep") {
      keep = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { ok: true, help: true };
    }
    if (arg === "--steps") {
      const value = argv[index + 1];
      if (value === undefined || !/^[0-9]+$/.test(value)) {
        return { ok: false, error: "--steps needs a non-negative integer" };
      }
      steps = Number(value);
      index += 1;
      continue;
    }
    if (arg === "--out" || arg === "--workdir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `${arg} needs a path` };
      }
      if (arg === "--out") {
        out = value;
      } else {
        workdir = value;
      }
      index += 1;
      continue;
    }
    const inline = ["--out=", "--workdir=", "--steps="].find((flag) => arg.startsWith(flag));
    if (inline !== undefined) {
      const value = arg.slice(inline.length);
      if (inline === "--steps=") {
        if (!/^[0-9]+$/.test(value)) {
          return { ok: false, error: "--steps needs a non-negative integer" };
        }
        steps = Number(value);
        continue;
      }
      if (value.length === 0) {
        return { ok: false, error: `${inline.slice(0, -1)} needs a path` };
      }
      if (inline === "--out=") {
        out = value;
      } else {
        workdir = value;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option ${arg}` };
    }
    return { ok: false, error: `unexpected argument ${arg}` };
  }

  if (out === null) {
    return { ok: false, error: "--out is required" };
  }
  return { ok: true, help: false, options: { out, workdir, steps, keep, json } };
}

/** The task the spike agent is given. */
export const SPIKE_INPUT =
  "List the notes directory, read the first note, write report.md from it, then read report.md back";

/** The five-step plan the scripted model replays. */
export function spikePlan() {
  return [
    {
      kind: "tools" as const,
      text: "I will start by looking at what is in the notes directory.",
      calls: [{ tool: "list_dir", args: { path: "notes" } }],
    },
    {
      kind: "tools" as const,
      calls: [{ tool: "read_file", args: { path: "notes/alpha.md" } }],
    },
    {
      kind: "tools" as const,
      calls: [
        {
          tool: "write_file",
          args: { path: "report.md", content: "# Report\n\nWritten by the Agent Trace Doctor spike.\n" },
        },
      ],
    },
    {
      kind: "tools" as const,
      calls: [{ tool: "read_file", args: { path: "report.md" } }],
    },
    {
      kind: "final" as const,
      text: "Done: I listed the notes, read notes/alpha.md, wrote report.md and read it back to confirm.",
    },
  ];
}

const NOTE_ALPHA = `# Alpha

The first synthetic note of the spike sandbox.
It exists so list_dir and read_file have something real to read.
`;

const NOTE_BETA = `# Beta

The second synthetic note of the spike sandbox.
It is listed but never read by the five-step plan.
`;

const NOTE_GAMMA = `# Gamma

The third synthetic note of the spike sandbox.
`;

/** Builds the sandbox the agent works in. */
export function createSandbox(workdir: string): void {
  mkdirSync(join(workdir, "notes"), { recursive: true });
  writeFileSync(join(workdir, "notes", "alpha.md"), NOTE_ALPHA, "utf8");
  writeFileSync(join(workdir, "notes", "beta.md"), NOTE_BETA, "utf8");
  writeFileSync(join(workdir, "notes", "gamma.md"), NOTE_GAMMA, "utf8");
}

export interface SpikeReport {
  command: "spike-run";
  run_id: string;
  outcome: "completed" | "failed";
  steps: number;
  events: number;
  output: string;
  workdir: string;
  sandbox_created: boolean;
  validation: { schema: string; valid: boolean; errors: number };
}

function renderText(report: SpikeReport): string {
  const lines = [
    `run ${report.run_id}`,
    `outcome ${report.outcome}`,
    `steps ${report.steps}`,
    `events ${report.events}`,
    `workdir ${report.workdir}`,
    `trace ${report.output}`,
    `validation ${report.validation.schema} ${report.validation.valid ? "ok" : "failed"} (${report.validation.errors} error(s))`,
  ];
  return `${lines.join("\n")}\n`;
}

function renderJsonReport(report: SpikeReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export interface SpikeDependencies {
  /** Overridable so tests can run without a real file system. */
  createSandbox?: (workdir: string) => void;
  makeSandbox?: () => string;
  removeSandbox?: (workdir: string) => void;
  /**
   * Overridable so a test can force the "the trace did not validate" branch without
   * having to make the recorder emit something broken.
   */
  validateTrace?: (text: string) => { valid: boolean; errors: number };
}

/**
 * Runs the spike and returns the process exit code. IO and the sandbox factory are
 * injected so tests can assert on the exact text and code without a subprocess.
 */
export function runSpike(
  argv: string[],
  io: SpikeIO = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  deps: SpikeDependencies = {},
): number {
  const parsed = parseSpikeArgs(argv);
  if (!parsed.ok) {
    io.stderr(`error: ${parsed.error}\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  if (parsed.help) {
    io.stdout(`${USAGE}\n`);
    return EXIT_OK;
  }

  const { out, workdir, steps, keep, json } = parsed.options;

  const makeSandbox = deps.makeSandbox ?? (() => mkdtempSync(join(tmpdir(), "trace-doctor-spike-")));
  const removeSandbox = deps.removeSandbox ?? ((dir) => rmSync(dir, { recursive: true, force: true }));
  const build = deps.createSandbox ?? createSandbox;

  let sandbox: string;
  let sandboxCreated = false;
  try {
    if (workdir === null) {
      sandbox = makeSandbox();
      sandboxCreated = true;
    } else {
      sandbox = workdir;
    }
    build(sandbox);
  } catch (error) {
    io.stderr(`error: cannot prepare the sandbox (${error instanceof Error ? error.message : String(error)})\n`);
    return EXIT_UNREADABLE;
  }

  const lines: string[] = [];
  const recorder = new TraceRecorder({
    runId: `run_spike_${String(steps).padStart(2, "0")}`,
    write: (line) => lines.push(line),
  });

  let result: AgentRunResult;
  try {
    result = runAgent({
      input: SPIKE_INPUT,
      model: new ScriptedModel({ name: "scripted-stub-1", steps: spikePlan() }),
      tools: createToolSet(),
      workdir: sandbox,
      recorder,
      maxSteps: steps,
    });
  } catch (error) {
    if (sandboxCreated && !keep) {
      removeSandbox(sandbox);
    }
    io.stderr(`error: the spike run threw (${error instanceof Error ? error.message : String(error)})\n`);
    return EXIT_UNREADABLE;
  }

  const traceText = lines.length > 0 ? `${lines.join("")}` : "";

  if (out !== "-") {
    try {
      writeFileSync(out, traceText, "utf8");
    } catch (error) {
      if (sandboxCreated && !keep) {
        removeSandbox(sandbox);
      }
      io.stderr(`error: cannot write the trace to ${out} (${error instanceof Error ? error.message : String(error)})\n`);
      return EXIT_REPORT_FAILED;
    }
  }

  // Self-check with the product's own loader and validator. The loader reads the
  // text that was actually produced, so this also proves the in-memory events and
  // the serialized lines agree.
  const check = deps.validateTrace ?? defaultValidation;
  const { valid, errors: errorCount } = check(traceText);

  if (sandboxCreated && !keep) {
    removeSandbox(sandbox);
  }

  const report: SpikeReport = {
    command: "spike-run",
    run_id: recorder.runId,
    outcome: result.outcome,
    steps: result.steps,
    events: result.events.length,
    output: out,
    workdir: sandbox,
    sandbox_created: sandboxCreated,
    validation: { schema: BUNDLED_SCHEMA_LABEL, valid, errors: errorCount },
  };

  io.stdout(json ? renderJsonReport(report) : renderText(report));

  if (result.outcome !== "completed") {
    return EXIT_INVALID;
  }
  if (!valid) {
    io.stderr(`error: the trace this run produced did not validate (${errorCount} error(s))\n`);
    return EXIT_INVALID;
  }
  return EXIT_OK;
}

/**
 * The default self-check: hand the produced text to the product's own loader and
 * validator. Always through a temp file, even when the trace was also written to
 * `--out`, so the result never depends on whether the caller could write to the
 * output path.
 */
function defaultValidation(text: string): { valid: boolean; errors: number } {
  const schema = loadValidator(null);
  if (!schema.ok) {
    return { valid: false, errors: 1 };
  }
  const dir = mkdtempSync(join(tmpdir(), "trace-doctor-check-"));
  try {
    const path = join(dir, "trace.jsonl");
    writeFileSync(path, text, "utf8");
    const loaded = loadTraceFile(path);
    if (!loaded.ok) {
      return { valid: false, errors: 1 };
    }
    const report = validateEvents(path, BUNDLED_SCHEMA_LABEL, loaded.events, schema.validate, "spike-run");
    return { valid: report.valid, errors: report.errors.length };
  } finally {
    // The self-check only needs the file to exist for the length of the call. Left
    // behind it accumulates one directory per invocation, and nothing ever reaps
    // them: 61 had piled up under the OS temp directory by the time this was fixed.
    rmSync(dir, { recursive: true, force: true });
  }
}
