import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXIT_INVALID,
  EXIT_OK,
  EXIT_REPORT_FAILED,
  EXIT_UNREADABLE,
  EXIT_USAGE,
  EXIT_MODEL_UNAVAILABLE,
  EXIT_MODEL_UNUSABLE,
  main,
  runExplain,
  runDiff,
  runCompare,
  runShow,
  runErrors,
  runEvalGen,
  runFixSuggest,
  runSummary,
  runTimeline,
  runTools,
  runValidate,
} from "../src/cli.js";
import type { SummaryReport } from "../src/analyze.js";
import type { TimelineReport } from "../src/analyze.js";
import type { ValidationReport } from "../src/validate.js";
import { buildErrors } from "../src/errors.js";
import { buildEvalGen, readInputSummary } from "../src/evalGen.js";
import type { EvalGenReport } from "../src/evalGen.js";
import { buildFixSuggest } from "../src/fixSuggest.js";
import { buildFixSuggestDraft, withoutFixSuggestModel } from "../src/fixSuggestModel.js";
import { EVAL_GEN_NO_MODEL_NOTE } from "../src/evalGenModel.js";
import { renderEvalGenJson, renderFixSuggestModelJson } from "../src/report.js";
import { loadTraceFile } from "../src/loader.js";
import { DEFAULT_MAX_EXCERPT_EVENTS } from "../src/model/config.js";
import { COMPARE_SYSTEM_PROMPT, COMPARE_TASK } from "../src/model/contract.js";
import { projectRoot } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "agent-trace-doctor-cli-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeScratch(name: string, content: string): string {
  const path = join(scratch, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function example(name: string): string {
  return join(projectRoot, "examples", name);
}

async function runMain(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main(argv, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

function parseReport(stdout: string): ValidationReport {
  return JSON.parse(stdout) as ValidationReport;
}

/** The deterministic `eval-gen` report for one example, which is what `--out` writes. */
function reportOf(name: string): EvalGenReport {
  const events = loadTraceFile(example(name));
  if (!events.ok) {
    throw new Error(`fixture ${name} did not load: ${events.message}`);
  }
  return buildEvalGen(buildErrors(example(name), "bundled", events.events), readInputSummary(events.events));
}

function parseSummary(stdout: string): SummaryReport {
  return JSON.parse(stdout) as SummaryReport;
}

function parseTimeline(stdout: string): TimelineReport {
  return JSON.parse(stdout) as TimelineReport;
}

const INVALID_TRACE =
  '{"schema_version":"1","event_id":"evt_000001","timestamp":"2026-10-14T10:00:00.000Z","type":"tool.call.started","run_id":"run_01","payload":{}}\n';

describe("cli: validate", () => {
  it("exits 0 and prints one ok line for a valid trace", () => {
    const outcome = runValidate([example("success.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toBe("ok: " + example("success.jsonl") + ": 19 events validated against bundled\n");
  });

  it("exits 0 for the failed and cancelled examples, which are well formed", () => {
    for (const name of ["failed.jsonl", "cancelled.jsonl"]) {
      const outcome = runValidate([example(name)]);
      expect(outcome.exitCode).toBe(EXIT_OK);
    }
  });

  it("prints a report with stable top-level keys in --json mode", () => {
    const outcome = runValidate([example("success.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(Object.keys(parseReport(outcome.stdout))).toEqual([
      "command",
      "file",
      "schema",
      "events",
      "valid",
      "errors",
    ]);
  });

  it("uses no escape sequences in terminal output", () => {
    const outcome = runValidate([example("failed.jsonl")]);
    expect(outcome.stdout).not.toContain(String.fromCharCode(27));
  });

  it("exits 1 and names the line for a schema failure", () => {
    const path = writeScratch(
      "invalid.jsonl",
      '{"schema_version":"1","event_id":"evt_000001","timestamp":"2026-10-14T10:00:00.000Z","type":"tool.call.started","run_id":"run_01","payload":{}}\n',
    );
    const outcome = runValidate([path]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(outcome.stdout).toContain("line 1");
    expect(outcome.stdout).toContain("/payload/tool");
    expect(outcome.stdout).toContain("invalid: 1 error in");
  });

  it("keeps the same event id in the report so a line can be traced back", () => {
    const path = writeScratch(
      "with-id.jsonl",
      '{"schema_version":"1","event_id":"evt_000004","timestamp":"2026-10-14T10:00:00.000Z","type":"tool.call.started","run_id":"run_01","payload":{}}\n',
    );
    const outcome = runValidate([path, "--json"]);
    const report = parseReport(outcome.stdout);
    expect(report.errors[0]?.event_id).toBe("evt_000004");
    expect(report.errors[0]?.line).toBe(1);
  });

  it("exits 2 for a missing file", () => {
    const outcome = runValidate([join(scratch, "nope.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
    expect(outcome.stdout).toContain("ENOENT");
    expect(outcome.stdout).toContain("input could not be read");
  });

  it("exits 2 for an empty file", () => {
    const outcome = runValidate([writeScratch("empty.jsonl", "")]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
    expect(outcome.stdout).toContain("no trace events");
  });

  it("exits 2 for invalid UTF-8", () => {
    const path = join(scratch, "bad-utf8.jsonl");
    writeFileSync(path, Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
    const outcome = runValidate([path]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
    expect(outcome.stdout).toContain("not valid UTF-8");
  });

  it("exits 2 and names the line for a line that is not JSON", () => {
    const path = writeScratch("bad-json.jsonl", '{"a":1}\nnope\n');
    const outcome = runValidate([path]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
    expect(outcome.stdout).toContain("line 2");
  });

  it("accepts --schema=PATH as well as --schema PATH", () => {
    const schemaPath = join(scratch, "custom.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      }),
      "utf8",
    );
    const trace = writeScratch("for-custom.jsonl", '{"schema_version":"1"}\n');
    const spaced = runValidate([trace, "--schema", schemaPath, "--json"]);
    const joined = runValidate([trace, `--schema=${schemaPath}`, "--json"]);
    expect(spaced.stdout).toBe(joined.stdout);
    expect(parseReport(spaced.stdout).schema).toBe(schemaPath);
  });
});

describe("cli: command line handling", () => {
  it("prints usage and exits 0 for --help", async () => {
    const outcome = await runMain(["--help"]);
    expect(outcome.code).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("usage: trace COMMAND");
  });

  it("prints the validate usage and exits 0 for validate --help", () => {
    const outcome = runValidate(["--help"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("usage: trace validate FILE");
  });

  it("exits 64 when no command is given", async () => {
    const outcome = await runMain([]);
    expect(outcome.code).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("a command is required");
  });

  it("exits 64 for an unknown command", async () => {
    const outcome = await runMain(["frobnicate"]);
    expect(outcome.code).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("unknown command frobnicate");
  });

  it("exits 64 when validate has no file", () => {
    const outcome = runValidate([]);
    expect(outcome.exitCode).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("a trace file is required");
  });

  it("exits 64 for an unknown option", () => {
    const outcome = runValidate([example("success.jsonl"), "--colour"]);
    expect(outcome.exitCode).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("unknown option --colour");
  });

  it("exits 64 for a second positional argument", () => {
    const outcome = runValidate([example("success.jsonl"), example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("unexpected extra argument");
  });

  it("exits 64 when --schema has no value", () => {
    const outcome = runValidate([example("success.jsonl"), "--schema"]);
    expect(outcome.exitCode).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("--schema needs a file path");
  });
});

describe("cli: writing the report", () => {
  it("writes the report to the injected streams and returns the code", async () => {
    const written: string[] = [];
    const errors: string[] = [];
    const code = await main(["validate", example("success.jsonl")], {
      stdout: (text) => written.push(text),
      stderr: (text) => errors.push(text),
    });
    expect(code).toBe(EXIT_OK);
    expect(written.join("")).toContain("ok:");
    expect(errors).toEqual([]);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["validate", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: fix-suggest --model", () => {
  let server: Server;
  let port: number;
  let requestBodies: string[] = [];
  let answer: unknown = {
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({
            findings: [
              {
                severity: "warning",
                evidence: ["evt_000016"],
                claim: "the two tool_error occurrences carry different messages, so the shared-cause direction rests on two failures",
                confidence: "medium",
                suggestion: "read both occurrences before looking for one cause",
              },
            ],
            unverified: ["the quoted events do not say whether the two reads were the same mistake"],
          }),
        },
      },
    ],
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestBodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requestBodies = [];
  });

  function modelArgs(extra: string[] = []): string[] {
    return [example("failed.jsonl"), "--model", "--model-name", "stub-model", ...extra];
  }

  function stubEnv(): void {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
  }

  it("sends the suggestions and the events they cite, and adds the findings", async () => {
    stubEnv();
    const outcome = await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("find_1  warning  confidence medium  evidence evt_000016");
    expect(outcome.stdout).toContain("the two tool_error occurrences carry different messages");
    expect(outcome.stdout).toContain("provider         openai-compatible");
    expect(outcome.stdout).toContain("model            stub-model");
    expect(outcome.stdout).toContain("requests         1");
    // Five events: the four suggestions cite five distinct ones, and the class that was
    // both fatal and repeated is not quoted twice.
    expect(outcome.stdout).toContain("events sent      5");
    expect(outcome.stdout).toContain("error            none");
    expect(outcome.stdout).toContain("- the quoted events do not say whether the two reads were the same mistake");
    // The deterministic directions come first and are unchanged by what the model said.
    expect(outcome.stdout).toContain("sug_001  repeated_error_class  tool_error x2");
    expect(outcome.stdout).toContain("suggestions  4");
  });

  it("sends one observation per suggestion and quotes only the events they cite", async () => {
    stubEnv();
    await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    expect(requestBodies).toHaveLength(1);
    const sent = JSON.parse(requestBodies[0] ?? "{}") as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(sent.model).toBe("stub-model");
    const payload = JSON.parse(sent.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["task", "output_contract", "observations", "events"]);
    const observations = payload.observations as { id: string; kind: string; event_id: string; statement: string }[];
    expect(observations.map((observation) => observation.id)).toEqual(["obs_001", "obs_002", "obs_003", "obs_004"]);
    expect(observations.every((observation) => observation.kind === "suggestion")).toBe(true);
    // Every observation is anchored to a real event of the suggestion it restates, and
    // quotes that suggestion's own action rather than a paraphrase of it.
    expect(observations[0]?.event_id).toBe("evt_000016");
    expect(observations[0]?.statement).toContain("look for one shared cause across the 2 occurrences of tool_error");
    // Only the five events the four suggestions cite, and nothing else: not the events
    // those relate to, and not the events nothing was derived from.
    const events = payload.events as { event_id: string }[];
    expect(events.map((event) => event.event_id)).toEqual([
      "evt_000013",
      "evt_000015",
      "evt_000016",
      "evt_000022",
      "evt_000023",
    ]);
  });

  it("keeps the file path out of the request unless --send-paths is given", async () => {
    stubEnv();
    await runFixSuggest(modelArgs(["--send-paths"]));
    vi.unstubAllEnvs();
    const sent = JSON.parse(requestBodies[0] ?? "{}") as { messages: { role: string; content: string }[] };
    const payload = JSON.parse(sent.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(payload.file).toBe(example("failed.jsonl"));
    requestBodies = [];
    stubEnv();
    await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    const without = JSON.parse(requestBodies[0] ?? "{}") as { messages: { role: string; content: string }[] };
    expect(JSON.parse(without.messages[1]?.content ?? "{}").file).toBeUndefined();
  });

  it("makes no request at all when the trace has nothing to suggest", async () => {
    stubEnv();
    const outcome = await runFixSuggest([example("success.jsonl"), "--model", "--model-name", "stub-model"]);
    vi.unstubAllEnvs();
    // Nothing was attempted, so nothing failed: the deterministic report stands, the model
    // section says why no request left the machine, and the exit code stays 0.
    expect(requestBodies).toHaveLength(0);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("requests         0");
    expect(outcome.stdout).toContain("(no suggestions)");
    expect(outcome.stdout).toContain("there is no direction for a model to review");
  });

  it("exits 65 and keeps the suggestions when the answer cannot be used", async () => {
    answer = { choices: [{ message: { role: "assistant", content: "I am not sure, sorry." } }] };
    stubEnv();
    const outcome = await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    expect(outcome.stdout).toContain("sug_001  repeated_error_class  tool_error x2");
    expect(outcome.stdout).toContain("findings\n  none");
    expect(outcome.stdout).toContain("error            bad_shape");
    answer = {
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              findings: [
                {
                  severity: "warning",
                  evidence: ["evt_999999"],
                  claim: "this event does not exist",
                  confidence: "low",
                  suggestion: "fabricated",
                },
              ],
            }),
          },
        },
      ],
    };
    stubEnv();
    const fabricated = await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    expect(fabricated.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    expect(fabricated.stdout).toContain("error            unknown_evidence");
    expect(fabricated.stdout).toContain("sug_001  repeated_error_class  tool_error x2");
  });

  it("exits 69 when no usable answer is obtained", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const noKey = await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    expect(noKey.exitCode).toBe(EXIT_MODEL_UNAVAILABLE);
    expect(noKey.stdout).toContain("error            no_api_key");
    expect(noKey.stdout).toContain("sug_001  repeated_error_class  tool_error x2");

    answer = { choices: [{ message: { role: "assistant", content: "" } }] };
    stubEnv();
    const empty = await runFixSuggest(modelArgs());
    vi.unstubAllEnvs();
    expect(empty.exitCode).toBe(EXIT_MODEL_UNAVAILABLE);
    expect(empty.stdout).toContain("error            empty_answer");
  });
});

describe("cli: summary", () => {
  it("exits 0 and prints aligned label/value lines", () => {
    const outcome = runSummary([example("success.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("status ");
    expect(outcome.stdout).toContain("duration ");
    expect(outcome.stdout).toContain("4630 ms");
    expect(outcome.stdout.split("\n").every((line) => line.trimEnd() === line)).toBe(true);
  });

  it("uses no escape sequences and no blank lines", () => {
    const outcome = runSummary([example("failed.jsonl")]);
    expect(outcome.stdout).not.toContain(String.fromCharCode(27));
    expect(outcome.stdout.split("\n").filter((line) => line.length === 0)).toHaveLength(1);
  });

  it("prints a report with stable top-level keys in --json mode", () => {
    const outcome = runSummary([example("success.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(Object.keys(parseSummary(outcome.stdout))).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "status",
      "terminal_event_id",
      "started_at",
      "ended_at",
      "duration_ms",
      "events",
      "models",
      "model_requests",
      "model_responses_completed",
      "model_responses_failed",
      "tool_calls",
      "tool_calls_completed",
      "tool_calls_failed",
      "tool_guardrail_refusals",
      "permissions_requested",
      "permissions_approved",
      "permissions_denied",
      "context_compactions",
      "errors_recorded",
      "errors_fatal",
      "tokens",
    ]);
  });

  it("produces byte-identical output for identical input", () => {
    const first = runSummary([example("failed.jsonl"), "--json"]);
    const second = runSummary([example("failed.jsonl"), "--json"]);
    expect(first.stdout).toBe(second.stdout);
  });

  it("exits 1 and reports validation errors instead of summarizing a bad trace", () => {
    const outcome = runSummary([writeScratch("summary-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    const report = parseReport(outcome.stdout);
    expect(report.command).toBe("summary");
    expect(report.valid).toBe(false);
    expect(report.errors[0]?.path).toBe("/payload/tool");
  });

  it("exits 2 for a missing file and for an empty file", () => {
    const missing = runSummary([join(scratch, "nope.jsonl")]);
    expect(missing.exitCode).toBe(EXIT_UNREADABLE);
    const empty = runSummary([writeScratch("summary-empty.jsonl", "")]);
    expect(empty.exitCode).toBe(EXIT_UNREADABLE);
    expect(empty.stdout).toContain("no trace events");
  });

  it("exits 64 for a missing file argument, an unknown option and an extra argument", () => {
    expect(runSummary([]).exitCode).toBe(EXIT_USAGE);
    expect(runSummary([example("success.jsonl"), "--colour"]).exitCode).toBe(EXIT_USAGE);
    expect(runSummary([example("success.jsonl"), example("failed.jsonl")]).exitCode).toBe(EXIT_USAGE);
  });

  it("prints the summary usage and exits 0 for --help", () => {
    const outcome = runSummary(["--help"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("usage: trace summary FILE");
  });

  it("honours --schema like validate does", () => {
    const schemaPath = join(scratch, "summary.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      }),
      "utf8",
    );
    const trace = writeScratch("summary-custom.jsonl", '{"note":"x"}\n');
    const outcome = runSummary([trace, "--schema", schemaPath, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(parseSummary(outcome.stdout).schema).toBe(schemaPath);
  });
});

describe("cli: timeline", () => {
  it("exits 0 and prints one line per event with a header", () => {
    const outcome = runTimeline([example("success.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    const lines = outcome.stdout.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain("event_id");
    expect(lines[0]).toContain("summary");
    expect(lines[1]).toContain("evt_000001");
  });

  it("prints a report with stable keys in --json mode", () => {
    const outcome = runTimeline([example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    const report = parseTimeline(outcome.stdout);
    expect(Object.keys(report)).toEqual(["command", "file", "schema", "run_id", "steps", "events"]);
    expect(Object.keys(report.events[0] ?? {})).toEqual([
      "index",
      "step",
      "line",
      "event_id",
      "timestamp",
      "offset_ms",
      "duration_ms",
      "type",
      "summary",
    ]);
    expect(report.events).toHaveLength(26);
  });

  it("keeps every event id traceable back to a line", () => {
    const report = parseTimeline(runTimeline([example("failed.jsonl"), "--json"]).stdout);
    const ids = report.events.map((entry) => entry.event_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(report.events.every((entry) => entry.line >= 1 && entry.summary.length > 0)).toBe(true);
  });

  it("produces byte-identical output for identical input", () => {
    const first = runTimeline([example("cancelled.jsonl")]);
    const second = runTimeline([example("cancelled.jsonl")]);
    expect(first.stdout).toBe(second.stdout);
  });

  it("exits 1 for a trace that fails validation", () => {
    const outcome = runTimeline([writeScratch("timeline-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).command).toBe("timeline");
  });

  it("exits 2 for a file that cannot be read", () => {
    const path = join(scratch, "timeline-utf8.jsonl");
    writeFileSync(path, Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
    expect(runTimeline([path]).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 64 when the command line is not understood", () => {
    expect(runTimeline([]).exitCode).toBe(EXIT_USAGE);
    expect(runTimeline([example("success.jsonl"), "--nope"]).exitCode).toBe(EXIT_USAGE);
    expect(runTimeline(["--help"]).exitCode).toBe(EXIT_OK);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["timeline", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: dispatch", () => {
  it("lists every implemented command in the top-level usage", async () => {
    const outcome = await runMain(["--help"]);
    expect(outcome.code).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("summary FILE");
    expect(outcome.stdout).toContain("timeline FILE");
    expect(outcome.stdout).toContain("show FILE [--event ID]");
    expect(outcome.stdout).toContain("tools FILE");
    expect(outcome.stdout).toContain("errors FILE");
    expect(outcome.stdout).toContain("diff FILE FILE");
    expect(outcome.stdout).toContain("compare FILE FILE");
  });

  it("exits 64 for an unknown command that is not a prefix of a real one", async () => {
    expect((await runMain(["sum"])).code).toBe(EXIT_USAGE);
    expect((await runMain(["frobnicate"])).code).toBe(EXIT_USAGE);
  });
});

describe("cli: show", () => {
  it("exits 0 and prints one event when --event names it", () => {
    const outcome = runShow([example("failed.jsonl"), "--event", "evt_000013"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("event    evt_000013");
    expect(outcome.stdout).toContain("line     13");
    expect(outcome.stdout).toContain("payload");
  });

  it("exits 0 and prints every event when --event is omitted", () => {
    const outcome = runShow([example("cancelled.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    const report = JSON.parse(outcome.stdout) as { command: string; events: number; selected: unknown[] };
    expect(report.command).toBe("show");
    expect(report.events).toBe(8);
    expect(report.selected).toHaveLength(8);
  });

  it("accepts --event=ID as well as --event ID", () => {
    const spaced = runShow([example("success.jsonl"), "--event", "evt_000005", "--json"]);
    const joined = runShow([example("success.jsonl"), "--event=evt_000005", "--json"]);
    expect(spaced.stdout).toBe(joined.stdout);
  });

  it("exits 1 and names the id when --event names an event the file does not carry", () => {
    const outcome = runShow([example("failed.jsonl"), "--event", "evt_999999"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("no event with id evt_999999 in");
  });

  it("exits 1 and reports validation errors instead of showing an invalid trace", () => {
    const outcome = runShow([writeScratch("show-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).command).toBe("show");
  });

  it("exits 2 for a file that cannot be read", () => {
    expect(runShow([join(scratch, "show-missing.jsonl")]).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("honours --schema like validate does", () => {
    const schemaPath = join(scratch, "show.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      }),
      "utf8",
    );
    const trace = writeScratch("show-custom.jsonl", '{"note":"one"}\n');
    const outcome = runShow([trace, "--schema", schemaPath, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect((JSON.parse(outcome.stdout) as { schema: string }).schema).toBe(schemaPath);
  });

  it("exits 64 when the command line is not understood", () => {
    expect(runShow([]).exitCode).toBe(EXIT_USAGE);
    expect(runShow([example("success.jsonl"), "--nope"]).exitCode).toBe(EXIT_USAGE);
    expect(runShow([example("success.jsonl"), "--event"]).exitCode).toBe(EXIT_USAGE);
    expect(runShow([example("success.jsonl"), example("failed.jsonl")]).exitCode).toBe(EXIT_USAGE);
    expect(runShow(["--help"]).exitCode).toBe(EXIT_OK);
  });

  it("keeps --event an unknown option for the other commands", () => {
    expect(runSummary([example("success.jsonl"), "--event", "evt_000001"]).exitCode).toBe(EXIT_USAGE);
    expect(runValidate([example("success.jsonl"), "--event", "evt_000001"]).exitCode).toBe(EXIT_USAGE);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["show", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: tools", () => {
  it("exits 0 and prints the per-tool aggregate of the real spike trace", () => {
    const outcome = runTools([example("spike-run.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("tool calls  4");
    expect(outcome.stdout).toContain("read_file");
    expect(outcome.stdout).toContain("fetch_url");
  });

  it("prints a report with stable top-level keys in --json mode", () => {
    const outcome = runTools([example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(Object.keys(JSON.parse(outcome.stdout))).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "events",
      "tool_calls",
      "tools",
      "declared",
      "undeclared",
      "unused",
    ]);
  });

  it("produces the same bytes twice in both output modes", () => {
    for (const extra of [[], ["--json"]]) {
      const first = runTools([example("spike-run.jsonl"), ...extra]);
      const second = runTools([example("spike-run.jsonl"), ...extra]);
      expect(first.stdout).toBe(second.stdout);
      expect(first.exitCode).toBe(EXIT_OK);
    }
  });

  it("exits 1 and reports validation errors instead of aggregating an invalid trace", () => {
    const outcome = runTools([writeScratch("tools-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).command).toBe("tools");
  });

  it("exits 2 for a file that cannot be read", () => {
    expect(runTools([join(scratch, "tools-missing.jsonl")]).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 2 when the schema file cannot be read", () => {
    expect(runTools([example("success.jsonl"), "--schema", join(scratch, "tools-missing.schema.json")]).exitCode).toBe(
      EXIT_UNREADABLE,
    );
  });

  it("honours --schema like validate does", () => {
    const schemaPath = join(scratch, "tools.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      }),
      "utf8",
    );
    const trace = writeScratch("tools-custom.jsonl", '{"note":"one"}\n');
    const outcome = runTools([trace, "--schema", schemaPath, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect((JSON.parse(outcome.stdout) as { schema: string }).schema).toBe(schemaPath);
  });

  it("exits 64 when the command line is not understood", () => {
    expect(runTools([]).exitCode).toBe(EXIT_USAGE);
    expect(runTools([example("success.jsonl"), "--nope"]).exitCode).toBe(EXIT_USAGE);
    expect(runTools([example("success.jsonl"), example("failed.jsonl")]).exitCode).toBe(EXIT_USAGE);
    expect(runTools(["--help"]).exitCode).toBe(EXIT_OK);
  });

  it("keeps --event an unknown option for the other commands", () => {
    expect(runTools([example("success.jsonl"), "--event", "evt_000001"]).exitCode).toBe(EXIT_USAGE);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["tools", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: errors", () => {
  it("exits 0 and prints the failure aggregate of the real trace", () => {
    const outcome = runErrors([example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("failures  7");
    expect(outcome.stdout).toContain("errors    6");
    expect(outcome.stdout).toContain("refusals  1");
    expect(outcome.stdout).toContain("tool_error");
    expect(outcome.stdout).toContain("evt_000026");
  });

  it("exits 0 for a trace with no failures, because a readable trace is a success", () => {
    for (const name of ["success.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const outcome = runErrors([example(name)]);
      expect(outcome.exitCode).toBe(EXIT_OK);
      expect(outcome.stderr).toBe("");
      expect(outcome.stdout).toContain("(no errors)");
    }
  });

  it("prints a report with stable top-level keys in --json mode", () => {
    const outcome = runErrors([example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(Object.keys(JSON.parse(outcome.stdout))).toEqual([
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

  it("produces the same bytes twice in both output modes", () => {
    for (const extra of [[], ["--json"]]) {
      const first = runErrors([example("failed.jsonl"), ...extra]);
      const second = runErrors([example("failed.jsonl"), ...extra]);
      expect(first.stdout).toBe(second.stdout);
      expect(first.exitCode).toBe(EXIT_OK);
    }
  });

  it("exits 1 and reports validation errors instead of aggregating an invalid trace", () => {
    const outcome = runErrors([writeScratch("errors-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).command).toBe("errors");
  });

  it("exits 2 for a file that cannot be read", () => {
    expect(runErrors([join(scratch, "errors-missing.jsonl")]).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 2 when the schema file cannot be read", () => {
    expect(
      runErrors([example("success.jsonl"), "--schema", join(scratch, "errors-missing.schema.json")]).exitCode,
    ).toBe(EXIT_UNREADABLE);
  });

  it("honours --schema like validate does", () => {
    const schemaPath = join(scratch, "errors.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      }),
      "utf8",
    );
    const trace = writeScratch("errors-custom.jsonl", '{"note":"one"}\n');
    const outcome = runErrors([trace, "--schema", schemaPath, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect((JSON.parse(outcome.stdout) as { schema: string }).schema).toBe(schemaPath);
  });

  it("exits 64 when the command line is not understood", () => {
    expect(runErrors([]).exitCode).toBe(EXIT_USAGE);
    expect(runErrors([example("success.jsonl"), "--nope"]).exitCode).toBe(EXIT_USAGE);
    expect(runErrors([example("success.jsonl"), example("failed.jsonl")]).exitCode).toBe(EXIT_USAGE);
    expect(runErrors(["--help"]).exitCode).toBe(EXIT_OK);
  });

  it("keeps --event an unknown option for the other commands", () => {
    expect(runErrors([example("success.jsonl"), "--event", "evt_000001"]).exitCode).toBe(EXIT_USAGE);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["errors", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: eval-gen", () => {
  it("exits 0 and prints one case per error class of the real trace", async () => {
    const outcome = await runEvalGen([example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("cases     5");
    expect(outcome.stdout).toContain("case_001  tool_error");
    expect(outcome.stdout).toContain("16:evt_000016, 23:evt_000023");
    expect(outcome.stdout).toContain("skipped refusals  guardrail_refusal");
    // No model was asked for, and the report says so rather than leaving a reader to
    // assume one answered.
    expect(outcome.stdout).toContain(EVAL_GEN_NO_MODEL_NOTE);
    expect(outcome.stdout).toContain("findings\n  none");
    expect(outcome.stdout).toContain("model\n  disabled");
  });

  it("exits 0 for a trace with no failures, because a readable trace is a success", async () => {
    for (const name of ["success.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const outcome = await runEvalGen([example(name)]);
      expect(outcome.exitCode).toBe(EXIT_OK);
      expect(outcome.stderr).toBe("");
      expect(outcome.stdout).toContain("(no cases)");
    }
  });

  it("prints a report with stable top-level keys in --json mode", async () => {
    const outcome = await runEvalGen([example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(Object.keys(JSON.parse(outcome.stdout))).toEqual([
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

  it("produces the same bytes twice in both output modes", async () => {
    for (const extra of [[], ["--json"]]) {
      const first = await runEvalGen([example("failed.jsonl"), ...extra]);
      const second = await runEvalGen([example("failed.jsonl"), ...extra]);
      expect(first.stdout).toBe(second.stdout);
      expect(first.exitCode).toBe(EXIT_OK);
    }
  });

  it("exits 1 and reports validation errors instead of generating cases from an invalid trace", async () => {
    const outcome = await runEvalGen([writeScratch("eval-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).command).toBe("eval-gen");
  });

  it("exits 2 for a file that cannot be read", async () => {
    expect((await runEvalGen([join(scratch, "eval-missing.jsonl")])).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 2 when the schema file cannot be read", async () => {
    expect(
      (await runEvalGen([example("success.jsonl"), "--schema", join(scratch, "eval-missing.schema.json")]))
        .exitCode,
    ).toBe(EXIT_UNREADABLE);
  });

  it("writes nothing when --out is not given", async () => {
    const outcome = await runEvalGen([example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).not.toContain("written");
  });

  it("writes the deterministic bytes, not the ones --json prints beside them", async () => {
    const directory = join(scratch, "eval-out");
    const json = await runEvalGen([example("failed.jsonl"), "--json"]);
    const outcome = await runEvalGen([example("failed.jsonl"), "--out", directory, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    // The stdout report carries the model half, which the file must not: a case file is
    // the record of a run that already happened, and has to be the same bytes for the
    // same trace no matter which model answered.
    const written = readFileSync(join(directory, "run_02.json"), "utf8");
    expect(written).toBe(renderEvalGenJson(reportOf("failed.jsonl")));
    expect(written).not.toBe(outcome.stdout);
    expect(Object.keys(JSON.parse(written))).not.toContain("findings");
    expect(Object.keys(JSON.parse(outcome.stdout))).toContain("findings");
  });

  it("names the file it wrote under the terminal report", async () => {
    const directory = join(scratch, "eval-out-text");
    const outcome = await runEvalGen([example("failed.jsonl"), "--out", directory]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain(`written  ${join(directory, "run_02.json")}  (5 cases, `);
    expect(outcome.stdout.endsWith("bytes)\n")).toBe(true);
  });

  it("exits 3 and refuses to replace an existing case file without --force", async () => {
    const directory = join(scratch, "eval-out-twice");
    expect((await runEvalGen([example("failed.jsonl"), "--out", directory])).exitCode).toBe(EXIT_OK);
    const outcome = await runEvalGen([example("failed.jsonl"), "--out", directory]);
    expect(outcome.exitCode).toBe(EXIT_REPORT_FAILED);
    expect(outcome.stdout).toContain("already exists; pass --force to replace it");
    // The wording has to say the write failed, not that the input could not be read:
    // the trace is the one file in this exchange that is fine.
    expect(outcome.stdout).toContain("nothing was written");
    expect(outcome.stdout).not.toContain("input could not be read");
  });

  it("replaces the case file when --force is given", async () => {
    const directory = join(scratch, "eval-out-forced");
    await runEvalGen([example("failed.jsonl"), "--out", directory]);
    const outcome = await runEvalGen([example("failed.jsonl"), "--out", directory, "--force"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("written  ");
  });

  it("exits 3 and reports a directory it cannot write into", async () => {
    const blocker = join(scratch, "eval-blocker");
    writeFileSync(blocker, "not a directory\n", "utf8");
    const outcome = await runEvalGen([example("failed.jsonl"), "--out", join(blocker, "evals")]);
    expect(outcome.exitCode).toBe(EXIT_REPORT_FAILED);
    expect(outcome.stdout).toContain("cannot write");
  });

  it("exits 64 when the command line is not understood", async () => {
    expect((await runEvalGen([])).exitCode).toBe(EXIT_USAGE);
    expect((await runEvalGen([example("success.jsonl"), "--nope"])).exitCode).toBe(EXIT_USAGE);
    expect((await runEvalGen([example("success.jsonl"), example("failed.jsonl")])).exitCode).toBe(EXIT_USAGE);
    expect((await runEvalGen([example("success.jsonl"), "--out"])).exitCode).toBe(EXIT_USAGE);
    expect((await runEvalGen(["--help"])).exitCode).toBe(EXIT_OK);
  });

  it("keeps --event unknown for this command", async () => {
    expect((await runEvalGen([example("success.jsonl"), "--event", "evt_000001"])).exitCode).toBe(EXIT_USAGE);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["eval-gen", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: eval-gen --model", () => {
  let server: Server;
  let port: number;
  let requestBodies: string[] = [];
  let answer: unknown = {
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({
            findings: [
              {
                severity: "warning",
                evidence: ["evt_000016"],
                claim: "the two tool_error occurrences carry different messages, so one case asserts two failures",
                confidence: "medium",
                suggestion: "split the class or narrow the assertion to the shared failure",
              },
            ],
            unverified: ["the quoted events do not say whether the two reads were the same mistake"],
          }),
        },
      },
    ],
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestBodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requestBodies = [];
  });

  function modelArgs(extra: string[] = []): string[] {
    return [example("failed.jsonl"), "--model", "--model-name", "stub-model", ...extra];
  }

  function stubEnv(): void {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
  }

  it("sends the cases and the events they cite, and adds the findings", async () => {
    stubEnv();
    const outcome = await runEvalGen(modelArgs());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("find_1  warning  confidence medium  evidence evt_000016");
    expect(outcome.stdout).toContain("the two tool_error occurrences carry different messages");
    expect(outcome.stdout).toContain("provider         openai-compatible");
    expect(outcome.stdout).toContain("model            stub-model");
    expect(outcome.stdout).toContain("requests         1");
    expect(outcome.stdout).toContain("events sent      6");
    expect(outcome.stdout).toContain("error            none");
    expect(outcome.stdout).toContain("- the quoted events do not say whether the two reads were the same mistake");
    // The deterministic cases come first and are unchanged by what the model said.
    expect(outcome.stdout).toContain("case_001  tool_error");
    expect(outcome.stdout).toContain("cases     5");
  });

  it("sends one observation per case and quotes only the events the cases cite", async () => {
    stubEnv();
    await runEvalGen(modelArgs());
    vi.unstubAllEnvs();
    expect(requestBodies).toHaveLength(1);
    const sent = JSON.parse(requestBodies[0] ?? "{}") as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(sent.model).toBe("stub-model");
    const payload = JSON.parse(sent.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["task", "output_contract", "observations", "events"]);
    const observations = payload.observations as { id: string; kind: string; event_id: string }[];
    expect(observations.map((observation) => observation.id)).toEqual(["obs_001", "obs_002", "obs_003", "obs_004", "obs_005"]);
    expect(observations.every((observation) => observation.kind === "eval_case")).toBe(true);
    // Every observation is anchored to a real event of the case it restates.
    expect(observations[0]?.event_id).toBe("evt_000016");
    // Only the seven events the five cases cite, and nothing else: not the events the
    // occurrences relate to, and not the events that did not fail.
    const events = payload.events as { event_id: string }[];
    expect(events.map((event) => event.event_id)).toEqual([
      "evt_000015",
      "evt_000016",
      "evt_000018",
      "evt_000022",
      "evt_000023",
      "evt_000026",
    ]);
  });

  it("keeps the file path out of the request unless --send-paths is given", async () => {
    stubEnv();
    await runEvalGen(modelArgs(["--send-paths"]));
    vi.unstubAllEnvs();
    const sent = JSON.parse(requestBodies[0] ?? "{}") as { messages: { role: string; content: string }[] };
    const payload = JSON.parse(sent.messages[1]?.content ?? "{}") as Record<string, unknown>;
    expect(payload.file).toBe(example("failed.jsonl"));
    requestBodies = [];
    stubEnv();
    await runEvalGen(modelArgs());
    vi.unstubAllEnvs();
    const without = JSON.parse(requestBodies[0] ?? "{}") as { messages: { role: string; content: string }[] };
    expect(JSON.parse(without.messages[1]?.content ?? "{}").file).toBeUndefined();
  });

  it("writes the deterministic file and never the model's words", async () => {
    stubEnv();
    const directory = join(scratch, "eval-out-model");
    const outcome = await runEvalGen(modelArgs(["--out", directory]));
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_OK);
    const written = readFileSync(join(directory, "run_02.json"), "utf8");
    expect(written).toBe(renderEvalGenJson(reportOf("failed.jsonl")));
    expect(written).not.toContain("findings");
    expect(written).not.toContain("the two tool_error occurrences carry different messages");
  });

  it("exits 65 and keeps the cases when the answer cannot be used", async () => {
    answer = { choices: [{ message: { role: "assistant", content: "I am not sure, sorry." } }] };
    stubEnv();
    const outcome = await runEvalGen(modelArgs());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    expect(outcome.stdout).toContain("case_001  tool_error");
    expect(outcome.stdout).toContain("findings\n  none");
    expect(outcome.stdout).toContain("error            bad_shape");
    answer = {
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              findings: [
                {
                  severity: "warning",
                  evidence: ["evt_999999"],
                  claim: "this event does not exist",
                  confidence: "low",
                  suggestion: "fabricated",
                },
              ],
            }),
          },
        },
      ],
    };
    stubEnv();
    const fabricated = await runEvalGen(modelArgs());
    vi.unstubAllEnvs();
    expect(fabricated.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    expect(fabricated.stdout).toContain("unknown_evidence");
    expect(fabricated.stdout).toContain("cases     5");
  });

  it("exits 69 when no key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runEvalGen(modelArgs());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNAVAILABLE);
    expect(outcome.stdout).toContain("no API key is configured");
    expect(outcome.stdout).toContain("cases     5");
    expect(requestBodies).toEqual([]);
  });

  it("exits 64 when --model is given without a model name", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runEvalGen([example("failed.jsonl"), "--model"]);
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("--model needs a model name");
    expect(requestBodies).toEqual([]);
  });

  it("makes no request for a trace with no case to review", async () => {
    stubEnv();
    const outcome = await runEvalGen([example("success.jsonl"), "--model", "--model-name", "stub-model"]);
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("(no cases)");
    expect(outcome.stdout).toContain("requests         0");
    expect(outcome.stdout).toContain("the trace records no failure, so there is no case for a model to review");
    expect(requestBodies).toEqual([]);
  });

  it("names the events past --max-excerpt instead of quoting them", async () => {
    stubEnv();
    const outcome = await runEvalGen(modelArgs(["--max-excerpt", "3", "--json"]));
    vi.unstubAllEnvs();
    const report = JSON.parse(outcome.stdout) as { unverified: string[]; model: { sent_events: number } };
    expect(report.model.sent_events).toBe(3);
    expect(report.unverified).toContain(
      "only the first 3 cited events were quoted; evt_000022, evt_000023, evt_000026 are named but not quoted",
    );
  });
});

describe("cli: diff", () => {
  it("exits 0 and prints one ok line when the two traces are identical", () => {
    const outcome = runDiff([example("success.jsonl"), example("success.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toBe(
      `ok: ${example("success.jsonl")} and ${example("success.jsonl")} are identical\n`,
    );
  });

  it("exits 1 and lists every change when the two traces differ", () => {
    const outcome = runDiff([example("success.jsonl"), example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("run_id");
    expect(outcome.stdout).toContain("run_01 -> run_02");
    expect(outcome.stdout).toContain("~ evt_000003  model.response.completed  line 3 / line 3");
    expect(outcome.stdout).toContain("/payload/duration_ms: 920 -> 960");
    expect(outcome.stdout).toContain("+ evt_000026  run.failed");
    expect(outcome.stdout).toContain("diff: 37 changes\n");
    expect(outcome.stdout).not.toContain(String.fromCharCode(27));
  });

  it("prints a report with stable top-level keys in --json mode", () => {
    const outcome = runDiff([example("success.jsonl"), example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    const report = JSON.parse(outcome.stdout) as {
      command: string;
      identical: boolean;
      changes: { kind: string; fields: Record<string, unknown>[] }[];
    };
    expect(Object.keys(report)).toEqual(["command", "schema", "files", "events", "identical", "changes"]);
    expect(report.command).toBe("diff");
    expect(report.identical).toBe(false);
    expect(Object.keys(report.changes[0] ?? {})).toEqual([
      "kind",
      "field",
      "event_id",
      "type",
      "line_a",
      "line_b",
      "a",
      "b",
      "fields",
    ]);
    const changed = report.changes.find((entry) => entry.kind === "event_changed");
    expect(Object.keys(changed?.fields[0] ?? {})).toEqual(["path", "a", "b"]);
  });

  it("exits 1 with the validation report when the first file is invalid", () => {
    const bad = writeScratch("diff-invalid-a.jsonl", INVALID_TRACE);
    const outcome = runDiff([bad, example("success.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    const report = parseReport(outcome.stdout);
    expect(report.command).toBe("diff");
    expect(report.valid).toBe(false);
    expect(report.file).toBe(bad);
  });

  it("exits 1 with the validation report when the second file is invalid", () => {
    const bad = writeScratch("diff-invalid-b.jsonl", INVALID_TRACE);
    const outcome = runDiff([example("success.jsonl"), bad, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).file).toBe(bad);
  });

  it("exits 2 when either trace file cannot be read", () => {
    const missing = join(scratch, "diff-missing.jsonl");
    expect(runDiff([missing, example("success.jsonl")]).exitCode).toBe(EXIT_UNREADABLE);
    expect(runDiff([example("success.jsonl"), missing]).exitCode).toBe(EXIT_UNREADABLE);
    const badJson = writeScratch("diff-bad-json.jsonl", "{ not json\n");
    expect(runDiff([example("success.jsonl"), badJson]).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 2 for an unreadable schema, before the trace files are read", () => {
    const missing = join(scratch, "diff-missing.jsonl");
    const outcome = runDiff([missing, missing, "--schema", join(scratch, "diff-missing-schema.json")]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
    expect(outcome.stdout).toContain("cannot read schema");
  });

  it("exits 64 when the command line is not understood", () => {
    const good = example("success.jsonl");
    expect(runDiff([]).exitCode).toBe(EXIT_USAGE);
    expect(runDiff([good]).exitCode).toBe(EXIT_USAGE);
    expect(runDiff([good, good, good]).exitCode).toBe(EXIT_USAGE);
    expect(runDiff([good, good, "--colour"]).exitCode).toBe(EXIT_USAGE);
    expect(runDiff([good, good, "--schema"]).exitCode).toBe(EXIT_USAGE);
    expect(runDiff(["--help"]).exitCode).toBe(EXIT_OK);
  });

  it("produces byte-identical output for identical input", () => {
    const first = runDiff([example("success.jsonl"), example("failed.jsonl")]);
    const second = runDiff([example("success.jsonl"), example("failed.jsonl")]);
    expect(first.stdout).toBe(second.stdout);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["diff", example("success.jsonl"), example("failed.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: compare", () => {
  it("exits 0 and prints one ok line when the failure profiles match", async () => {
    const outcome = await runCompare([example("failed.jsonl"), example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout.startsWith(`compare  ${example("failed.jsonl")} vs ${example("failed.jsonl")}\nschema   bundled\n\n`)).toBe(true);
    expect(outcome.stdout).toContain("status    failed  failed   same\n");
    expect(outcome.stdout).toContain("failures  7       7           0\n");
    expect(outcome.stdout.endsWith("ok: identical failure profiles\n")).toBe(true);
    expect(outcome.stdout).not.toContain("new");
    expect(outcome.stdout).not.toContain(String.fromCharCode(27));
  });

  it("exits 1 and reports every movement when the failure profiles differ", async () => {
    const outcome = await runCompare([example("success.jsonl"), example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("compare: 9 differences in the failure profile");
    expect(outcome.stdout).toContain("tool_error         -  2     +2  new");
    expect(outcome.stdout).toContain("read_file          2        5         0         2           0           1     +2  increased");
    expect(outcome.stdout).not.toContain(String.fromCharCode(27));
  });

  it("prints a report with stable top-level keys in --json mode", async () => {
    const outcome = await runCompare([example("success.jsonl"), example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    const report = JSON.parse(outcome.stdout) as {
      command: string;
      identical: boolean;
      differences: number;
      status_changed: boolean;
      classes: { verdict: string }[];
      model: Record<string, unknown>;
    };
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
    expect(report.command).toBe("compare");
    expect(report.status_changed).toBe(true);
    expect(report.identical).toBe(false);
    expect(report.differences).toBe(9);
    expect(report.classes.every((row) => row.verdict === "new")).toBe(true);
    // Without --model the model half is present and switched off, not absent.
    expect(report.model.enabled).toBe(false);
  });

  it("exits 1 with the validation report when the first file is invalid", async () => {
    const bad = writeScratch("compare-invalid-a.jsonl", INVALID_TRACE);
    const outcome = await runCompare([bad, example("success.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    const report = parseReport(outcome.stdout);
    expect(report.command).toBe("compare");
    expect(report.valid).toBe(false);
    expect(report.file).toBe(bad);
  });

  it("exits 1 with the validation report when the second file is invalid", async () => {
    const bad = writeScratch("compare-invalid-b.jsonl", INVALID_TRACE);
    const outcome = await runCompare([example("success.jsonl"), bad, "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(parseReport(outcome.stdout).file).toBe(bad);
  });

  it("exits 2 when either trace file cannot be read", async () => {
    const missing = join(scratch, "compare-missing.jsonl");
    expect((await runCompare([missing, example("success.jsonl")])).exitCode).toBe(EXIT_UNREADABLE);
    expect((await runCompare([example("success.jsonl"), missing])).exitCode).toBe(EXIT_UNREADABLE);
    const badJson = writeScratch("compare-bad-json.jsonl", "{ not json\n");
    expect((await runCompare([example("success.jsonl"), badJson])).exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 2 for an unreadable schema, before the trace files are read", async () => {
    const missing = join(scratch, "compare-missing.jsonl");
    const outcome = await runCompare([missing, missing, "--schema", join(scratch, "compare-missing-schema.json")]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
    expect(outcome.stdout).toContain("cannot read schema");
  });

  it("exits 64 when the command line is not understood", async () => {
    const good = example("success.jsonl");
    expect((await runCompare([])).exitCode).toBe(EXIT_USAGE);
    expect((await runCompare([good])).exitCode).toBe(EXIT_USAGE);
    expect((await runCompare([good, good, good])).exitCode).toBe(EXIT_USAGE);
    expect((await runCompare([good, good, "--colour"])).exitCode).toBe(EXIT_USAGE);
    expect((await runCompare([good, good, "--schema"])).exitCode).toBe(EXIT_USAGE);
    expect((await runCompare([good, good, "--event", "evt_000001"])).exitCode).toBe(EXIT_USAGE);
    expect((await runCompare(["--help"])).exitCode).toBe(EXIT_OK);
  });

  it("prints the compare usage and exits 0 for compare --help", async () => {
    const outcome = await runCompare(["--help"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("usage: trace compare FILE FILE");
  });

  it("produces byte-identical output for identical input", async () => {
    const first = await runCompare([example("success.jsonl"), example("failed.jsonl")]);
    const second = await runCompare([example("success.jsonl"), example("failed.jsonl")]);
    expect(first.stdout).toBe(second.stdout);
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["compare", example("success.jsonl"), example("failed.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: explain", () => {
  it("exits 0 and prints the deterministic report with no model involved", async () => {
    const outcome = await runExplain([example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("run_id  run_02");
    expect(outcome.stdout).toContain("status  failed");
    expect(outcome.stdout).toContain("observations");
    expect(outcome.stdout).toContain("obs_1  evt_000026  line 26");
    expect(outcome.stdout).toContain("model\n  disabled");
  });

  it("is byte-stable for the same input", async () => {
    const first = await runExplain([example("failed.jsonl")]);
    const second = await runExplain([example("failed.jsonl")]);
    expect(first.stdout).toBe(second.stdout);
  });

  it("prints stable JSON keys in a fixed order", async () => {
    const outcome = await runExplain([example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    const report = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "status",
      "events",
      "observations",
      "findings",
      "unverified",
      "model",
    ]);
    expect(Object.keys(report.model as Record<string, unknown>)).toEqual([
      "enabled",
      "ok",
      "provider",
      "model",
      "requests",
      "sent_events",
      "request_bytes",
      "redacted_fields",
      "unverified",
      "error",
    ]);
    expect(Object.keys((report.observations as Record<string, unknown>[])[0] ?? {})).toEqual([
      "id",
      "kind",
      "event_id",
      "line",
      "statement",
    ]);
  });

  it("says nothing here is an interpretation when no model was asked", async () => {
    const outcome = await runExplain([example("failed.jsonl"), "--json"]);
    const report = JSON.parse(outcome.stdout) as { unverified: string[]; findings: unknown[] };
    expect(report.findings).toEqual([]);
    expect(report.unverified).toEqual(["no model was called, so this report only restates what the trace records"]);
  });

  it("validates the file first and reports the same errors validate would", async () => {
    const path = writeScratch("explain-invalid.jsonl", INVALID_TRACE);
    const outcome = await runExplain([path]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(outcome.stdout).toContain("invalid:");
  });

  it("exits 2 for a file it cannot read", async () => {
    const outcome = await runExplain([join(scratch, "does-not-exist.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_UNREADABLE);
  });

  it("exits 64 with no file, with an unknown option and with an extra argument", async () => {
    expect((await runExplain([])).exitCode).toBe(EXIT_USAGE);
    expect((await runExplain([example("success.jsonl"), "--nope"])).exitCode).toBe(EXIT_USAGE);
    expect((await runExplain([example("success.jsonl"), example("failed.jsonl")])).exitCode).toBe(EXIT_USAGE);
  });

  it("rejects model options on the other commands rather than ignoring them", async () => {
    const outcome = await runMain(["summary", example("success.jsonl"), "--model"]);
    expect(outcome.code).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("unknown option --model");
  });

  it("prints usage for --help and lists the model options", async () => {
    const outcome = await runExplain(["--help"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("usage: trace explain FILE");
    expect(outcome.stdout).toContain("--model-name NAME");
    expect(outcome.stdout).toContain("69  no usable answer was obtained from the model");
  });

  it("exits 64 when --model is given without any way to name a model", async () => {
    const outcome = await runExplain([example("failed.jsonl"), "--model"]);
    expect(outcome.exitCode).toBe(EXIT_USAGE);
    expect(outcome.stderr).toContain("--model needs a model name");
  });

  it("exits 64 for a non-numeric --timeout and a non-positive --max-excerpt", async () => {
    expect((await runExplain([example("failed.jsonl"), "--model", "--model-name", "m", "--timeout", "abc"])).exitCode).toBe(
      EXIT_USAGE,
    );
    expect((await runExplain([example("failed.jsonl"), "--model", "--model-name", "m", "--max-excerpt", "0"])).exitCode).toBe(
      EXIT_USAGE,
    );
    expect(
      (await runExplain([example("failed.jsonl"), "--model", "--model-name", "m", "--timeout"])).exitCode,
    ).toBe(EXIT_USAGE);
  });

  it("exits 69 when --model is on but no key is configured, and says which variable to set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    const outcome = await runExplain([example("failed.jsonl"), "--model", "--model-name", "stub-model"]);
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNAVAILABLE);
    expect(outcome.stdout).toContain("no API key is configured");
    expect(outcome.stdout).toContain("OPENAI_API_KEY");
    expect(outcome.stdout).toContain("obs_1");
    vi.unstubAllEnvs();
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["explain", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});

describe("cli: explain --model", () => {
  let server: Server;
  let port = 0;
  let requestBodies: string[] = [];
  let answer: unknown = {
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({
            findings: [
              {
                severity: "warning",
                evidence: ["evt_000013"],
                claim: "the first read was blocked by the loop guard",
                confidence: "medium",
                suggestion: "stop re-reading the same file",
              },
            ],
            unverified: ["the quoted events do not say why the loop started"],
          }),
        },
      },
    ],
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestBodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function modelArgs(extra: string[] = []): string[] {
    return [
      example("failed.jsonl"),
      "--model",
      "--model-name",
      "stub-model",
      ...extra,
    ];
  }

  it("sends the request, returns the findings and exits 0", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runExplain(modelArgs());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("findings");
    expect(outcome.stdout).toContain("find_1  warning  confidence medium  evidence evt_000013");
    expect(outcome.stdout).toContain("the first read was blocked by the loop guard");
    expect(outcome.stdout).toContain("model");
    expect(outcome.stdout).toContain("provider         openai-compatible");
    expect(outcome.stdout).toContain("model            stub-model");
    expect(outcome.stdout).toContain("requests         1");
    expect(outcome.stdout).toContain("error            none");
    expect(outcome.stdout).toContain("- the quoted events do not say why the loop started");
  });

  it("reports the transport facts and keeps the model's own gaps apart", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runExplain([...modelArgs(), "--json"]);
    vi.unstubAllEnvs();
    const report = JSON.parse(outcome.stdout) as {
      findings: { id: string; evidence: string[] }[];
      unverified: string[];
      model: { ok: boolean; provider: string; model: string; requests: number; sent_events: number; request_bytes: number; unverified: string[]; error: unknown };
    };
    expect(report.findings.map((finding) => finding.id)).toEqual(["find_1"]);
    expect(report.findings[0]?.evidence).toEqual(["evt_000013"]);
    expect(report.unverified).toEqual([]);
    expect(report.model.ok).toBe(true);
    expect(report.model.provider).toBe("openai-compatible");
    expect(report.model.model).toBe("stub-model");
    expect(report.model.requests).toBe(1);
    expect(report.model.sent_events).toBe(8);
    expect(report.model.request_bytes).toBeGreaterThan(0);
    expect(report.model.unverified).toEqual(["the quoted events do not say why the loop started"]);
    expect(report.model.error).toBeNull();
  });

  it("exits 65 when the model answers something that cannot be used", async () => {
    answer = { choices: [{ message: { role: "assistant", content: "I am not sure, sorry." } }] };
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runExplain([...modelArgs(), "--json"]);
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    const report = JSON.parse(outcome.stdout) as { findings: unknown[]; model: { ok: boolean; error: { kind: string } | null } };
    expect(report.findings).toEqual([]);
    expect(report.model.ok).toBe(false);
    expect(report.model.error?.kind).toBe("bad_shape");
  });

  it("exits 65 when the model cites an event that is not in the trace", async () => {
    answer = {
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              findings: [
                { severity: "error", evidence: ["evt_999999"], claim: "x", confidence: "high", suggestion: "y" },
              ],
            }),
          },
        },
      ],
    };
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runExplain([...modelArgs(), "--json"]);
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    const report = JSON.parse(outcome.stdout) as { model: { error: { kind: string; message: string } | null } };
    expect(report.model.error?.kind).toBe("unknown_evidence");
    expect(report.model.error?.message).toContain("evt_999999");
  });

  it("does not send the file path unless --send-paths is given", async () => {
    answer = { choices: [{ message: { role: "assistant", content: JSON.stringify({ findings: [] }) } }] };
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    requestBodies = [];
    const without = await runExplain(modelArgs());
    const withPaths = await runExplain(modelArgs(["--send-paths"]));
    vi.unstubAllEnvs();
    expect(without.exitCode).toBe(EXIT_OK);
    expect(withPaths.exitCode).toBe(EXIT_OK);

    const payloadOf = (body: string): Record<string, unknown> => {
      const sent = JSON.parse(body) as { messages: { role: string; content: string }[] };
      return JSON.parse(sent.messages[1]?.content ?? "{}") as Record<string, unknown>;
    };
    expect(requestBodies).toHaveLength(2);
    expect(payloadOf(requestBodies[0] ?? "{}").file).toBeUndefined();
    expect(payloadOf(requestBodies[1] ?? "{}").file).toBe(example("failed.jsonl"));
  });

  it("honours --max-excerpt by quoting fewer events", async () => {
    answer = { choices: [{ message: { role: "assistant", content: JSON.stringify({ findings: [] }) } }] };
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
    const outcome = await runExplain([...modelArgs(["--max-excerpt", "2"]), "--json"]);
    vi.unstubAllEnvs();
    const report = JSON.parse(outcome.stdout) as { model: { sent_events: number }; unverified: string[] };
    expect(report.model.sent_events).toBe(2);
    expect(report.unverified.some((note) => note.startsWith("only the first 2 cited events were quoted"))).toBe(true);
  });
});

describe("cli: compare --model", () => {
  let server: Server;
  let port = 0;
  let requestBodies: string[] = [];
  let answer: unknown = {
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({
            findings: [
              {
                severity: "warning",
                evidence: ["b:evt_000013"],
                claim: "the loop guard blocked the repeated read in the second trace only",
                confidence: "medium",
                suggestion: "check why the file is read twice",
              },
            ],
            unverified: ["the quoted events do not say why the read repeated"],
          }),
        },
      },
    ],
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestBodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function pair(extra: string[] = []): string[] {
    return [example("success.jsonl"), example("failed.jsonl"), "--model", "--model-name", "stub-model", ...extra];
  }

  function stubEnv(): void {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
  }

  function payloadOf(body: string): Record<string, unknown> {
    const sent = JSON.parse(body) as { messages: { role: string; content: string }[] };
    return JSON.parse(sent.messages[1]?.content ?? "{}") as Record<string, unknown>;
  }

  it("sends the two profiles and returns findings bound to side-qualified event ids", async () => {
    stubEnv();
    const outcome = await runCompare(pair());
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(outcome.stdout).toContain("find_1  warning  confidence medium  evidence b:evt_000013");
    expect(outcome.stdout).toContain("the loop guard blocked the repeated read in the second trace only");
    expect(outcome.stdout).toContain("requests         1");
    expect(outcome.stdout).toContain("events sent      10");
    expect(outcome.stdout).toContain("- the quoted events do not say why the read repeated");
    expect(outcome.stdout.endsWith("compare: 9 differences in the failure profile\n")).toBe(true);
  });

  it("sends the compare task statement and system prompt, both files' events with their side, and nothing else", async () => {
    stubEnv();
    requestBodies = [];
    await runCompare(pair());
    vi.unstubAllEnvs();
    expect(requestBodies).toHaveLength(1);
    // Both instruction positions are compile-time constants, pinned here by byte
    // equality the way the injection suite pins the other three model halves: a
    // substring check would pass with payload text riding along inside the statement.
    const sent = JSON.parse(requestBodies[0] ?? "{}") as { messages: { role: string; content: string }[] };
    expect(sent.messages[0]?.content).toBe(COMPARE_SYSTEM_PROMPT);
    const payload = payloadOf(requestBodies[0] ?? "{}");
    expect(Object.keys(payload)).toEqual(["task", "output_contract", "observations", "events"]);
    expect(payload.task).toBe(COMPARE_TASK);
    const events = payload.events as { side: string }[];
    expect(events).toHaveLength(10);
    expect(events.filter((event) => event.side === "a").length).toBeGreaterThan(0);
    expect(events.filter((event) => event.side === "b").length).toBeGreaterThan(0);
  });

  it("leaves both file paths out unless --send-paths is given", async () => {
    stubEnv();
    requestBodies = [];
    await runCompare(pair());
    await runCompare(pair(["--send-paths"]));
    vi.unstubAllEnvs();
    expect(requestBodies).toHaveLength(2);
    expect(payloadOf(requestBodies[0] ?? "{}").file_a).toBeUndefined();
    expect(payloadOf(requestBodies[1] ?? "{}").file_a).toBe(example("success.jsonl"));
    expect(payloadOf(requestBodies[1] ?? "{}").file_b).toBe(example("failed.jsonl"));
  });

  it("makes no request at all when the two failure profiles are identical", async () => {
    stubEnv();
    requestBodies = [];
    const outcome = await runCompare([example("failed.jsonl"), example("failed.jsonl"), "--model", "--model-name", "stub-model"]);
    vi.unstubAllEnvs();
    // Nothing was attempted, so nothing failed: the deterministic verdict stands and the
    // model section says why no request left the machine.
    expect(requestBodies).toHaveLength(0);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stdout).toContain("requests         0");
    expect(outcome.stdout).toContain("no observation is anchored to an event");
  });

  it("exits 69 and reports no_api_key when --model is asked for without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    const outcome = await runCompare(pair(["--json"]));
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNAVAILABLE);
    const report = JSON.parse(outcome.stdout) as { findings: unknown[]; model: { ok: boolean; error: { kind: string } | null } };
    expect(report.findings).toEqual([]);
    expect(report.model.ok).toBe(false);
    expect(report.model.error?.kind).toBe("no_api_key");
    // The deterministic half is still there in full.
    expect(outcome.stdout).toContain('"differences": 9');
  });

  it("exits 65 when the model cites a bare event id instead of a side-qualified one", async () => {
    answer = {
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              findings: [{ severity: "error", evidence: ["evt_000013"], claim: "x", confidence: "high", suggestion: "y" }],
            }),
          },
        },
      ],
    };
    stubEnv();
    const outcome = await runCompare(pair(["--json"]));
    vi.unstubAllEnvs();
    expect(outcome.exitCode).toBe(EXIT_MODEL_UNUSABLE);
    const report = JSON.parse(outcome.stdout) as { model: { error: { kind: string; message: string } | null } };
    expect(report.model.error?.kind).toBe("unknown_evidence");
    expect(report.model.error?.message).toContain('expected "a:EVENT_ID" or "b:EVENT_ID"');
  });

  it("exits 64 when --model is used without a model name, and diff refuses --model outright", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_MODEL", "");
    expect((await runCompare([example("success.jsonl"), example("failed.jsonl"), "--model"])).exitCode).toBe(EXIT_USAGE);
    vi.unstubAllEnvs();
    // diff compares events, not failure profiles, and has no model half to offer.
    expect((await runDiff([example("success.jsonl"), example("failed.jsonl"), "--model"])).exitCode).toBe(EXIT_USAGE);
  });
});

describe("cli: fix-suggest", () => {
  it("exits 0 and names the directions the real failed trace points at", async () => {
    const outcome = await runFixSuggest([example("failed.jsonl")]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout).toContain("suggestions  4");
    expect(outcome.stdout).toContain("sug_001  repeated_error_class  tool_error x2");
    expect(outcome.stdout).toContain("sug_004  guardrail_refusals  the run x1");
    expect(outcome.stdout).toContain("16:evt_000016, 23:evt_000023");
    // No model was asked for, and the report says so rather than leaving a reader to
    // assume one answered.
    expect(outcome.stdout).toContain("no model was called");
  });

  it("exits 0 for a readable trace with nothing to suggest", async () => {
    for (const name of ["success.jsonl", "spike-run.jsonl"]) {
      const outcome = await runFixSuggest([example(name)]);
      expect(outcome.exitCode).toBe(EXIT_OK);
      expect(outcome.stderr).toBe("");
      expect(outcome.stdout).toContain("(no suggestions)");
    }
    // The cancelled example has a denied permission and no failure: still a readable
    // trace, still a successful report, still exit 0.
    expect((await runFixSuggest([example("cancelled.jsonl")])).exitCode).toBe(EXIT_OK);
  });

  it("prints a report with stable top-level keys in --json mode", async () => {
    const outcome = await runFixSuggest([example("failed.jsonl"), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(Object.keys(JSON.parse(outcome.stdout))).toEqual([
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
      "findings",
      "model",
    ]);
  });

  it("prints the report the builder produces, and the same bytes twice", async () => {
    const loaded = loadTraceFile(example("failed.jsonl"));
    if (!loaded.ok) {
      throw new Error(`fixture did not load: ${loaded.message}`);
    }
    const deterministic = buildFixSuggest(buildErrors(example("failed.jsonl"), "bundled", loaded.events), loaded.events);
    const built = renderFixSuggestModelJson(
      withoutFixSuggestModel(
        buildFixSuggestDraft(deterministic, loaded.events, {
          maxExcerptEvents: DEFAULT_MAX_EXCERPT_EVENTS,
          sendPaths: false,
        }),
      ),
    );
    const first = await runFixSuggest([example("failed.jsonl"), "--json"]);
    const second = await runFixSuggest([example("failed.jsonl"), "--json"]);
    expect(first.stdout).toBe(built);
    expect(second.stdout).toBe(first.stdout);
    expect(first.exitCode).toBe(EXIT_OK);
  });

  it("exits 1 and reports validation errors instead of suggesting from an invalid trace", async () => {
    const outcome = await runFixSuggest([writeScratch("fix-invalid.jsonl", INVALID_TRACE), "--json"]);
    expect(outcome.exitCode).toBe(EXIT_INVALID);
    expect(JSON.parse(outcome.stdout).command).toBe("fix-suggest");
  });

  it("exits 2 for a file that cannot be read, and for an unreadable schema", async () => {
    expect((await runFixSuggest([join(scratch, "fix-missing.jsonl")])).exitCode).toBe(EXIT_UNREADABLE);
    expect(
      (await runFixSuggest([example("success.jsonl"), "--schema", join(scratch, "fix-missing.schema.json")])).exitCode,
    ).toBe(EXIT_UNREADABLE);
  });

  it("exits 64 when the command line is not understood", async () => {
    expect((await runFixSuggest([])).exitCode).toBe(EXIT_USAGE);
    expect((await runFixSuggest([example("success.jsonl"), example("failed.jsonl")])).exitCode).toBe(EXIT_USAGE);
    expect((await runFixSuggest([example("success.jsonl"), "--nope"])).exitCode).toBe(EXIT_USAGE);
    expect((await runFixSuggest([example("success.jsonl"), "--schema"])).exitCode).toBe(EXIT_USAGE);
    expect((await runFixSuggest(["--help"])).exitCode).toBe(EXIT_OK);
  });

  it("keeps the flags of the commands it is not unknown options", async () => {
    // This command writes nothing and takes no --event, so neither is silently ignored:
    // both stay unknown options here, exactly as they are on diff.
    expect((await runFixSuggest([example("success.jsonl"), "--out", scratch])).exitCode).toBe(EXIT_USAGE);
    expect((await runFixSuggest([example("success.jsonl"), "--event", "evt_000001"])).exitCode).toBe(EXIT_USAGE);
  });

  it("exits 64 when --model is used without a model name", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-secret");
    vi.stubEnv("OPENAI_MODEL", "");
    expect((await runFixSuggest([example("failed.jsonl"), "--model"])).exitCode).toBe(EXIT_USAGE);
    vi.unstubAllEnvs();
  });

  it("exits 3 when the report cannot be written", async () => {
    const code = await main(["fix-suggest", example("success.jsonl")], {
      stdout: () => {
        throw new Error("EPIPE");
      },
      stderr: () => undefined,
    });
    expect(code).toBe(EXIT_REPORT_FAILED);
  });
});
