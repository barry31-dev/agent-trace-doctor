import { loadTraceFile } from "./loader.js";
import { BUNDLED_SCHEMA_LABEL, loadValidator } from "./schema.js";
import {
  renderDiffJson,
  renderDiffText,
  renderCompareJson,
  renderCompareText,
  renderExplainJson,
  renderExplainText,
  renderJson,
  renderShowJson,
  renderShowText,
  renderSummaryJson,
  renderSummaryText,
  renderText,
  renderTimelineJson,
  renderTimelineText,
  renderToolsJson,
  renderToolsText,
  renderErrorsJson,
  renderErrorsText,
  renderEvalGenJson,
  renderEvalGenText,
  renderEvalGenModelJson,
  renderEvalGenModelText,
  renderFixSuggestJson,
  renderFixSuggestText,
  renderFixSuggestModelJson,
  renderFixSuggestModelText,
} from "./report.js";
import { buildShow } from "./show.js";
import { buildTimeline, summarize } from "./analyze.js";
import { buildTools } from "./tools.js";
import { buildErrors } from "./errors.js";
import { buildEvalGen, readInputSummary } from "./evalGen.js";
import { buildFixSuggest } from "./fixSuggest.js";
import {
  buildFixSuggestDraft,
  FIX_SUGGEST_NO_MODEL_NOTE,
  withFixSuggestModelResult,
  withFixSuggestSkippedModel,
  withoutFixSuggestModel,
} from "./fixSuggestModel.js";
import type { FixSuggestWithModel } from "./fixSuggestModel.js";
import {
  buildEvalGenDraft,
  EVAL_GEN_NO_MODEL_NOTE,
  withEvalGenModelResult,
  withEvalGenSkippedModel,
  withoutEvalGenModel,
} from "./evalGenModel.js";
import type { EvalGenWithModel } from "./evalGenModel.js";
import { writeCaseFile } from "./caseWriter.js";
import { diffTraces } from "./diff.js";
import { buildCompare } from "./compare.js";
import { buildCompareDraft, withCompareModelResult, withSkippedModel, withoutModel } from "./compareModel.js";
import type { CompareWithModel } from "./compareModel.js";
import { reportForInputFailure, reportForWriteFailure, validateEvents } from "./validate.js";
import type { ValidationReport } from "./validate.js";
import { buildExplainDraft, NO_MODEL_NOTE, withModelResult } from "./explain.js";
import type { ExplainReport } from "./explain.js";
import { OpenAICompatibleClient } from "./model/openai.js";
import { DEFAULT_MAX_EXCERPT_EVENTS, ENV_API_KEY, resolveModelConfig } from "./model/config.js";
import { DEFAULT_PROVIDER } from "./model/config.js";
import type { ModelFlags } from "./model/config.js";
import type { ModelResult } from "./model/types.js";
import type { ModelFailureKind } from "./model/types.js";

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_UNREADABLE = 2;
export const EXIT_REPORT_FAILED = 3;
/** EX_USAGE from sysexits.h: the command line itself could not be understood. */
export const EXIT_USAGE = 64;
/** EX_DATAERR: the model answered, but the answer could not be used. */
export const EXIT_MODEL_UNUSABLE = 65;
/** EX_UNAVAILABLE: no usable answer was obtained from the model. */
export const EXIT_MODEL_UNAVAILABLE = 69;

const COMMANDS = `Commands:
  validate FILE [--schema FILE] [--json]
      Check one JSONL trace file against the bundled trace schema, or against the
      schema given with --schema, and report the file, line number, event id and
      reason for every problem found.
  summary FILE [--schema FILE] [--json]
      Aggregate one trace file: run status, duration, event counts, model call
      counts, tool call counts, permission decisions, recorded errors and tokens.
  timeline FILE [--schema FILE] [--json]
      List one line per event in file order, grouped into model-call steps, each
      with its line number, event id, offset from the first event and a one-line
      description.
  show FILE [--event ID] [--schema FILE] [--json]
      Print one event in full, or every event when --event is omitted: line number,
      step, offset from the first event, type, the one-line description timeline
      prints, and the payload as the recorder wrote it. Exits 1 when the named event
      id is not in the file.
  tools FILE [--schema FILE] [--json]
      Aggregate one trace file by tool: how often each tool was called, how each call
      ended, which guards blocked the failed ones and which effects the completed ones
      left. Also reports the tool set the run declared and which of it was never used.
  errors FILE [--schema FILE] [--json]
      Aggregate one trace file by failure: every error class, how often it occurred,
      which event types produced it and on which lines, then every single occurrence
      with its event id, its related event id and its message. Reports guardrail
      refusals apart from errors, and names any related_event_id that points at an
      event the file does not carry.
  diff FILE FILE [--schema FILE] [--json]
      Compare two JSONL trace files: the run identity, the summary counters and the
      events themselves. Every difference carries its event id and the line numbers in
  both files. Exits 1 when the two traces differ.`;
const COMPARE_COMMAND = `  compare FILE FILE [--schema FILE] [--json]
      Compare the failure profiles of two JSONL trace files: the run status, the
      failure totals, every error class and every failing tool, each with its counts in
      both files and the delta between them. Exits 1 when the failure profiles differ.`;

const COMPARE_MODEL_COMMAND = `  compare FILE FILE [--schema FILE] [--json] [--model ...]
      As above, and with --model the two profiles and the events that carry the
      movement are sent to a model, whose findings are added, each bound to a
      side-qualified event reference. Without --model nothing leaves the machine.`;

const EXPLAIN_COMMAND = `  explain FILE [--schema FILE] [--json] [--model ...]
      Reduce one trace file to evidence-bound observations: how the run ended, what
      failed, what was refused, what the model last said, and what the trace does not
      establish. Without --model the command is local and deterministic. With --model
      the observations and the events they cite are sent to a model and its findings
      are added, each bound to event ids.`;

const EVAL_GEN_COMMAND = `  eval-gen FILE [--out DIR] [--force] [--schema FILE] [--json] [--model ...]
      Turn the failures of one trace file into regression cases: one case per error
      class, each carrying the occurrences it rests on with their line numbers and event
      ids. Nothing is written unless --out names a directory, and an existing file is
      never replaced without --force. With --model a model reads the cases against the
      events they cite and adds findings, each bound to an event id; the file --out writes
      is the deterministic report either way.`;

const FIX_SUGGEST_COMMAND = `  fix-suggest FILE [--schema FILE] [--json] [--model ...]
      Read one trace file and name the directions its own records point at: a run with
      no terminal event, a reference that points nowhere, a fatal failure, an error class
      that repeated, a tool that failed, a denied permission and a guardrail refusal.
      Every suggestion cites the events it was derived from and states what it does not
      establish. Nothing is changed, and nothing is sent anywhere.`;

const EXPLAIN_MODEL_OPTIONS = `  --model           ask a model to explain the run; off by default, nothing leaves the machine without it
  --model-name NAME  the model to ask (or set OPENAI_MODEL)
  --provider NAME    which model backend to use (default: openai-compatible)
  --timeout SEC      seconds to wait for the model (default: 60)
  --send-paths       include the trace file's own path in the request
  --max-excerpt N    how many cited events to quote to the model (default: 50)`;

const OPTIONS = `Options:
  --schema FILE  validate against this JSON Schema (draft 2020-12) instead of the bundled one
  --json         print the report as JSON instead of terminal text
  -h, --help     show this message`;

const EXIT_CODES = `Exit codes:
 0   the command succeeded
 1   the trace failed validation, or the command found a difference: diff between two
     traces, compare between two failure profiles, or a show --event id the file does
     not carry
 2   the trace file or the schema file could not be read
 3   the report could not be delivered: the output pipe closed or the disk filled, or a
     case file that would have replaced an existing one
 64  the command line could not be understood`;

const MODEL_EXIT_NOTE = `
The commands that take --model add two codes of their own, listed in their usage:
65 when the model answered but its answer could not be used, and 69 when no usable
answer was obtained. When --model is used and the model half fails, one of those two
replaces the code the deterministic half would have returned.`;

const MODEL_EXIT_CODES = `Exit codes:
  0   the command succeeded
  1   the trace failed validation
  2   the trace file or the schema file could not be read
  3   the report could not be written
  64  the command line could not be understood
  65  the model answered but its answer could not be used
  69  no usable answer was obtained from the model`;

export const USAGE = `usage: trace COMMAND [ARGS]

${COMMANDS}
${COMPARE_COMMAND}
${COMPARE_MODEL_COMMAND}
${EXPLAIN_COMMAND}
${EVAL_GEN_COMMAND}
${FIX_SUGGEST_COMMAND}

${OPTIONS}

${EXIT_CODES}${MODEL_EXIT_NOTE}`;

function commandUsage(command: string, args: string, description: string): string {
  return `usage: trace ${command} ${args} [--schema FILE] [--json]

${description}

${OPTIONS}

${EXIT_CODES}`;
}

const VALIDATE_USAGE = commandUsage(
  "validate",
  "FILE",
  `Validates one JSONL trace file against the bundled trace schema, or against the
schema given with --schema, and reports the file, line number, event id and reason
for every problem found.`,
);

const SUMMARY_USAGE = commandUsage(
  "summary",
  "FILE",
  `Aggregates one trace file: run status, duration, event counts, model call counts,
tool call counts, permission decisions, recorded errors and token totals. The file
is validated first, so an invalid trace is reported rather than summarized.`,
);

const TIMELINE_USAGE = commandUsage(
  "timeline",
  "FILE",
  `Lists one line per event in file order, grouped into model-call steps, each with
its line number, event id, offset from the first event and a one-line description.
The file is validated first, so an invalid trace is reported rather than listed.`,
);

const SHOW_USAGE = commandUsage(
  "show",
  "FILE [--event ID]",
  `Prints one event in full, or every event when --event is omitted: its line number,
model-call step, offset from the first event, type, the one-line description timeline
prints, and its payload exactly as the recorder wrote it. The file is validated first,
so an invalid trace is reported rather than shown. Exits 1 when --event names an event
id the file does not carry.`,
);

const DIFF_USAGE = commandUsage(
  "diff",
  "FILE FILE",
  `Compares two JSONL trace files and reports every difference: the run identity, the
summary counters and the events themselves, each with its event id and the line numbers
  in both files. Both files are validated first, so an invalid trace is reported rather
  than compared. Exits 1 when the two traces differ, 0 when they are identical.`,
);

const COMPARE_USAGE = `usage: trace compare FILE FILE [--schema FILE] [--json] [model options]

Compares the failure profiles of two JSONL trace files: the run status, the failure
totals, every error class and every failing tool, each with its counts in both files and
the delta between them. Both files are validated first, so an invalid trace is reported
rather than compared. Exits 1 when the failure profiles differ, 0 when they match. Two
runs that failed in the same way compare identical even when nothing else about them
matches: the shape of a successful run is diff's business, not this command's.

With --model the two profiles and the events that carry the movement are sent to a
model, and its findings are added, each bound to a side-qualified event reference.
Without --model the command is entirely deterministic: the same pair of files always
produces the same bytes.

${OPTIONS}

${EXPLAIN_MODEL_OPTIONS}

${MODEL_EXIT_CODES}`;

const TOOLS_USAGE = commandUsage(
  "tools",
  "FILE",
  `Aggregates one trace file by tool: how often each tool was called, how each call ended,
which guards blocked the failed ones and which effects the completed ones left. Also
reports the tool set the run declared and which of it was never invoked. The file is
validated first, so an invalid trace is reported rather than aggregated.`,
);

const ERRORS_USAGE = commandUsage(
  "errors",
  "FILE",
  `Aggregates one trace file by failure: every error class, how often it occurred, which
event types produced it and on which lines, then every single occurrence with its event
id, its related event id and its message. Guardrail refusals are reported apart from
errors, because the schema says a call that was blocked on purpose must not be counted
as a tool error. A trace that carries failures is still a readable trace, so this
command exits 0 when the report was delivered; only an unreadable file, an invalid
trace or an unusable command line changes the exit code.`,
);

const EXPLAIN_USAGE = `usage: trace explain FILE [--schema FILE] [--json] [model options]

Reduces one JSONL trace file to evidence-bound observations and reports what it says
about how the run ended. Without --model the report is entirely deterministic: the
same file always produces the same bytes. With --model the observations and the events
they cite are sent to a model, and its findings are added, each bound to event ids.

${OPTIONS}

${EXPLAIN_MODEL_OPTIONS}

${MODEL_EXIT_CODES}`;

const EVAL_GEN_USAGE = `usage: trace eval-gen FILE [--out DIR] [--force] [--schema FILE] [--json] [--model ...]

Turns the failures of one JSONL trace file into regression cases: one case per error class,
each carrying every occurrence it rests on, with its line number and event id, so an
assertion can be traced back to the event that justifies it. The file is validated first,
so cases are never generated from a trace that could not be read. A run with no failures
produces no cases, which is a normal answer and not an error.

Guardrail refusals produce no case. A refusal is the guard doing its job, so an assertion
that the run must not refuse would ask for the guard to be removed; the classes that were
left out for that reason are named at the end of the report instead.

Nothing is written unless --out names a directory. Without it the report goes to stdout and
the file system is left alone, which makes the plain command a dry run of the same thing
--out does. With --out the cases are written to one JSON file named after the run id, and
the same bytes are printed to stdout. An existing file is never replaced unless --force is
given: a case file is the record of a run that already happened.

With --model a model reads the cases against the events they cite and adds findings, each
bound to an event id. It does not rewrite an expectation and it does not add a case: the
cases are this tool's own and stay the same bytes whatever a model says. A trace that
produced no case has nothing to review, so no request is made and the model section says
so; the exit code stays the deterministic one.

${OPTIONS}

  --out DIR    write the cases to one JSON file in this directory (created if missing)
  --force      replace an existing case file instead of refusing to

${EXPLAIN_MODEL_OPTIONS}

${MODEL_EXIT_CODES}`;

const FIX_SUGGEST_USAGE = `usage: trace fix-suggest FILE [--schema FILE] [--json] [--model ...]

Names the directions one trace file's own records point at: a run with no terminal
event, a reference that points at an event the file does not carry, a fatal failure, an
error class that repeated, a tool that failed, a denied permission and a guardrail
refusal. The file is validated first, so a suggestion is never derived from a trace that
could not be read.

Every suggestion cites the events it was derived from, with their line numbers and event
ids, and states beside itself what it does not establish. A suggestion is a direction to
look, derived from a pattern in this trace: it is not a verified cause, it is not applied,
and nothing is sent anywhere. A trace with no pattern this slice knows about prints
"(no suggestions)" and still exits 0, which is not a claim that the run was healthy.

With --model a model reads the suggestions against the events they cite and adds findings,
each bound to an event id. It does not rewrite an action and it does not add a direction:
the suggestions are this tool's own and stay the same bytes whatever a model says. A trace
with no suggestion is not sent one, because asking a model to review nothing would invite
it to invent a direction; the model section records that no request was made and the exit
code stays the deterministic one.

${OPTIONS}

${EXPLAIN_MODEL_OPTIONS}

${MODEL_EXIT_CODES}`;

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ScannedArgs {
  help: boolean;
  files: string[];
  schemaPath: string | null;
  json: boolean;
  model: boolean;
  eventId: string | null;
  outDir: string | null;
  force: boolean;
  provider: string | null;
  modelName: string | null;
  timeoutSeconds: number | null;
  sendPaths: boolean;
  maxExcerptEvents: number | null;
}

type ScanResult = { ok: true; scanned: ScannedArgs } | { ok: false; error: string };

/**
 * Shared option scan. Every command takes the same `--schema`, `--json` and `--help`
 * options plus positional file arguments; what differs is how many files are expected,
 * which the wrappers below decide. `allowModelOptions` opens the `explain`-only model
 * flags and `allowEventOption` the `show`-only `--event` flag and `allowOutputOptions` the
 * `eval-gen`-only `--out` / `--force` pair, so `summary FILE --model` is still an unknown
 * option rather than a silently ignored one.
 */
function scanArgs(
  argv: string[],
  allowModelOptions = false,
  allowEventOption = false,
  allowOutputOptions = false,
): ScanResult {
  const files: string[] = [];
  let schemaPath: string | null = null;
  let json = false;
  let model = false;
  let eventId: string | null = null;
  let outDir: string | null = null;
  let force = false;
  let provider: string | null = null;
  let modelName: string | null = null;
  let timeoutSeconds: number | null = null;
  let sendPaths = false;
  let maxExcerptEvents: number | null = null;
  const snapshot = (help: boolean): ScannedArgs => ({
    help,
    files,
    schemaPath,
    json,
    model,
    eventId,
    outDir,
    force,
    provider,
    modelName,
    timeoutSeconds,
    sendPaths,
    maxExcerptEvents,
  });
  const valueOf = (value: string | undefined): string | null => {
    if (value === undefined || value.startsWith("--")) {
      return null;
    }
    return value;
  };
  const numberAfter = (name: string, raw: string): { ok: true; value: number } | { ok: false; error: string } => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, error: `${name} needs a positive whole number` };
    }
    return { ok: true, value: parsed };
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      // Help wins wherever it appears before a real error, so `FILE --help` prints
      // usage just like `--help FILE` does.
      return { ok: true, scanned: snapshot(true) };
    }
    if (arg === "--schema") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: "--schema needs a file path" };
      }
      schemaPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--schema=")) {
      const value = arg.slice("--schema=".length);
      if (value.length === 0) {
        return { ok: false, error: "--schema needs a file path" };
      }
      schemaPath = value;
      continue;
    }
    if (allowEventOption) {
      if (arg === "--event" || arg.startsWith("--event=")) {
        const inline = arg.startsWith("--event=") ? arg.slice("--event=".length) : undefined;
        const value = inline ?? valueOf(argv[index + 1]);
        if (value === null || value.length === 0) {
          return { ok: false, error: "--event needs an event id" };
        }
        eventId = value;
        if (inline === undefined) {
          index += 1;
        }
        continue;
      }
    }
    if (allowModelOptions) {
      if (arg === "--model") {
        model = true;
        continue;
      }
      if (arg === "--send-paths") {
        sendPaths = true;
        continue;
      }
      if (arg === "--provider" || arg.startsWith("--provider=")) {
        const inline = arg.startsWith("--provider=") ? arg.slice("--provider=".length) : undefined;
        const value = inline ?? valueOf(argv[index + 1]);
        if (value === null || value.length === 0) {
          return { ok: false, error: "--provider needs a name" };
        }
        provider = value;
        if (inline === undefined) {
          index += 1;
        }
        continue;
      }
      if (arg === "--model-name" || arg.startsWith("--model-name=")) {
        const inline = arg.startsWith("--model-name=") ? arg.slice("--model-name=".length) : undefined;
        const value = inline ?? valueOf(argv[index + 1]);
        if (value === null || value.length === 0) {
          return { ok: false, error: "--model-name needs a name" };
        }
        modelName = value;
        if (inline === undefined) {
          index += 1;
        }
        continue;
      }
      if (arg === "--timeout" || arg.startsWith("--timeout=")) {
        const inline = arg.startsWith("--timeout=") ? arg.slice("--timeout=".length) : undefined;
        const raw = inline ?? argv[index + 1];
        if (raw === undefined || raw.startsWith("--")) {
          return { ok: false, error: "--timeout needs a number of seconds" };
        }
        const parsed = numberAfter("--timeout", raw);
        if (!parsed.ok) {
          return parsed;
        }
        timeoutSeconds = parsed.value;
        if (inline === undefined) {
          index += 1;
        }
        continue;
      }
      if (arg === "--max-excerpt" || arg.startsWith("--max-excerpt=")) {
        const inline = arg.startsWith("--max-excerpt=") ? arg.slice("--max-excerpt=".length) : undefined;
        const raw = inline ?? argv[index + 1];
        if (raw === undefined || raw.startsWith("--")) {
          return { ok: false, error: "--max-excerpt needs a positive whole number" };
        }
        const parsed = numberAfter("--max-excerpt", raw);
        if (!parsed.ok) {
          return parsed;
        }
        maxExcerptEvents = parsed.value;
        if (inline === undefined) {
          index += 1;
        }
        continue;
      }
    }
    if (allowOutputOptions) {
      if (arg === "--force") {
        force = true;
        continue;
      }
      if (arg === "--out" || arg.startsWith("--out=")) {
        const inline = arg.startsWith("--out=") ? arg.slice("--out=".length) : undefined;
        const value = inline ?? valueOf(argv[index + 1]);
        if (value === null || value.length === 0) {
          return { ok: false, error: "--out needs a directory path" };
        }
        outDir = value;
        if (inline === undefined) {
          index += 1;
        }
        continue;
      }
    }
    if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option ${arg}` };
    }
    files.push(arg);
  }
  return {
    ok: true,
    scanned: snapshot(false),
  };
}

type ParsedArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; file: string; schemaPath: string | null; json: boolean }
  | { ok: false; error: string };

function parseCommandArgs(argv: string[]): ParsedArgs {
  const scanned = scanArgs(argv);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [file] = scanned.scanned.files;
  if (file === undefined) {
    return { ok: false, error: "a trace file is required" };
  }
  if (scanned.scanned.files.length > 1) {
    return { ok: false, error: `unexpected extra argument ${scanned.scanned.files[1]}` };
  }
  return { ok: true, help: false, file, schemaPath: scanned.scanned.schemaPath, json: scanned.scanned.json };
}

type ParsedShowArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; file: string; schemaPath: string | null; json: boolean; eventId: string | null }
  | { ok: false; error: string };

function parseShowArgs(argv: string[]): ParsedShowArgs {
  const scanned = scanArgs(argv, false, true);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [file] = scanned.scanned.files;
  if (file === undefined) {
    return { ok: false, error: "a trace file is required" };
  }
  if (scanned.scanned.files.length > 1) {
    return { ok: false, error: `unexpected extra argument ${scanned.scanned.files[1]}` };
  }
  return {
    ok: true,
    help: false,
    file,
    schemaPath: scanned.scanned.schemaPath,
    json: scanned.scanned.json,
    eventId: scanned.scanned.eventId,
  };
}

type ParsedTwoFileArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; file: string; secondFile: string; schemaPath: string | null; json: boolean }
  | { ok: false; error: string };

type ParsedCompareArgs =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      file: string;
      secondFile: string;
      schemaPath: string | null;
      json: boolean;
      model: boolean;
      modelFlags: ModelFlags;
    }
  | { ok: false; error: string };

/**
 * `compare`'s own parser: `parseTwoFileArgs` plus the model flags, which `diff` must
 * not accept. `diff FILE FILE --model` stays an unknown option rather than a silently
 * ignored one, so the two commands share nothing but the file count.
 */
function parseCompareArgs(argv: string[]): ParsedCompareArgs {
  const scanned = scanArgs(argv, true);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [first, second] = scanned.scanned.files;
  if (first === undefined || second === undefined) {
    return { ok: false, error: "two trace files are required" };
  }
  const extra = scanned.scanned.files[2];
  if (extra !== undefined) {
    return { ok: false, error: `unexpected extra argument ${extra}` };
  }
  const flags = scanned.scanned;
  return {
    ok: true,
    help: false,
    file: first,
    secondFile: second,
    schemaPath: flags.schemaPath,
    json: flags.json,
    model: flags.model,
    modelFlags: {
      provider: flags.provider,
      modelName: flags.modelName,
      timeoutSeconds: flags.timeoutSeconds,
      sendPaths: flags.sendPaths,
      maxExcerptEvents: flags.maxExcerptEvents,
    },
  };
}

/** Shared by the two two-file commands: the same shape, only the report differs. */
function parseTwoFileArgs(argv: string[]): ParsedTwoFileArgs {
  const scanned = scanArgs(argv);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [first, second] = scanned.scanned.files;
  if (first === undefined || second === undefined) {
    return { ok: false, error: "two trace files are required" };
  }
  const extra = scanned.scanned.files[2];
  if (extra !== undefined) {
    return { ok: false, error: `unexpected extra argument ${extra}` };
  }
  return {
    ok: true,
    help: false,
    file: first,
    secondFile: second,
    schemaPath: scanned.scanned.schemaPath,
    json: scanned.scanned.json,
  };
}

function finish(report: ValidationReport, json: boolean, exitCode: number): CliOutcome {
  return {
    exitCode,
    stdout: json ? renderJson(report) : renderText(report),
    stderr: "",
  };
}

/**
 * Runs `validate` without touching the process, so tests can assert exit codes and
 * exact output. The schema is loaded before the trace file, so a broken --schema is
 * reported even when the trace file is missing too.
 */
export function runValidate(argv: string[]): CliOutcome {
  const parsed = parseCommandArgs(argv);
 if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${VALIDATE_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${VALIDATE_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message), parsed.json, EXIT_UNREADABLE);
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loaded.message), parsed.json, EXIT_UNREADABLE);
  }

  const report = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate);
  return finish(report, parsed.json, report.valid ? EXIT_OK : EXIT_INVALID);
}

/**
 * Runs `summary` or `timeline`. Both commands read the same two things `validate`
 * reads, and both validate first: a trace with a schema error or a broken invariant
 * is reported instead of being aggregated, because a summary of an untrustworthy
 * file would look exactly as solid as a summary of a good one.
 */
function runAnalysis(argv: string[], command: "summary" | "timeline", usage: string): CliOutcome {
  const parsed = parseCommandArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${usage}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${usage}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, command), parsed.json, EXIT_UNREADABLE);
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loaded.message, command), parsed.json, EXIT_UNREADABLE);
  }

  const report = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, command);
  if (!report.valid) {
    return finish(report, parsed.json, EXIT_INVALID);
  }

  if (command === "summary") {
    const summary = summarize(parsed.file, schemaLabel, loaded.events);
    return {
      exitCode: EXIT_OK,
      stdout: parsed.json ? renderSummaryJson(summary) : renderSummaryText(summary),
      stderr: "",
    };
  }
  const timeline = buildTimeline(parsed.file, schemaLabel, loaded.events);
  return {
    exitCode: EXIT_OK,
    stdout: parsed.json ? renderTimelineJson(timeline) : renderTimelineText(timeline),
    stderr: "",
  };
}

export function runSummary(argv: string[]): CliOutcome {
  return runAnalysis(argv, "summary", SUMMARY_USAGE);
}

export function runTimeline(argv: string[]): CliOutcome {
  return runAnalysis(argv, "timeline", TIMELINE_USAGE);
}

/**
 * Runs `tools`. Like every other command it validates first, because a per-tool
 * aggregate of an untrustworthy file would look exactly as solid as one of a good
 * file. The report itself is a plain answer: a run with no tool calls at all is not
 * an error, it is a trace where the model never reached for a tool.
 */
export function runTools(argv: string[]): CliOutcome {
  const parsed = parseCommandArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${TOOLS_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${TOOLS_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, "tools"), parsed.json, EXIT_UNREADABLE);
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loaded.message, "tools"), parsed.json, EXIT_UNREADABLE);
  }

  const report = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, "tools");
  if (!report.valid) {
    return finish(report, parsed.json, EXIT_INVALID);
  }

  const tools = buildTools(parsed.file, schemaLabel, loaded.events);
  return {
    exitCode: EXIT_OK,
    stdout: parsed.json ? renderToolsJson(tools) : renderToolsText(tools),
    stderr: "",
  };
}

/**
 * Runs `show`. The file is validated first like every other command, then the selected
 * events are printed in full. An event id the file does not carry is a normal answer
 * for a reader who mistyped or who is looking at a different run, so it is reported on
 * stderr with exit 1 rather than as an empty report.
 */
export function runShow(argv: string[]): CliOutcome {
  const parsed = parseShowArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${SHOW_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${SHOW_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, "show"), parsed.json, EXIT_UNREADABLE);
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loaded.message, "show"), parsed.json, EXIT_UNREADABLE);
  }

  const report = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, "show");
  if (!report.valid) {
    return finish(report, parsed.json, EXIT_INVALID);
  }

  const shown = buildShow(parsed.file, schemaLabel, loaded.events, parsed.eventId);
  if (!shown.ok) {
    return { exitCode: EXIT_INVALID, stdout: "", stderr: `error: ${shown.message}\n\n${SHOW_USAGE}\n` };
  }

  return {
    exitCode: EXIT_OK,
    stdout: parsed.json ? renderShowJson(shown.report) : renderShowText(shown.report),
    stderr: "",
  };
}

/**
 * Runs `errors`. Validates first like every other command, for the same reason: a
 * failure aggregate of an untrustworthy file would look exactly as solid as one of a
 * good file. A trace full of failures is a perfectly readable trace, so delivering the
 * report is success and only the shared failure exit codes apply.
 */
export function runErrors(argv: string[]): CliOutcome {
  const parsed = parseCommandArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${ERRORS_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${ERRORS_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, "errors"), parsed.json, EXIT_UNREADABLE);
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loaded.message, "errors"), parsed.json, EXIT_UNREADABLE);
  }

  const report = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, "errors");
  if (!report.valid) {
    return finish(report, parsed.json, EXIT_INVALID);
  }

  const errors = buildErrors(parsed.file, schemaLabel, loaded.events);
  return {
    exitCode: EXIT_OK,
    stdout: parsed.json ? renderErrorsJson(errors) : renderErrorsText(errors),
    stderr: "",
  };
}

type ParsedEvalGenArgs =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      file: string;
      schemaPath: string | null;
      json: boolean;
      outDir: string | null;
      force: boolean;
      model: boolean;
      modelFlags: ModelFlags;
    }
  | { ok: false; error: string };

/**
 * `eval-gen`'s own parser: the one-file shape plus the output flags. `--out` and
 * `--force` belong to this command alone, so `summary FILE --out DIR` stays an unknown
 * option rather than a silently ignored one, the same way `--model` stays one on every
 * command that does not take a model.
 */
function parseEvalGenArgs(argv: string[]): ParsedEvalGenArgs {
  // The only command that takes both the output pair and the model flags: it is the
  // first that can write a file, and the model it may ask never touches that file.
  const scanned = scanArgs(argv, true, false, true);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [file] = scanned.scanned.files;
  if (file === undefined) {
    return { ok: false, error: "a trace file is required" };
  }
  if (scanned.scanned.files.length > 1) {
    return { ok: false, error: `unexpected extra argument ${scanned.scanned.files[1]}` };
  }
  return {
    ok: true,
    help: false,
    file,
    schemaPath: scanned.scanned.schemaPath,
    json: scanned.scanned.json,
    outDir: scanned.scanned.outDir,
    force: scanned.scanned.force,
    model: scanned.scanned.model,
    modelFlags: {
      provider: scanned.scanned.provider,
      modelName: scanned.scanned.modelName,
      timeoutSeconds: scanned.scanned.timeoutSeconds,
      sendPaths: scanned.scanned.sendPaths,
      maxExcerptEvents: scanned.scanned.maxExcerptEvents,
    },
  };
}

/**
 * Runs `eval-gen`.
 *
 * The file is validated first for the reason every other command validates first: a case
 * file generated from a trace that could not be read would look exactly as solid as one
 * generated from a good trace, and it would be the thing a later run is measured against.
 *
 * Writing is the only part that can fail after the report exists, and it fails as its own
 * exit code rather than as a thrown error: EXIT_REPORT_FAILED means the cases were
 * produced and not delivered, which is a different problem from a trace that would not
 * load and wants a different thing done about it.
 *
 * The model half never reaches the file. `writeCaseFile` is given the deterministic bytes
 * in both modes, because a case file is the record of a run that already happened and has
 * to be the same bytes for the same trace no matter which model answered; a model's words
 * go to stdout and nowhere else. The confirmation line is appended to the rendered report
 * for the same reason: it names a path on this machine, which is exactly the kind of thing
 * the report must not depend on if the same trace is to produce the same bytes elsewhere.
 */
export async function runEvalGen(argv: string[]): Promise<CliOutcome> {
  const parsed = parseEvalGenArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${EVAL_GEN_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${EVAL_GEN_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(
      reportForInputFailure(parsed.file, schemaLabel, schema.message, "eval-gen"),
      parsed.json,
      EXIT_UNREADABLE,
    );
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(
      reportForInputFailure(parsed.file, schemaLabel, loaded.message, "eval-gen"),
      parsed.json,
      EXIT_UNREADABLE,
    );
  }

  const validation = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, "eval-gen");
  if (!validation.valid) {
    return finish(validation, parsed.json, EXIT_INVALID);
  }

  // Built from the `errors` report rather than from the events again, so no counter in a
  // case can disagree with the command that owns it.
  const cases = buildEvalGen(buildErrors(parsed.file, schemaLabel, loaded.events), readInputSummary(loaded.events));
  // What the file holds in either mode: the deterministic report, byte for byte.
  const fileJson = renderEvalGenJson(cases);

  const flags = parsed.modelFlags;
  const draft = buildEvalGenDraft(cases, loaded.events, {
    maxExcerptEvents: flags.maxExcerptEvents ?? DEFAULT_MAX_EXCERPT_EVENTS,
    sendPaths: flags.sendPaths,
  });

  const noAnswer = (kind: ModelFailureKind, message: string, provider: string, model: string): ModelResult => ({
    ok: false,
    kind,
    message,
    provider,
    model,
    requests: 0,
    sent_events: 0,
    request_bytes: 0,
    redacted_fields: 0,
  });

  let report: EvalGenWithModel;
  let modelFailure: ModelResult | null = null;
  if (!parsed.model) {
    report = withoutEvalGenModel(draft);
  } else {
    const config = resolveModelConfig(flags);
    if (!config.ok) {
      // Not being able to name a model is a command-line problem, not a model failure:
      // nothing was attempted, so it is reported the way every other bad command line is.
      return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${config.message}\n\n${EVAL_GEN_USAGE}\n` };
    }
    if (draft.request === null) {
      // Nothing to review is not a model failure. The cases are still reported in full
      // and the model section says why no request left the machine, because a caller
      // reading a non-zero exit code would go looking for a provider problem that does
      // not exist.
      report = withEvalGenSkippedModel(draft.report, draft.skipReason ?? "", config.config.provider, config.config.model);
    } else if (config.config.apiKey === null) {
      modelFailure = noAnswer(
        "no_api_key",
        `no API key is configured; set ${ENV_API_KEY} or run without --model`,
        config.config.provider,
        config.config.model,
      );
      report = withEvalGenModelResult(draft.report, modelFailure);
    } else {
      const client = new OpenAICompatibleClient({
        baseUrl: config.config.baseUrl,
        apiKey: config.config.apiKey,
        model: config.config.model,
        timeoutMs: config.config.timeoutMs,
      });
      const result = await client.completeEvalGen(draft.request, draft.knownEventIds);
      modelFailure = result.ok ? null : result;
      report = withEvalGenModelResult(draft.report, result);
    }
  }

  if (parsed.outDir === null) {
    return {
      exitCode: modelFailure === null ? EXIT_OK : modelExitCode(modelFailure),
      stdout: parsed.json ? renderEvalGenModelJson(report) : renderEvalGenModelText(report),
      stderr: "",
    };
  }

  // The deterministic bytes, in both modes: the file is the record of the run, not of
  // what any model said about it.
  const written = writeCaseFile(parsed.outDir, cases.run_id, fileJson, parsed.force);
  if (!written.ok) {
    return finish(
      reportForWriteFailure(parsed.file, schemaLabel, written.message, "eval-gen"),
      parsed.json,
      EXIT_REPORT_FAILED,
    );
  }

  const confirmation = `\nwritten  ${written.path}  (${cases.cases.length} case${cases.cases.length === 1 ? "" : "s"}, ${written.bytes} bytes)\n`;
  return {
    exitCode: modelFailure === null ? EXIT_OK : modelExitCode(modelFailure),
    stdout: parsed.json ? renderEvalGenModelJson(report) : `${renderEvalGenModelText(report)}${confirmation}`,
    stderr: "",
  };
}

type ParsedFixSuggestArgs =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      file: string;
      schemaPath: string | null;
      json: boolean;
      model: boolean;
      modelFlags: ModelFlags;
    }
  | { ok: false; error: string };

/**
 * `fix-suggest`'s own parser: the one-file shape and nothing else.
 *
 * The model flags belong to this command since the slice that gave it a model half; they
 * stay unknown on `diff` and on every command that does not take a model, because a
 * command that does not take a model must not accept the flag and quietly ignore it.
 * There is no `--out` either, because this command writes nothing: a direction is read,
 * never recorded.
 */
function parseFixSuggestArgs(argv: string[]): ParsedFixSuggestArgs {
  const scanned = scanArgs(argv, true);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [file] = scanned.scanned.files;
  if (file === undefined) {
    return { ok: false, error: "a trace file is required" };
  }
  if (scanned.scanned.files.length > 1) {
    return { ok: false, error: `unexpected extra argument ${scanned.scanned.files[1]}` };
  }
  return {
    ok: true,
    help: false,
    file,
    schemaPath: scanned.scanned.schemaPath,
    json: scanned.scanned.json,
    model: scanned.scanned.model,
    modelFlags: {
      provider: scanned.scanned.provider,
      modelName: scanned.scanned.modelName,
      timeoutSeconds: scanned.scanned.timeoutSeconds,
      sendPaths: scanned.scanned.sendPaths,
      maxExcerptEvents: scanned.scanned.maxExcerptEvents,
    },
  };
}

/**
 * Runs `fix-suggest`.
 *
 * Validates first like every other command, and for one reason more than habit: a
 * suggestion derived from a trace that could not be read would look exactly as solid as
 * one derived from a good trace, and this is the command whose output reads as advice.
 *
 * The exit code says whether the report was delivered, not whether there is anything to
 * suggest. A readable trace with no pattern this slice knows about is a successful report
 * about a clean-looking run, which is not the same claim as a healthy run, and the report
 * itself says so.
 *
 * With `--model` the command was asked for two things, so a caller that gets `0` must not
 * read it as "the directions are sound" when the model was never heard from: `65` and
 * `69` therefore win over `0`, the way they do on `eval-gen`, and the deterministic
 * suggestions are still in the report.
 */
export async function runFixSuggest(argv: string[]): Promise<CliOutcome> {
  const parsed = parseFixSuggestArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${FIX_SUGGEST_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${FIX_SUGGEST_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(
      reportForInputFailure(parsed.file, schemaLabel, schema.message, "fix-suggest"),
      parsed.json,
      EXIT_UNREADABLE,
    );
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(
      reportForInputFailure(parsed.file, schemaLabel, loaded.message, "fix-suggest"),
      parsed.json,
      EXIT_UNREADABLE,
    );
  }

  const validation = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, "fix-suggest");
  if (!validation.valid) {
    return finish(validation, parsed.json, EXIT_INVALID);
  }

  // Built from the `errors` report rather than from the events again, so no count in a
  // suggestion can disagree with the command that owns it.
  const report = buildFixSuggest(buildErrors(parsed.file, schemaLabel, loaded.events), loaded.events);

  const flags = parsed.modelFlags;
  const draft = buildFixSuggestDraft(report, loaded.events, {
    maxExcerptEvents: flags.maxExcerptEvents ?? DEFAULT_MAX_EXCERPT_EVENTS,
    sendPaths: flags.sendPaths,
  });

  const noAnswer = (kind: ModelFailureKind, message: string, provider: string, model: string): ModelResult => ({
    ok: false,
    kind,
    message,
    provider,
    model,
    requests: 0,
    sent_events: 0,
    request_bytes: 0,
    redacted_fields: 0,
  });

  let withModel: FixSuggestWithModel;
  let modelFailure: ModelResult | null = null;
  if (!parsed.model) {
    withModel = withoutFixSuggestModel(draft);
  } else {
    const config = resolveModelConfig(flags);
    if (!config.ok) {
      // Not being able to name a model is a command-line problem, not a model failure:
      // nothing was attempted, so it is reported the way every other bad command line is.
      return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${config.message}\n\n${FIX_SUGGEST_USAGE}\n` };
    }
    if (draft.request === null) {
      // Nothing to review is not a model failure. The suggestions are still reported in
      // full and the model section says why no request left the machine, because a caller
      // reading a non-zero exit code would go looking for a provider problem that does
      // not exist.
      withModel = withFixSuggestSkippedModel(
        draft.report,
        draft.skipReason ?? "",
        config.config.provider,
        config.config.model,
      );
    } else if (config.config.apiKey === null) {
      modelFailure = noAnswer(
        "no_api_key",
        `no API key is configured; set ${ENV_API_KEY} or run without --model`,
        config.config.provider,
        config.config.model,
      );
      withModel = withFixSuggestModelResult(draft.report, modelFailure);
    } else {
      const client = new OpenAICompatibleClient({
        baseUrl: config.config.baseUrl,
        apiKey: config.config.apiKey,
        model: config.config.model,
        timeoutMs: config.config.timeoutMs,
      });
      const result = await client.completeFixSuggest(draft.request, draft.knownEventIds);
      modelFailure = result.ok ? null : result;
      withModel = withFixSuggestModelResult(draft.report, result);
    }
  }

  return {
    exitCode: modelFailure === null ? EXIT_OK : modelExitCode(modelFailure),
    stdout: parsed.json ? renderFixSuggestModelJson(withModel) : renderFixSuggestModelText(withModel),
    stderr: "",
  };
}

type ParsedExplainArgs =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      file: string;
      schemaPath: string | null;
      json: boolean;
      model: boolean;
      modelFlags: ModelFlags;
    }
  | { ok: false; error: string };

function parseExplainArgs(argv: string[]): ParsedExplainArgs {
  const scanned = scanArgs(argv, true);
  if (!scanned.ok) {
    return scanned;
  }
  if (scanned.scanned.help) {
    return { ok: true, help: true };
  }
  const [file] = scanned.scanned.files;
  if (file === undefined) {
    return { ok: false, error: "a trace file is required" };
  }
  if (scanned.scanned.files.length > 1) {
    return { ok: false, error: `unexpected extra argument ${scanned.scanned.files[1]}` };
  }
  const flags = scanned.scanned;
  return {
    ok: true,
    help: false,
    file,
    schemaPath: flags.schemaPath,
    json: flags.json,
    model: flags.model,
    modelFlags: {
      provider: flags.provider,
      modelName: flags.modelName,
      timeoutSeconds: flags.timeoutSeconds,
      sendPaths: flags.sendPaths,
      maxExcerptEvents: flags.maxExcerptEvents,
    },
  };
}

/**
 * Runs `explain`.
 *
 * The file is validated before anything is sent anywhere, for the same reason the
 * other commands validate first: an explanation of an untrustworthy file would look
 * exactly as solid as an explanation of a good one. Without `--model` the command is
 * entirely local and deterministic, which is the whole report.
 */
export async function runExplain(argv: string[]): Promise<CliOutcome> {
  const parsed = parseExplainArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${EXPLAIN_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${EXPLAIN_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, "explain"), parsed.json, EXIT_UNREADABLE);
  }

  const loaded = loadTraceFile(parsed.file);
  if (!loaded.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loaded.message, "explain"), parsed.json, EXIT_UNREADABLE);
  }

  const report = validateEvents(parsed.file, schemaLabel, loaded.events, schema.validate, "explain");
  if (!report.valid) {
    return finish(report, parsed.json, EXIT_INVALID);
  }

  const flags = parsed.modelFlags;
  const draft = buildExplainDraft(parsed.file, schemaLabel, loaded.events, {
    maxExcerptEvents: flags.maxExcerptEvents ?? DEFAULT_MAX_EXCERPT_EVENTS,
    sendPaths: flags.sendPaths,
  });

  const noAnswer = (kind: ModelFailureKind, message: string, provider: string, model: string): ModelResult => ({
    ok: false,
    kind,
    message,
    provider,
    model,
    requests: 0,
    sent_events: 0,
    request_bytes: 0,
    redacted_fields: 0,
  });

  if (!parsed.model) {
    return explainOutcome({ ...draft.report, unverified: [...draft.report.unverified, NO_MODEL_NOTE] }, parsed.json);
  }

  const config = resolveModelConfig(flags);
  if (!config.ok) {
    // Not being able to name a model is a command-line problem, not a model failure:
    // nothing was attempted, so it is reported the way every other bad command line is.
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${config.message}\n\n${EXPLAIN_USAGE}\n` };
  }
  if (config.config.apiKey === null) {
    return explainOutcome(
      withModelResult(
        draft.report,
        noAnswer("no_api_key", `no API key is configured; set ${ENV_API_KEY} or run without --model`, config.config.provider, config.config.model),
      ),
      parsed.json,
      EXIT_MODEL_UNAVAILABLE,
    );
  }

  const client = new OpenAICompatibleClient({
    baseUrl: config.config.baseUrl,
    apiKey: config.config.apiKey,
    model: config.config.model,
    timeoutMs: config.config.timeoutMs,
  });
  const result = await client.complete(draft.request, draft.knownEventIds);
  const explained = withModelResult(draft.report, result);
  return explainOutcome(explained, parsed.json, modelExitCode(result));
}

function explainOutcome(report: ExplainReport, json: boolean, exitCode = EXIT_OK): CliOutcome {
  return {
    exitCode,
    stdout: json ? renderExplainJson(report) : renderExplainText(report),
    stderr: "",
  };
}

/**
 * Exit code for one model outcome. A call that never produced an answer is
 * "unavailable"; an answer that arrived but could not be used is "unusable", because a
 * caller retrying a timeout and a caller debugging a malformed answer want to do
 * different things next.
 */
function modelExitCode(result: ModelResult): number {
  if (result.ok) {
    return EXIT_OK;
  }
  switch (result.kind) {
    case "network_error":
    case "timeout":
    case "http_error":
    case "empty_answer":
    case "no_api_key":
      return EXIT_MODEL_UNAVAILABLE;
    default:
      return EXIT_MODEL_UNUSABLE;
  }
}

/**
 * Runs `diff`. Both files are read and validated before anything is compared: a diff
 * of an untrustworthy file would look exactly as solid as a diff of a good one, so the
 * first file that fails validation is reported instead, with the same errors
 * `validate` prints. Exit code 1 means "the traces differ", which is a normal answer
 * for this command, not an error.
 */
export function runDiff(argv: string[]): CliOutcome {
  const parsed = parseTwoFileArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${DIFF_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${DIFF_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, "diff"), parsed.json, EXIT_UNREADABLE);
  }

  const loadedA = loadTraceFile(parsed.file);
  if (!loadedA.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loadedA.message, "diff"), parsed.json, EXIT_UNREADABLE);
  }
  const loadedB = loadTraceFile(parsed.secondFile);
  if (!loadedB.ok) {
    return finish(
      reportForInputFailure(parsed.secondFile, schemaLabel, loadedB.message, "diff"),
      parsed.json,
      EXIT_UNREADABLE,
    );
  }

  const reportA = validateEvents(parsed.file, schemaLabel, loadedA.events, schema.validate, "diff");
  if (!reportA.valid) {
    return finish(reportA, parsed.json, EXIT_INVALID);
  }
  const reportB = validateEvents(parsed.secondFile, schemaLabel, loadedB.events, schema.validate, "diff");
  if (!reportB.valid) {
    return finish(reportB, parsed.json, EXIT_INVALID);
  }

  const report = diffTraces(parsed.file, parsed.secondFile, schemaLabel, loadedA.events, loadedB.events);
  return {
    exitCode: report.identical ? EXIT_OK : EXIT_INVALID,
    stdout: parsed.json ? renderDiffJson(report) : renderDiffText(report),
    stderr: "",
  };
}

/**
 * Runs `compare`. Both files are read and validated before anything is compared, for
 * the same reason every other command validates first. Exit code 1 means "the failure
 * profiles differ", which is the normal answer for this command: a candidate run that
 * fails where the baseline did not is a finding, not a broken invocation.
 */
export async function runCompare(argv: string[]): Promise<CliOutcome> {
  const parsed = parseCompareArgs(argv);
  if (!parsed.ok) {
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${parsed.error}\n\n${COMPARE_USAGE}\n` };
  }
  if (parsed.help) {
    return { exitCode: EXIT_OK, stdout: `${COMPARE_USAGE}\n`, stderr: "" };
  }

  const schemaLabel = parsed.schemaPath ?? BUNDLED_SCHEMA_LABEL;
  const schema = loadValidator(parsed.schemaPath);
  if (!schema.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, schema.message, "compare"), parsed.json, EXIT_UNREADABLE);
  }

  const loadedA = loadTraceFile(parsed.file);
  if (!loadedA.ok) {
    return finish(reportForInputFailure(parsed.file, schemaLabel, loadedA.message, "compare"), parsed.json, EXIT_UNREADABLE);
  }
  const loadedB = loadTraceFile(parsed.secondFile);
  if (!loadedB.ok) {
    return finish(
      reportForInputFailure(parsed.secondFile, schemaLabel, loadedB.message, "compare"),
      parsed.json,
      EXIT_UNREADABLE,
    );
  }

  const reportA = validateEvents(parsed.file, schemaLabel, loadedA.events, schema.validate, "compare");
  if (!reportA.valid) {
    return finish(reportA, parsed.json, EXIT_INVALID);
  }
  const reportB = validateEvents(parsed.secondFile, schemaLabel, loadedB.events, schema.validate, "compare");
  if (!reportB.valid) {
    return finish(reportB, parsed.json, EXIT_INVALID);
  }

  const flags = parsed.modelFlags;
  const draft = buildCompareDraft(
    buildCompare(parsed.file, parsed.secondFile, schemaLabel, loadedA.events, loadedB.events),
    loadedA.events,
    loadedB.events,
    {
      maxExcerptEvents: flags.maxExcerptEvents ?? DEFAULT_MAX_EXCERPT_EVENTS,
      sendPaths: flags.sendPaths,
    },
  );

  const noAnswer = (kind: ModelFailureKind, message: string, provider: string, model: string): ModelResult => ({
    ok: false,
    kind,
    message,
    provider,
    model,
    requests: 0,
    sent_events: 0,
    request_bytes: 0,
    redacted_fields: 0,
  });

  if (!parsed.model) {
    return compareOutcome(withoutModel(draft), parsed.json);
  }

  const config = resolveModelConfig(flags);
  if (!config.ok) {
    // Not being able to name a model is a command-line problem, not a model failure:
    // nothing was attempted, so it is reported the way every other bad command line is.
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${config.message}\n\n${COMPARE_USAGE}\n` };
  }

  // Nothing anchored to ask about is not a model failure. The comparison is still
  // reported in full, and the model section says why no request left the machine,
  // because a caller reading a non-zero exit code would go looking for a provider
  // problem that does not exist.
  if (draft.request === null) {
    return compareOutcome(withSkippedModel(draft.report, draft.skipReason ?? "", config.config.provider, config.config.model), parsed.json);
  }

  if (config.config.apiKey === null) {
    return compareOutcome(
      withCompareModelResult(
        draft.report,
        noAnswer("no_api_key", `no API key is configured; set ${ENV_API_KEY} or run without --model`, config.config.provider, config.config.model),
      ),
      parsed.json,
      EXIT_MODEL_UNAVAILABLE,
    );
  }

  const client = new OpenAICompatibleClient({
    baseUrl: config.config.baseUrl,
    apiKey: config.config.apiKey,
    model: config.config.model,
    timeoutMs: config.config.timeoutMs,
  });
  const result = await client.completeCompare(draft.request, draft.knownEventIds);

  // A model failure wins over the deterministic verdict. `compare --model` was asked
  // for two things, and a caller that gets 1 here must not read it as "the model
  // agreed the profiles differ" when the model was never heard from.
  return compareOutcome(withCompareModelResult(draft.report, result), parsed.json, result.ok ? undefined : modelExitCode(result));
}

/**
 * Renders one compare report. With no explicit code the deterministic verdict decides:
 * identical failure profiles are 0 and a difference is 1. Only a model failure
 * overrides that, which is why the override is passed rather than inferred.
 */
function compareOutcome(report: CompareWithModel, json: boolean, exitCode?: number): CliOutcome {
  return {
    exitCode: exitCode ?? (report.identical ? EXIT_OK : EXIT_INVALID),
    stdout: json ? renderCompareJson(report) : renderCompareText(report),
    stderr: "",
  };
}

function processIO(): CliIO {
  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}

function writeOutcome(outcome: CliOutcome, io: CliIO): number {
  try {
    if (outcome.stdout.length > 0) {
      io.stdout(outcome.stdout);
    }
    if (outcome.stderr.length > 0) {
      io.stderr(outcome.stderr);
    }
  } catch {
    return EXIT_REPORT_FAILED;
  }
  return outcome.exitCode;
}

function usageOutcome(message: string): CliOutcome {
  return { exitCode: EXIT_USAGE, stdout: "", stderr: `error: ${message}\n\n${USAGE}\n` };
}

/**
 * Entry point. Takes the arguments after the program name, dispatches on the
 * subcommand and writes the outcome, returning the process exit code. A writer that
 * throws (a closed pipe, a full disk) maps to EXIT_REPORT_FAILED rather than being
 * swallowed.
 *
 * Async because `explain --model`, `compare --model`, `eval-gen --model` and
 * `fix-suggest --model` are the commands that may wait on the network. The others stay
 * synchronous, so a caller that never passes `--model` still gets a synchronous answer.
 */
export async function main(argv: string[], io: CliIO = processIO()): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === undefined) {
    return writeOutcome(usageOutcome("a command is required"), io);
  }
  if (subcommand === "--help" || subcommand === "-h") {
    return writeOutcome({ exitCode: EXIT_OK, stdout: `${USAGE}\n`, stderr: "" }, io);
  }
  switch (subcommand) {
    case "validate":
      return writeOutcome(runValidate(argv.slice(1)), io);
    case "summary":
      return writeOutcome(runSummary(argv.slice(1)), io);
    case "timeline":
      return writeOutcome(runTimeline(argv.slice(1)), io);
    case "tools":
      return writeOutcome(runTools(argv.slice(1)), io);
    case "errors":
      return writeOutcome(runErrors(argv.slice(1)), io);
    case "eval-gen":
      return writeOutcome(await runEvalGen(argv.slice(1)), io);
    case "fix-suggest":
      return writeOutcome(await runFixSuggest(argv.slice(1)), io);
    case "show":
      return writeOutcome(runShow(argv.slice(1)), io);
    case "diff":
      return writeOutcome(runDiff(argv.slice(1)), io);
    case "compare":
      return writeOutcome(await runCompare(argv.slice(1)), io);
    case "explain":
      return writeOutcome(await runExplain(argv.slice(1)), io);
    default:
      return writeOutcome(usageOutcome(`unknown command ${subcommand}`), io);
  }
}
