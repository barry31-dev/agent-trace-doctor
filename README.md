# Agent Trace Doctor

A command-line tool for inspecting, validating and comparing agent run traces. Every
command reads a trace and prints a report and changes nothing on disk; `eval-gen --out`
is the one exception, and it writes only the file it was told to write.

> **Status: v0.1.0 (slices S0-S24) at**
> https://github.com/barry31-dev/agent-trace-doctor.
> **Measured 2026-10-17, read-only (`gh api` and `git ls-remote`)**: that repository
> is public and no longer empty. Its `main` is a single root commit,
> `8848261132aa56d9724f52e287de1fba06a6fb8c`, and the annotated tag `v0.1.0` (tag
> object `d46ce35c`) points at it, so the tag exists. The GitHub release for that tag
> does not: the same read reports zero releases. The channel that would cut it is
> implemented and rehearsed with every gate run before any remote is contacted, and it
> refuses to act on a remote that already has refs -- which is why that step is still
> open rather than already taken. The Markdown files the repository carries now are
> the wording this paragraph replaces: they were already false when they were pushed
> at 2026-10-16 14:37 UTC, and they are the only members by which that tree differs
> from this one. Nothing is published to npm. The CI workflow has never run.
>
> **Superseded 2026-10-17:** the release exists -- created through the channel
> above (`--publish-followup`, which refuses to touch a remote with no refs, so it is
> the mirror of the first publication), and read back from the API the same day. What
> that read measured: the release is on tag **`v0.1.1`** (there is still no release for
> `v0.1.0`), it is neither a draft nor a prerelease, the tag object
> `549f117a0e5cd01406490ab3933c5a86d9842fd9` has tagger
> `barry31-dev <329888575+barry31-dev@users.noreply.github.com>`, the follow-up commit
> `f4d73c2266c16629c1b52fba58a5517f6f109eb6` carries this paragraph on top of the root
> commit, and its author, committer, `author.login` and `committer.login` are all
> `barry31-dev`. The repository therefore matches what this paragraph claims, and the
> Markdown the repository carried at 2026-10-16 14:37 UTC no longer differs from this
> tree except in these dated corrections. Nothing is published to npm. **The CI workflow still has
> never run, and by the maintainer's decision it will not**: GitHub Actions here is
> behind an account-side billing gate that the project does not intend to clear, so
> the "continuous integration" row below describes steps that were written and
> reviewed and then deliberately left unexecuted, not steps that pass. What was
> measured without a runner is stated where it was measured; nothing in this file
> should be read as a runner having executed it.
> `validate`, `summary`, `timeline`, `show`, `tools`, `errors`, `diff`, `compare`,
> `explain`, `eval-gen` and `fix-suggest` work and are covered by tests, and `compare`,
> `explain`, `eval-gen` and `fix-suggest` all take `--model`. Everything marked "planned"
> below is a plan, not a working feature.
>
> The command name is `trace-doctor` and the license is Apache-2.0; both were decided
> together, and an installed copy is run by that command name rather than by path. What
> follows describes this version rather than a plan for a later one.
>
> Slice S4 added a development-time mini agent spike (`spike/`, not part of the CLI) that runs
> a real five-step agent and writes a real trace, plus the schema revisions that trace
> forced. The review is in `spike/SCHEMA_REVIEW.md`.
>
> Slice S5 added `explain`, and with it the model layer. `explain` without `--model` is
> entirely local and deterministic. `--model` is the only thing in this repository that
> opens a network connection, it is off unless it is typed, and exactly what it sends is
> listed below rather than described.

> Slice S10 gave `compare` a model half, and with it a rule the model layer did not need
> before: both traces may carry the same event id, so a finding about a pair cites
> `a:EVENT_ID` or `b:EVENT_ID` rather than a bare id.

> Slice S11 added `eval-gen`, the first command that can leave a file behind, and the
> reason the line above the first block had to be reworded: a tool that writes a case
> file is not a read-only tool, so the promise is now per command rather than for the
> existing file without `--force`.
>
> Slice S12 gave `eval-gen` a model half. It is the first `--model` command whose answer
> is deliberately not part of its output file: the cases are this tool's own and stay the
> same bytes whatever a model says, so a model reviews them on stdout and the file keeps
> the deterministic report.

> Slice S13 added `fix-suggest`, the deterministic half of the last planned command. It
> names the directions a trace's own records point at and states beside each one what it
> does not establish: a suggestion here is a direction to look, never a diagnosis, and
> the command changes nothing and sends nothing anywhere.

> Slice S14 gave `fix-suggest` its model half, which closes the last planned command. The
> directions are this tool's own and stay the same bytes whatever a model says, so the
> model reads them against the events they cite and reports what it sees without rewriting
> an action -- the same boundary `eval-gen --model` draws around its cases.

> Slice S15 made the package installable from a clean environment. `ajv` and
> `ajv-formats` are runtime imports of `src/` but had been declared as devDependencies,
> which a consumer install skips, so an installed CLI would have crashed on its first
> schema compile; they are dependencies now. A `files` field pins the packed surface to
> the compiled CLI, its entry script and the bundled schema, and the packed tarball is
> verified by installing it into an empty directory and running the CLI from there. The
> package is installed by command name now that the name is decided, and it is no longer
> marked private.

> Slice S16 changed no code. It was a consistency pass over this README and the
> changelog themselves: a paragraph printed twice, a sentence that stopped mid-word, two
> entries listed twice, and a repository inventory that skipped `src/evalGenModel.ts`.
> The suite stood unchanged at 586 tests.

> Slice S17 drew the request boundary of the model layer. A trace payload can carry a
> credential -- the schema allows fields the tool does not know about, so a recorder can
> put anything there -- and a quoted payload was otherwise sent verbatim, which the design
> draft's request boundary forbids. Values under a credential-looking key name are now
> replaced by `[redacted]` before the request is built, the model section counts them, and
> every task statement and system prompt declares the quoted payloads to be data a run
> recorded rather than instructions to follow. The rule is names, not value shapes, and
> this README says so plainly: a value that only looks like a key under a name that says
> nothing is still sent. The suite stands at 604 tests.

> Slice S18 pinned the boundary the last slice drew. Declaring a payload to be data is a
> promise made to the model, not proof about this tool, so a trace was written whose
> payload reads like an instruction -- a run that tells the model to answer with one
> word, an argument summary claiming a deletion was approved, an error naming an event
> that does not exist -- and its fourteen counters and every exit code were held
> identical to the same trace with neutral prose. The same trace with an unknown field
> claiming the opposite of a known one moved no counter either, because each counter
> reads a named field of a named event type, and every malformed answer is refused
> whole. The task statement the transport sends is now taken from the request being sent
> rather than rebuilt beside it, so there is one source for it. The suite stands at 621
> tests.

> Slice S19 closed the last open check of the slice before it. The compare instruction
> positions were the only two still asserted with `toContain`, which passes whatever
> else a statement carries; both compare against the constants now, so all four model
> halves have both instruction positions pinned byte for byte. The suite stands at 621
> tests.
>
> Slice S20 cut the version: `package.json` reads `0.1.0`, the changelog's newest
> released entry is that version, and the packed tarball is named for it. Slice S22
> added the continuous integration described under Development, which has never run.
> What a reader may rely on, and what has only been checked by hand, is written down in
> `RELEASE_NOTES.md`.

## What it will do

Given a `trace.jsonl` file written by an agent recorder, the tool answers four
questions. `summary` and `timeline` already cover the first three. `diff` and `explain`
answer the fourth: `diff` says what differs between two runs, `explain` says what one
run's own events report about how it ended, and `explain --model` adds a model's reading
of the same events, each conclusion bound to the event that carries it.
`tools` and `errors` narrow the third question down to one tool or one failure, and
`show` covers the question all of the others raise: what exactly did this one event
record? `compare` answers the question a developer has after changing a prompt or a
tool: did the run get worse? It compares the failure profiles of two traces and reports
every error class and failing tool that moved, while `diff` stays with the structural
differences.
`compare --model` answers the follow-up: not only what moved, but what the events that
carry the movement say about it, with every conclusion bound to the file and the event
it came from.
`eval-gen` answers the question a developer has after that: what would prove this stays
fixed? It turns the failures of one trace into one case per error class, each carrying
the line and event id of every occurrence it rests on. `eval-gen --model` reads those
cases back against the events they cite and reports where one assertion is standing for
two different failures, which is the question a reader has once the cases exist.

`fix-suggest` answers the one after that: where do I look next? It reads one trace and
names the directions its own records point at -- a run with no terminal event, a
reference that points nowhere, a fatal failure, an error class that repeated, a tool
that failed, a denied permission, a guardrail refusal -- and every suggestion cites the
events it was derived from and states what it does not establish. It is deliberately not
a diagnosis: the trace records what happened, not why, and a suggestion that read as a
cause would be the one thing this command could not afford. Nothing is changed, nothing
is executed, and nothing is sent anywhere.
`fix-suggest --model` reads those directions back against the events they cite and reports
where a suggestion's evidence does not share one pattern, or where two suggestions are
looking at the same event. The directions stay this tool's own and keep the same bytes
whatever a model says, so the model reads them and never rewrites one.

1. What was the final status of the run?
2. How long did it take, how many model and tool calls happened, how many tokens were spent?
3. What happened at each step, including tool arguments, results and errors?
4. Why did one run succeed and another fail?

Every command that does not carry `--model` must stay deterministic: no network access,
no API key, same input produces the same report.

`explain` is where that line is drawn. Without `--model` it never leaves the machine and
the same file always produces the same bytes; the report it prints is a restatement of
events, not an interpretation. With `--model` a model reads the same events and adds
findings, and the report says which parts are which.

## What is in the repository

| Path | What it is |
| ---|---|
| `schemas/trace.schema.json` | JSON Schema (draft 2020-12) for one trace event, i.e. one JSONL line. Accepts schema version `1` only. |
| `examples/success.jsonl` | Synthetic run that completes: 19 events, `run_01`. |
| `examples/failed.jsonl` | Synthetic run that fails: 26 events, `run_02`. Includes a guardrail refusal, a real tool failure, a model retry after a rate limit, and a failed final status. |
| `examples/cancelled.jsonl` | Synthetic run cancelled after a denied permission: 8 events, `run_03`. |
| `examples/spike-run.jsonl` | **A real trace**, not a synthetic one. The output of the mini agent spike on 2026-10-14: 22 events, `run_spike_05`, five model turns, four tool calls, one approved permission. Its timestamps and durations are real wall-clock values, so it is not byte-stable across runs. |
| `tests/` | Vitest suite (624 tests): the examples validate against the schema, cross-line invariants hold, the schema rejects malformed events, the loader reports every unreadable-input case with a line number, the CLI maps each case to its documented exit code, the analyzer reproduces the examples by hand and stays byte-stable, and the diff reproduces the examples by hand and stays byte-stable. The spike suite covers the recorder invariants, the sandbox, the five-step loop, every `spike-run` exit code, and the committed example's structure, and asserts that example still matches the code that produces it and that a run leaves no scratch directory behind. The explain suite covers observation order and evidence binding, the excerpt cap, the deterministic notes, and the byte-stability of the whole report, and compares the terminal output shown in this README against what the command actually prints. The model suite checks the answer contract, including that a finding citing an event id which is not in the trace is rejected, and runs a real HTTP request against a local stub server to prove the success, non-2xx, no-content, malformed-answer, connection-refused and timeout paths. The show suite pins that `show` and `timeline` report the same line, step, offset and description for every event of every example, that the payload survives with its key order, and that the terminal output shown in this README is what the command actually prints. The tools suite hand-checks every example's counters, covers the unresolved arithmetic in both directions, the guard and effect distributions, the declared / unused / undeclared split, the row and distribution ordering, the bucket for a tool call with no tool name, and compares the terminal output shown in this README against what the command actually prints. The errors suite hand-checks every example's failure counts, covers the refusal split in both directions, fatal only on `error.recorded`, the null flags on the event types that have no such field, the tool / model split, the class and occurrence ordering, the dangling-reference check in both directions, the bucket for a failure with no error class, and compares the terminal output shown in this README against what the command actually prints. The compare suite hand-checks both example pairs in both directions, pins that a status change counts as one difference so a cancelled run is not an all-clear, that two clean but unrelated runs compare identical, that a same-count change in composition is reported as shifted with its reason, the row ordering rule, the null side for a class that never occurred, the reconciliation of every counter against the `errors` and `tools` reports, the stable key order of both output modes, byte-stability across every pair, and compares the terminal output shown in this README against what the command actually prints. The compare-model suite pins that every observation is anchored to a real event of the side it names, that a side with no event there is left out rather than stated without evidence, that the quoted events are exactly the cited ones with their side, that both file paths stay out unless `--send-paths` is given, that the events past `--max-excerpt` are named rather than dropped, that a bare event id is refused as evidence while a side-qualified one is accepted, that a failed attempt keeps the deterministic report, and that a skipped call is recorded as a no-op rather than a failure. The CLI suite runs a real HTTP request against a local stub server to prove the compare request's payload, the findings, the no-key and bad-evidence exit codes, and that `diff` still refuses `--model`. The eval-gen suite hand-checks the case count of the real trace, pins that every occurrence a case cites is the occurrence `errors` reports for the same event, that a class whose every occurrence was a refusal produces no case and is named instead, that a class with both keeps only the real failures and takes its first and last line from them rather than from the refusal ahead of them, the tool and source distributions, the reconciliation of every counter against the `errors` report, the stable key order of both output modes, byte-stability, and the terminal output shown in this README against what the command actually prints. The case-writer suite covers the file name a run id produces, including every way a run id could name a path outside the directory it was given, and the directory creation, the overwrite refusal, the forced replacement and the unwritable-directory path. The fix-suggest suite hand-checks the suggestion list of the real failed trace and the denied permission of the cancelled one, pins the rule order so a file with no terminal event suggests its own incompleteness first, that a class is called repeated only from two or more occurrences, that the fatal occurrences of a class are suggested alone while the same class still counts as repeated, that a refused call is counted apart from a failed one and named in the basis, the tool ordering, the approved-versus-denied permission split, that every cited event is one the file really carries at the line `errors` reports it, the stable key order of both output modes, byte-stability, and the terminal output shown in this README against what the command actually prints. The fix-suggest-model suite pins that every observation is anchored to a real event of the suggestion it restates and quotes that suggestion's own action verbatim, that the quoted events are exactly the cited ones with an event two rules cite quoted once, that the file path stays out unless `--send-paths` is given, that the events past `--max-excerpt` are named rather than dropped, that a suggestion whose evidence carries no id is restated rather than dropped, that the deterministic half stays byte for byte whatever the model half adds, that the no-model note never reaches a report built for a model call, that a failed attempt keeps the suggestions, and that a skipped call is recorded as a no-op rather than a failure. The CLI suite runs a real HTTP request against a local stub server to prove the fix-suggest request's payload, the findings, the no-key, bad-evidence and empty-answer exit codes, and that no request is made at all for a trace with nothing to suggest. The package suite pins the manifest: every runtime import of `src/` is declared in `dependencies` rather than `devDependencies`, the packed surface is exactly the compiled CLI, its entry script and the bundled schema, and that the decided command name ships as the `bin` entry while the manifest no longer declares itself private. The redact suite pins which keys are withheld and which are not, that the shape of a payload survives, that a value which only looks like a credential under a name that says nothing is still sent, that a subtree nested past the walk depth is withheld rather than walked, and that no bundled example carries a field the rule touches. The model suite also pins that every task statement and system prompt declares the quoted payloads to be data rather than instructions. The explain suite also pins that the excerpt loses the credential-looking values and counts them, that the count reaches both the report and the request, and that the loaded event keeps them. The injection suite builds a trace whose payloads are written to be obeyed and proves that no counter and no exit code moves when the prose is hostile rather than neutral or when unknown fields assert the opposite of what the declared ones say, that the request's instruction positions stay the compile-time constants whatever the payload says, and that an answer which does what the payload asked is still refused whole. |
| `package.json`, `tsconfig.json`, `.gitignore` | TypeScript / Node project skeleton. `files` pins the packed surface to `dist/src`, `bin/trace`, `schemas` and `CHANGELOG.md`; `ajv` and `ajv-formats` are runtime dependencies, and everything else under `devDependencies` is build- or test-only. |
| `LICENSE` | The Apache License, Version 2.0, in full, with the copyright line filled in. npm always carries it into a packed copy whatever `files` says. |
| `README.zh-CN.md` | The Chinese README. Same commands, same exit codes, same boundaries as this file, command for command. |
| `.github/workflows/ci.yml` | Continuous integration for the published tree: Node 20 and Node 22, each running the install, the type-check, the suite and the build, then two checks no test performs. It is live in this repository and has never been executed; while this package sat inside another repository it was inert there, because GitHub reads workflows only from the root of the repository it builds. |
| `RELEASE_NOTES.md` | The notes for `v0.1.0`: what has been measured, on which interpreter and on which date, and what has not. It records the release this tree ships in and what that release does not establish. |
| `ASSETS.md` | The asset manifest for the release-tree candidate: what the tree carries, measured rather than asserted -- file count and kinds, the two files that are not ASCII, zero binaries of any kind, every external URL in the text files with what each one is -- plus what is excluded, why, and which gates remain open. The tree it describes is the published tree of this repository, and it says so. |

Added in slice S1, the loader, the validator and the `validate` command:

| Path | What it is |
| ---|---|
| `src/loader.ts` | Reads a JSONL file, decodes it as strict UTF-8, and reports unreadable files, empty files, a byte order mark and non-JSON lines with their line number. |
| `src/schema.ts` | Compiles the bundled schema, or the schema passed with `--schema`. Refuses a schema in another dialect rather than mis-reading it. |
| `src/validate.ts` | Per-event schema errors plus the cross-line invariants, as one sorted report. |
| `src/report.ts` | Terminal text and `--json` rendering of that report. |
| `src/cli.ts` | Argument handling and exit codes. |
| `bin/trace` | Entry point. Requires `npm run build` first; `dist/` is generated, never committed. |

Added in slice S2, the analyzer and the two commands that read a trace instead of
checking it:

| Path | What it is |
|---|---|
| `src/analyze.ts` | `summarize` (one aggregate report) and `buildTimeline` (one row per event), plus the one-line description each event type renders as. Pure functions over loaded events: no clock, no file system, no network. |

Added in slice S3, the comparison of two traces:

| Path | What it is |
| ---|---|
| `src/diff.ts` | `diffTraces`: aligns two traces by event id and reports the run identity, the summary counters and the per-event field differences as one stable report. A pure function over loaded events, like the analyzer. |

Added in slice S5, the model layer and the command that may use it:

| Path | What it is |
| ---|---|
| `src/explain.ts` | `buildObservations`, `buildExcerpt`, `buildExplainDraft` and `withModelResult`: reduces a validated trace to evidence-bound observations, builds the minimal excerpt a model may be shown, and folds one model attempt into the report. Pure functions over loaded events, like the analyzer and the diff. |
| `src/model/types.ts` | The types of the model layer: what a finding is, what an attempt reports, and the exact shape of one request. |
| `src/model/contract.ts` | The task statement and the answer contract. The same contract object is sent to the model and compiled to check what comes back. |
| `src/model/config.ts` | Resolves the model name, endpoint, timeout and excerpt cap from flags and environment. No config file is read or written. |
| `src/model/openai.ts` | `OpenAICompatibleClient`, the one backend implemented: an OpenAI chat-completions dialect over `fetch`, one request, never a retry. It sends the task statement the request carries rather than choosing one, so the sentence a model is given exists in exactly one place. |
| `src/model/answer.ts` | Parses one answer, checks it against the contract, and rejects a finding that cites an event id which is not in the trace. |

Added in slice S6, the full view of one event:

| Path | What it is |
| ---|---|
| `src/show.ts` | `buildShow`: one event, or all of them, with its line number, model-round step, offset, type, the description `timeline` prints, and the payload as the recorder wrote it. |
| `annotateEvents` in `src/analyze.ts` | The position facts every per-event report needs. Extracted from `buildTimeline` so `timeline` and `show` cannot disagree about where an event sits. |

Added in slice S7, the per-tool view:

| Path | What it is |
| ---|---|
| `src/tools.ts` | `buildTools`: one row per tool, with its call, completion and failure counts, the guards that blocked it, the effects its completed calls left, and the lines and event ids where it appears, plus the tool set the run declared and which of it went unused. A pure function over loaded events, like the analyzer, the diff and `show`. |

Added in slice S8, the per-failure view:

| Path | What it is |
|---|---|
| `src/errors.ts` | `buildErrors`: every error class with its count, the event types that produced it and the lines and event ids where it appears, then every single occurrence with its event id, related event id, tool or model and message, plus any `related_event_id` that points at an event the file does not carry. A pure function over loaded events, like the analyzer, the diff, `show` and `tools`. |
| `readRunOutcome` in `src/analyze.ts` | Run status and terminal event id, extracted out of `summarize` so `errors` and `summary` cannot disagree about how a run ended. |
| `Distribution`, `byCountThenValue`, `distribution`, `bumpCount` in `src/analyze.ts` | The distribution primitives, moved out of `src/tools.ts` so `tools` and `errors` order their distributions by one rule instead of two. |

Added in slice S9, the comparison of two failure profiles:

| Path | What it is |
|---|---|
| `src/compare.ts` | `buildCompare`: the failure profile of two traces side by side, the run status and failure totals with their deltas, every error class and every failing tool with its counts in both traces. Each side is aggregated by `buildErrors` and `buildTools`, so no counter is recomputed and none can disagree with the command that owns it. A pure function over loaded events, like everything else that reads a trace. |
| `parseTwoFileArgs` in `src/cli.ts` | The two-file argument shape, shared by `diff` and `compare`: the same parsing, only the report differs. |

Added in slice S10, the model half of `compare`:

| Path | What it is |
| ---|---|
| `src/compareModel.ts` | `buildCompareObservations`, `buildCompareExcerpt`, `buildCompareDraft`, `withCompareModelResult`, `withSkippedModel` and `withoutModel`: restates what moved between two failure profiles as side-anchored observations, builds the minimal excerpt a model may be shown, and folds one attempt into the report. Pure functions over loaded events and an already-built `CompareReport`, like the rest. |
| `parseCompareArgs` in `src/cli.ts` | `compare`'s own argument parser: the two-file shape plus the model flags, which `diff` deliberately does not accept. |

Added in slice S11, the first command that writes a file:

| Path | What it is |
|---|---|
| `src/evalGen.ts` | `buildEvalGen` and `readInputSummary`: the failures of one trace restated as regression cases, one per error class, each carrying the occurrences it rests on. Built from the `errors` report rather than from the events again, so no counter in a case can disagree with the command that owns it. A pure function, like everything else that reads a trace. |
| `src/caseWriter.ts` | `caseFileName` and `writeCaseFile`: the one place this project writes a file. The name comes from the `run_id` but cannot escape the directory it was given, an existing file is never replaced unless `force` was asked for, and every failure comes back as a message the CLI can print. |
| `reportForWriteFailure` in `src/validate.ts` | The report shape for output that was produced and not delivered, kept apart from `reportForInputFailure` because the two want different things done about them. |
| `parseEvalGenArgs` in `src/cli.ts` | `eval-gen`'s own argument parser: the one-file shape plus the `--out` / `--force` pair, which no other command accepts. |

Added in slice S12, the model half of `eval-gen`:

| Path | What it is |
|---|---|
| `src/evalGenModel.ts` | `buildEvalGenDraft`: the model half of `eval-gen`, a pure function over the deterministic cases and the loaded events. Turns each case into one observation and quotes the events the case rests on rather than the whole file. `withoutEvalGenModel`, `withEvalGenModelResult` and `withEvalGenSkippedModel` attach an attempt to a report, or record that none was made. |
| `renderEvalGenModelText` / `renderEvalGenModelJson` in `src/report.ts` | The two renderings of `eval-gen --model`. The deterministic case blocks are shared with the no-model renderers so the two cannot drift. |

Added in slice S13, the deterministic half of the last planned command:

| Path | What it is |
|---|---|
| `src/fixSuggest.ts` | `buildFixSuggest`: the candidate directions one trace's own records point at, one suggestion per rule, each carrying the events it rests on and what it does not establish. Built from the `errors` report rather than from the events again, so no count in a suggestion can disagree with the command that owns it; the two rules that are not about failures read the events directly, with the same predicate the analyzer counts them by. A pure function, like everything else that reads a trace. |
| `parseFixSuggestArgs` in `src/cli.ts` | `fix-suggest`'s own argument parser: the one-file shape plus the model flags, and nothing else. No `--out`, because the command writes no file, so it stays an unknown option rather than being accepted and ignored. |

Added in slice S14, the model half of `fix-suggest`:

| Path | What it is |
|---|---|
| `src/fixSuggestModel.ts` | `buildFixSuggestDraft`: the model half of `fix-suggest`, a pure function over the deterministic report and the loaded events. Restates each suggestion as one observation quoting its own action verbatim, and builds the excerpt of exactly the events the suggestions cite. Adds no request when the trace produced no suggestion. |
| `renderFixSuggestModelText` / `renderFixSuggestModelJson` in `src/report.ts` | The two renderings of `fix-suggest --model`. The deterministic header and suggestion blocks are shared with the no-model renderers so the two cannot drift. |

Added in slice S4, the mini agent spike and the schema revisions it forced. The spike
is a development tool and is not part of the published CLI.

| Path | What it is |
| ---|---|
| `spike/SCHEMA_REVIEW.md` | What the first real trace could not express, what changed because of it, and what is still unexercised. Read this before changing the schema. |
| `spike/recorder.ts` | `TraceRecorder`: assigns event ids, keeps timestamps non-decreasing, holds one run id, and is the only module that knows the wire shape of an event. The clock and the line writer are injected. |
| `spike/model.ts` | `ModelProvider`, the seam a real model plugs into, plus `ScriptedModel`, a deterministic replay of a fixed plan. No network, no API key, no cost. |
| `spike/tools.ts` | A sandboxed tool set (`list_dir`, `read_file`, `write_file`, and a deliberately unavailable `fetch_url`). Each tool declares its effect disposition once; the sandbox refuses path escapes as `path_escape`. |
| `spike/agent.ts` | The five-step loop: records before and after every side effect, asks for permission before a write, and answers unknown and withheld tools instead of dying. |
| `spike/cli.ts`, `bin/spike-run` | `spike-run --out FILE`, which runs the loop, writes the trace and validates it with this tool's own validator before reporting success. |

Added in slice S17, the request boundary of the model layer:

| Path | What it is |
|---|---|
| `src/model/redact.ts` | `redactPayload` and `isSecretKey`: withholds credential-looking values from a payload before it is quoted, by key name rather than by value shape, and counts what it replaced. Caps the walk depth too, because `JSON.parse` accepts nesting deeper than a recursive walk survives. |
| The untrusted-data statements in `src/model/contract.ts` | Every task statement and system prompt now says the quoted payloads are data a run recorded, not instructions, and that text inside one which reads like an instruction is content to report. Pinned by `tests/model.test.ts`; the behavioural half is in `tests/injection.test.ts`. |
| `tests/redact.test.ts` | The rule, its documented limit, the depth cap, and the fact that no bundled example touches it. |

Added in slice S18, the injection-resistance suite:

| Path | What it is |
|---|---|
| `tests/injection.test.ts` | Builds a trace whose payloads are written to be obeyed and proves three things about it: that no counter and no exit code moves when the prose is hostile rather than neutral, or when unknown fields assert the opposite of what the declared ones say; that the request's instruction positions stay the compile-time constants whatever the payload says; and that an answer which does what the payload asked is still refused whole. |

The first three examples are synthetic. They contain no real session data, no private
paths, and no model output. `examples/spike-run.jsonl` is the exception: it is the
output of a real run of the mini agent spike against a throwaway sandbox. It
contains no session data from any real user and no model output, because its model is
a scripted replay.

## Trace format

A trace file is JSONL: UTF-8, one JSON object per line, one event per line.

Base fields, required on every event:

| Field | Type | Notes |
| ---|---|---|
| `schema_version` | string, const `"1"` | Only `1` is accepted. |
| `event_id` | string, `^evt_[0-9]{6}$` | Generated by the recorder, unique within one file. Not read from any upstream system. |
| `timestamp` | string, RFC 3339 | Must not decrease within a file (checked by the validator, not expressible in the schema). |
| `type` | string enum | Selects the payload contract. Fourteen values, listed below. |
| `run_id` | string | Groups the events of one run. Version `1` files carry exactly one `run_id`. |
| `payload` | object | Type-specific fields. Required for every event type. |

Unknown top-level fields are rejected. Unknown fields inside `payload` are allowed so
recorders can extend without a schema bump; known fields keep their types.

### Event types and payload contracts

| Type | Required payload fields | Optional payload fields |
| ---|---|---|
| `run.started` | `input_summary` | `config_summary` |
| `run.finished` | `status` (`"completed"`) | `output_summary` |
| `run.failed` | `status` (`"failed"`), `error` | `output_summary` |
| `run.cancelled` | `status` (`"cancelled"`) | `reason` |
| `model.request.started` | `model` | `messages`, `role`, `slot_label` |
| `model.response.completed` | `model`, `usage`, `duration_ms` | `finish_reason`, `role`, `slot_label`, `streamed`, `capture`, `output_summary` |
| `model.response.failed` | `model`, `error` | `duration_ms` |
| `tool.call.started` | `tool` | `tool_call_id`, `args_summary` |
| `tool.call.completed` | `tool`, `status` (`"completed"`), `duration_ms` | `result_bytes`, `result_truncated`, `effect_disposition` |
| `tool.call.failed` | `tool`, `status` (`"failed"`), `error`, `duration_ms` | `guard`, `guardrail_refusal`, `result_bytes` |
| `permission.requested` | `action` | `resource`, `tool` |
| `permission.resolved` | `decision` (`"approved"` \| `"denied"`) | `decided_by` |
| `context.compacted` | `strategy` | `before_messages`, `after_messages`, `before_tokens`, `after_tokens` |
| `error.recorded` | `error` | `fatal`, `related_event_id` |

Shared shapes: `error` is `{type, message}` with both fields required and no extras.
`usage` requires `input_tokens` and `output_tokens` and optionally carries
`cache_read_tokens`, `cache_write_tokens` and `reasoning_tokens`.

`config_summary` on `run.started` is an open object for run configuration. The keys
this project writes are `model`, `max_steps` and `tools`, where each entry of `tools`
is `{name, schema_hash, available}`. `available: false` records a tool that existed
but was withheld from the model, which is the only way a trace can explain why a tool
was never called. Tool schemas are hashed rather than inlined.

Two payload fields deserve a note because they come from reading how a real agent
implementation records tool outcomes:

- `guard` (`tool.call.failed`) says *why* a call was blocked before it did its work
  (`loop_block` for a repeated-call circuit breaker, `denylist` for a blocked path,
  `path_escape` for a path outside the recorder's sandbox, and so on). The first
  seven values come from reverse-engineering a comparable agent implementation;
  `path_escape` was added by the mini agent spike, whose sandbox produces exactly
  that class. Absent means the call ran and failed on its own terms.
- `guardrail_refusal` (`tool.call.failed`) marks a refusal as a deliberate block.
  Consumers must not count refusals as tool errors, otherwise a circuit breaker feeds
  on its own refusals. `examples/failed.jsonl` contains one refusal and two real
  failures so the distinction is testable.

Three more fields were added after a real five-step run exposed that the trace could
not answer questions a reader would obviously ask. The reasoning for each is in
`spike/SCHEMA_REVIEW.md`.

- `effect_disposition` (`tool.call.completed`) is `none` for a read-only call,
  `applied` when the call completed and its side effect is in place, and `unknown`
  when the call did not complete cleanly so a side effect may or may not be there.
  Absent means the recorder did not classify its tools.
- `capture` (`model.response.completed`) says where the response body lives: `inline`
  (a summary is in this event), `inline_from_stream`, or `db_ref`. Absent means the
  recorder kept no body, which is also the correct reading for a turn that only called
  tools and produced no text.
- `role` and `slot_label` (`model.request.started` and `model.response.completed`)
  identify which model slot a turn belongs to: `main`, `reference` or `aggregator`,
  plus a free label. Single-model runs record `main`. `streamed` reports whether the
  response arrived incrementally.

Truncation is always explicit: `result_truncated: true` plus `result_bytes`. A
recorder must never silently drop result content. `result_bytes` is the size of the
full result body the tool produced, before truncation: it measures the result, not the
thing the tool acted on, so a write tool reports the size of its confirmation rather
than of the bytes it wrote.

## Commands

### `trace validate FILE`

Checks one JSONL trace file and reports every problem it finds:

```bash
npm run build
./bin/trace validate examples/success.jsonl
./bin/trace validate examples/failed.jsonl --json
./bin/trace validate artifacts/run.jsonl --schema schemas/trace.schema.json
```

Terminal output for a file with one bad line:

```text
error: line 1 (evt_000001) /payload/input_summary: must have required property 'input_summary'
invalid: 1 error in examples/broken.jsonl
```

`--json` prints the same report as JSON with stable keys, in this order:
`command`, `file`, `schema`, `events`, `valid`, `errors`. Every entry of `errors` carries
`line`, `event_id`, `check`, `path`, `keyword` and `message`, always in that order, so
the same input always produces the same bytes. `line` and `event_id` are `null` when the
failure is not tied to a line; `path` is empty for the same reason.

Three kinds of `check` appear:

| `check` | Meaning |
| ---|---|
| `schema` | The event does not satisfy the schema. `keyword` is the JSON Schema keyword that failed. |
| `duplicate_event_id`, `timestamp_order`, `single_run_id` | A cross-line invariant broke. `keyword` is `null`. |
| `load` | The file could not be read at all, so no event was validated. |

Exit codes:

| Code | Meaning |
| ---: | --- |
| `0` | Every event validates. |
| `1` | Validation failed: schema errors or broken invariants. This code also means the command found a difference: `diff` when the two traces differ, `compare` when the two failure profiles differ, and for `show`, that `--event` named an event id the file does not carry. |
| `2` | The trace file or the schema file could not be read: missing file, bad permissions, invalid UTF-8, a byte order mark, a non-JSON line, or an empty file. |
| `3` | The report could not be written, for example when the output pipe closed early. |
| `64` | The command line could not be understood. |

`summary`, `timeline`, `show`, `tools`, `errors`, `diff` and `compare` use the same five
codes with the same meanings. The four commands that take `--model` -- `compare`,
`explain`, `eval-gen` and `fix-suggest` -- add `65` and `69` for the two ways a model
answer can fail, and only their `--model` forms can produce them.

The schema is loaded before the trace file, so a broken `--schema` is reported even when
the trace file is missing too.

### `trace summary FILE`

Aggregates one trace file: run status, duration, event counts, model call counts, tool
call counts, permission decisions, recorded errors and token totals. The file is
validated first, so a trace with a schema error or a broken invariant is reported with
the same errors `validate` prints and exits `1` rather than being summarized.

```bash
./bin/trace summary examples/failed.jsonl
./bin/trace summary examples/failed.jsonl --json
```

Terminal output for `examples/failed.jsonl`:

```text
file                       examples/failed.jsonl
schema                     bundled
run_id                     run_02
status                     failed
terminal event             evt_000026
started at                 2026-10-14T11:00:00.000Z
ended at                   2026-10-14T11:00:05.730Z
duration                   5730 ms
events                     26
models                     stub-model-1
model requests             4
model responses completed  3
model responses failed     1
tool calls                 7
tool calls completed       4
tool calls failed          3
guardrail refusals         1
permissions requested      0
permissions approved       0
permissions denied         0
context compactions        0
errors recorded            2
fatal errors               0
tokens input               13680
tokens output              348
tokens cache read          4096
tokens cache write         0
tokens reasoning           0
```

`--json` prints the same fields as JSON with stable keys, in this order: `command`,
`file`, `schema`, `run_id`, `status`, `terminal_event_id`, `started_at`, `ended_at`,
`duration_ms`, `events`, `models`, `model_requests`, `model_responses_completed`,
`model_responses_failed`, `tool_calls`, `tool_calls_completed`, `tool_calls_failed`,
`tool_guardrail_refusals`, `permissions_requested`, `permissions_approved`,
`permissions_denied`, `context_compactions`, `errors_recorded`, `errors_fatal`,
`tokens`. Inside `tokens`: `input`, `output`, `cache_read`, `cache_write`, `reasoning`.

Reading the counters:

- `status` is what the last `run.finished` / `run.failed` / `run.cancelled` event
  recorded. `incomplete` means the file has no terminal event at all.
- `duration_ms` is the last event timestamp minus the first, so it is the wall-clock
  span the recorder covered, not the sum of the per-event durations.
- Counters are plain tallies. A trace that records the same thing twice counts twice;
  nothing is inferred or de-duplicated.
- `guardrail refusals` counts `tool.call.failed` events carrying
  `guardrail_refusal: true` and is also included in `tool calls failed`. A refusal is
  a deliberate block, not a tool error, so read the two numbers together.
- Token counters are the values the recorder reported, summed as-is. Whether a cache
  read already sits inside `input_tokens` is a provider question; this tool does not
  answer it, and does not compute a grand total.
- Token counters come from `model.response.completed` events only. A failed response
  contributes nothing, because it reports no usage.

### `trace timeline FILE`

Lists one line per event, in file order, each with its line number, event id, offset
from the first event and a one-line description. The file is validated first, for the
same reason `summary` validates it.

```bash
./bin/trace timeline examples/cancelled.jsonl
./bin/trace timeline examples/cancelled.jsonl --json
```

Terminal output for `examples/cancelled.jsonl`:

```text
step  offset_ms  line  event_id    type                      summary
   1          0     1  evt_000001  run.started               run started: Clean the build directory
   1        150     2  evt_000002  model.request.started     model request: stub-model-1; 2 messages
   1       1000     3  evt_000003  model.response.completed  model response: stub-model-1; 850 ms; 1180 input / 58 output tokens; tool_calls
   1       1010     4  evt_000004  tool.call.started         tool call: read_file; call_001; path=README.md
   1       1260     5  evt_000005  tool.call.completed       tool result: read_file; 250 ms; 1024 bytes
   1       1270     6  evt_000006  permission.requested      permission requested: run_command; rm -rf build/; tool run_command
   1       1800     7  evt_000007  permission.resolved       permission resolved: denied; by user
   1       1810     8  evt_000008  run.cancelled             run cancelled: cancelled; user denied permission for run_command
```

`--json` prints `command`, `file`, `schema`, `run_id`, `steps`, `events`, and per entry
`index`, `step`, `line`, `event_id`, `timestamp`, `offset_ms`, `duration_ms`, `type`,
`summary`, always in that order.

Reading the columns:

- `step` counts model rounds. It advances on every `model.request.started`, so the
  events between two model requests share a step: that is which round asked for which
  tool call.
- `offset_ms` is relative to the first event in the file. The absolute timestamp is in
  the JSON report.
- `line` is the 1-based line in the file, so a row can always be traced back to the
  bytes on disk. It differs from `index` when the file has blank lines.
- `duration_ms` is the event's own duration when the recorder wrote one, and `null`
  otherwise.
- The description prints only the fields the recorder actually wrote. A missing
  optional field never shows up as `undefined` or `null`.
- Text columns are padded to the widest cell in the report, never to the terminal, so
  a narrow window never wraps the table and a wide one never reflows it.

### `trace show FILE [--event ID]`

Prints one event in full, or every event when `--event` is omitted: where the event sits
in the file, which model round it belongs to, how far into the run it happened, its type,
the same one-line description `timeline` prints, and its payload. The file is validated
first, for the same reason every other command validates first.

```bash
./bin/trace show examples/failed.jsonl --event evt_000013
./bin/trace show examples/failed.jsonl --event evt_000013 --json
./bin/trace show examples/cancelled.jsonl --json
```

Terminal output for one event of `examples/failed.jsonl`:

```text
file      examples/failed.jsonl
schema    bundled
run_id    run_02
events    26
selected  1 of 26 events: evt_000013

event    evt_000013
line     13
step     1
offset   2370 ms
type     tool.call.failed
summary  tool failed: read_file; 10 ms; guard loop_block; guardrail refusal; guardrail_refusal: repeated read of notes/a.md blocked after 4 attempts
payload
  tool               read_file
  status             failed
  error              {"type":"guardrail_refusal","message":"repeated read of notes/a.md blocked after 4 attempts"}
  duration_ms        10
  guard              loop_block
  guardrail_refusal  true
```

`--json` prints the same report as JSON with stable keys, in this order: `command`,
`file`, `schema`, `run_id`, `events`, `selected`. Each entry of `selected` carries
`index`, `step`, `line`, `event_id`, `timestamp`, `offset_ms`, `duration_ms`, `type`,
`summary`, `payload`, always in that order. `events` counts the file, not the selection,
so a report of one event still says how long the run was.

Reading the report:

- `line` is the 1-based line in the file, and `index` the event's position among them;
  the two differ when the file has blank lines.
- `step`, `offset_ms` and `summary` are the same values `timeline` prints for the same
  event, computed by the same code, so the two commands cannot describe one event two
  different ways.
- `payload` is printed exactly as the recorder wrote it, key order included. `show` is
  the command used to check what a line on disk actually says, so re-ordering the keys
  would defeat the point. In terminal text a nested object is compact JSON on one line
  and a JSON `null` prints as `null`; in `--json` the payload is the parsed object.
- Without `--event` every event is selected, which is what `timeline` carries plus the
  payload. The header always states both numbers, because "every event" and "one event"
  read the same on a one-event file, and names the id when exactly one was selected so
  the reader can see the request was honoured.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation or
when `--event` names an event id the file does not carry, `2` when the trace file or the
schema could not be read, `3` when the report could not be written, `64` when the command
line could not be understood.

### `trace tools FILE`

Aggregates one trace file by tool: how often each tool was called, how each call ended,
which guards blocked the failed ones, and which effects the completed ones left. Also
reports the tool set the run declared and which of it was never invoked. The file is
validated first, for the same reason every other command validates first.

```bash
./bin/trace tools examples/failed.jsonl
./bin/trace tools examples/spike-run.jsonl --json
```

Terminal output for `examples/failed.jsonl`:

```text
file        examples/failed.jsonl
schema      bundled
run_id      run_02
events      26
tool calls  7

tool         calls  completed  failed  unresolved  refusals  guards         effects  first  last
read_file        5          3       2           0         1  loop_block x1  -            6    15
list_files       1          1       0           0         0  -              -            4     5
run_command      1          0       1           0         0  -              -           21    22

declared tools
  (none declared)

unused      none
undeclared  none
```

`--json` prints the same report as JSON with stable keys, in this order: `command`,
`file`, `schema`, `run_id`, `events`, `tool_calls`, `tools`, `declared`, `undeclared`,
`unused`. Each entry of `tools` carries `tool`, `calls`, `completed`, `failed`,
`unresolved`, `guardrail_refusals`, `guards`, `effects`, `first_line`, `last_line`,
`first_event_id`, `last_event_id`, always in that order. Each entry of `guards` and
`effects` carries `value` and `count`.

Reading the report:

- `calls` counts `tool.call.started` events, `completed` counts `tool.call.completed`
  and `failed` counts `tool.call.failed`. Counters are plain tallies of event types, so
  a trace that records the same call twice counts twice.
- `unresolved` is `calls - completed - failed`, arithmetic rather than a pairing of
  events: a completed tool call does not carry the `tool_call_id` of the start it
  answers, so the two cannot be matched line by line. A negative value means the trace
  records more resolutions than starts.
- `guards` and `effects` carry only the values the recorder actually wrote. A run whose
  recorder never classified effects reports no effects, printed as `-`, rather than a
  default that would read like a claim. Both are ordered most frequent first, then by
  value, so two runs with the same counts print in the same order.
- Rows are ordered by `calls` descending, then by tool name, so the tool a reader came
  to ask about is at the top.
- `first` and `last` are the first and last line in the file where the tool appears, and
  `first_event_id` / `last_event_id` the event ids on those lines, so any row can be
  followed back to the events that produced it with `show`.
- `declared` is the tool set `run.started` declared, in the order it was declared, with
  its `available` flag and `schema_hash`. It is empty when the recorder declared none,
  printed as `(none declared)`.
- `unused` lists declared tools that were never invoked. `undeclared` lists tools that
  were invoked without being declared, and stays empty when the recorder declared no
  tool set, because with nothing declared no call can be called undeclared.
- A trace with no tool calls at all is not an error: it prints `(no tool calls)` and a
  report with an empty `tools` list, because a run where the model never reached for a
  tool is a real answer.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation,
`2` when the trace file or the schema could not be read, `3` when the report could not
be written, `64` when the command line could not be understood.

### `trace errors FILE`

Aggregates one trace file by failure: every error class, how often it occurred, which
event types produced it and on which lines, and then every single occurrence with its
event id, its related event id and its message. The file is validated first, for the
same reason every other command validates first.

```bash
./bin/trace errors examples/failed.jsonl
./bin/trace errors examples/failed.jsonl --json
```

Terminal output for `examples/failed.jsonl`:

```text
file      examples/failed.jsonl
schema    bundled
run_id    run_02
status    failed
events    26
failures  7
errors    6
refusals  1
fatal     0

type               count  fatal  refusals  sources                   first  last
tool_error             2      0         0  error.recorded x2            16    23
command_failed         1      0         0  tool.call.failed x1          22    22
file_not_found         1      0         0  tool.call.failed x1          15    15
guardrail_refusal      1      0         1  tool.call.failed x1          13    13
rate_limited           1      0         0  model.response.failed x1     18    18
task_failed            1      0         0  run.failed x1                26    26

occurrences
  line  event_id    event                  type               flags    related     context       message
    13  evt_000013  tool.call.failed       guardrail_refusal  refusal  -           read_file     repeated read of notes/a.md blocked after 4 attempts
    15  evt_000015  tool.call.failed       file_not_found     -        -           read_file     notes/missing.md does not exist
    16  evt_000016  error.recorded         tool_error         -        evt_000015  -             read_file failed: file_not_found
    18  evt_000018  model.response.failed  rate_limited       -        -           stub-model-1  upstream returned HTTP 429
    22  evt_000022  tool.call.failed       command_failed     -        -           run_command   exit code 1: cat: notes/missing.md: No such file or directory
    23  evt_000023  error.recorded         tool_error         -        evt_000022  -             run_command failed: command_failed
    26  evt_000026  run.failed             task_failed        -        -           -             report.md was not produced; last failure: command_failed (evt_000022)

dangling  none
```

`--json` prints the same report as JSON with stable keys, in this order: `command`,
`file`, `schema`, `run_id`, `status`, `events`, `failures`, `errors`, `refusals`,
`fatal`, `classes`, `occurrences`, `dangling_references`. Each entry of `classes`
carries `type`, `count`, `fatal`, `refusals`, `sources`, `first_line`, `last_line`,
`first_event_id`, `last_event_id`, always in that order. Each entry of `occurrences`
carries `line`, `event_id`, `event`, `type`, `message`, `fatal`,
`guardrail_refusal`, `related_event_id`, `tool`, `model`, always in that order. Each
entry of `sources` carries `value` and `count`.

Reading the report:

- Four event types carry a structured `error` and are counted: `error.recorded`,
  `tool.call.failed`, `model.response.failed` and `run.failed`. `run.cancelled` is not
  one of them, because it records a `reason` rather than an error. A run an operator
  stopped is not a run that failed, and putting the two in one list would rank a
  deliberate stop next to a crash.
- `failures` is every failure event, `errors` and `refusals` together. The two are
  reported apart because the schema says a guardrail refusal must not be counted as a
  tool error: the call was blocked on purpose rather than breaking. Summing them would
  rank a designed block above a real crash. Both the class table and the occurrence
  list total `failures`, so the header and the tables reconcile.
- `fatal` counts `error.recorded` events that said `fatal: true`. On the other three
  event types the field is reported as `null`, not `false`, because they have no such
  field and `false` would read as "the recorder said this was not fatal" when it said
  nothing of the kind.
- `sources` says which event types produced a class, most frequent first. A class that
  arrives from both `error.recorded` and `tool.call.failed` is a recorder that reports
  the same failure twice, and the split makes that visible.
- `first` and `last` are the first and last line in the file where the class appears,
  and `first_event_id` / `last_event_id` the event ids on those lines, so any row can
  be followed back with `show`.
- Occurrences are listed in file order, one per failure event. Counters are plain
  tallies of event types, so a trace that records the same failure twice counts twice.
- The terminal folds `tool` and `model` into one `context` column; the JSON report
  keeps them apart, because a caller filtering on one of them should not have to guess
  which one a shared column meant. The neighbouring `event` column says which kind of
  event a row is, so the folded cell is never ambiguous on screen.
- `dangling` names every `related_event_id` that points at an event the file does not
  carry, as `event_id -> referenced`. The whole file is read before the check, so a
  reference that points forwards is accepted. `validate` does not check this: it
  validates one line at a time plus the invariants it owns, and a broken cross-event
  link is a failure-triage question rather than a schema question.
- The header leads with `status`, so a report that says zero errors on a run that was
  cancelled does not read as an all-clear.
- A trace with no failures at all is not an error: it prints `(no errors)` and empty
  `classes` and `occurrences` lists, and still exits `0`, because a readable trace is
  a successful report.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation,
`2` when the trace file or the schema could not be read, `3` when the report could not
be written, `64` when the command line could not be understood. A trace full of
failures is still a readable trace, so finding errors does not change the exit code.

### `trace eval-gen FILE [--out DIR] [--force]`

Turns the failures of one trace file into regression cases: one case per error class,
each carrying every occurrence it rests on with its line number and event id, so an
assertion can be followed back to the event that justifies it. The file is validated
first, for the same reason every other command validates first: a case file generated
from a trace that could not be read would look exactly as solid as one generated from a
good trace, and it would be the thing a later run is measured against.

```bash
./bin/trace eval-gen examples/failed.jsonl
./bin/trace eval-gen examples/failed.jsonl --json
./bin/trace eval-gen examples/failed.jsonl --out ./evals
```

Terminal output for `examples/failed.jsonl`:

```text
file      examples/failed.jsonl
schema    bundled
run_id    run_02
status    failed
input     Summarize the files in notes/ and write report.md
events    26
failures  7
errors    6
refusals  1
cases     5

case      error_type      count  fatal  tools        sources                   first  last  evidence
case_001  tool_error          2      0  -            error.recorded x2            16    23  16:evt_000016, 23:evt_000023
case_002  command_failed      1      0  run_command  tool.call.failed x1          22    22  22:evt_000022
case_003  file_not_found      1      0  read_file    tool.call.failed x1          15    15  15:evt_000015
case_004  rate_limited        1      0  -            model.response.failed x1     18    18  18:evt_000018
case_005  task_failed         1      0  -            run.failed x1                26    26  26:evt_000026

skipped refusals  guardrail_refusal
```

`--json` prints the same report as JSON with stable keys, in this order: `command`,
`file`, `schema`, `run_id`, `status`, `input_summary`, `events`, `failures`, `errors`,
`refusals`, `cases`, `skipped_refusals`. Each entry of `cases` carries `case_id`,
`error_type`, `expectation`, `count`, `fatal`, `sources`, `tools`, `first_line`,
`last_line`, `first_event_id`, `last_event_id`, `occurrences`, always in that order,
and each entry of `occurrences` is exactly the occurrence `trace errors` reports for
the same event, field for field.

Reading the report:

- One case per error class, in the class order `trace errors` uses, so the dominant
  failure comes first and two runs with the same classes print in the same order.
  `case_001` here is `tool_error` because it occurred twice; the rest occurred once.
- `expectation` is the assertion in words, and it is about the class alone. Which tools
  carried it is in `tools`, and an assertion that named them would read as one claim
  while being two: the same class on a different tool is a different failure.
- `evidence` is the line and event id of each occurrence the case carries, in file
  order. The messages, the payload flags and the related event ids stay in the JSON and
  in the written file, where a reader reconciling a case against `trace errors` needs
  them; `trace show --event ID` prints any one of them in full.
- A case's `count` describes the occurrences that case carries, which for a class that
  had both real failures and refusals is lower than the same class's count in
  `trace errors`. The two are meant to be reconcilable rather than identical, and
  `sum(count) + refusals` is `failures` on every trace.
- Guardrail refusals produce no case. A refusal is the guard doing its job, so an
  assertion that the run must not refuse would ask for the guard to be removed. A class
  whose every occurrence was a refusal is named under `skipped refusals` instead of
  being dropped, so a reader looking for a class `trace errors` reported can see it was
  seen here and left alone on purpose.
- `input` is the run's own `input_summary` as the recorder wrote it, and `status` is how
  the run ended. A case file that said nothing about either could not be rerun against
  anything.
- A run with no failures produces no cases, which is a normal answer and not an error:
  it prints `(no cases)` and still exits `0`.

Nothing is written unless `--out` names a directory. Without it the report goes to
stdout and the file system is left alone, which makes the plain command a dry run of
the same thing `--out` does. With `--out` the cases are written to one JSON file named
after the run id, in a directory that is created if it is missing, and the same bytes
are printed to stdout, so `trace eval-gen FILE --json` and the file it would write can
be compared directly.

An existing file is never replaced unless `--force` is given. A case file is the record
of a run that already happened, and silently overwriting it would lose the only
evidence the earlier run left. The file name is derived from the `run_id`, which is
recorder data rather than a path component: characters outside `A-Za-z0-9._-` are
replaced, so a run id cannot name a directory above `--out` or a file outside it, and a
run id that produces nothing usable falls back to `trace.json`.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation,
`2` when the trace file or the schema could not be read, `3` when the cases were
produced but could not be written, `64` when the command line could not be understood.
A trace full of failures is still a readable trace, so finding failures does not change
the exit code.

### `trace eval-gen FILE [--out DIR] [--force] --model`

The same cases, with a model reading them against the events they cite. `--model` is the
only thing in this command that opens a network connection; without it nothing leaves the
machine and the same file always produces the same bytes.

```bash
./bin/trace eval-gen examples/failed.jsonl --model --model-name NAME
```

Terminal output for `examples/failed.jsonl`, with a local stub standing in for a real
provider:

```text
file      examples/failed.jsonl
schema    bundled
run_id    run_02
status    failed
input     Summarize the files in notes/ and write report.md
events    26
failures  7
errors    6
refusals  1
cases     5

case      error_type      count  fatal  tools        sources                   first  last  evidence
case_001  tool_error          2      0  -            error.recorded x2            16    23  16:evt_000016, 23:evt_000023
case_002  command_failed      1      0  run_command  tool.call.failed x1          22    22  22:evt_000022
case_003  file_not_found      1      0  read_file    tool.call.failed x1          15    15  15:evt_000015
case_004  rate_limited        1      0  -            model.response.failed x1     18    18  18:evt_000018
case_005  task_failed         1      0  -            run.failed x1                26    26  26:evt_000026

skipped refusals  guardrail_refusal

findings
  find_1  warning  confidence medium  evidence evt_000016, evt_000023
      claim      case_001 covers two occurrences whose messages name different tools, so one assertion stands for two different failures
      suggestion split tool_error per tool, or narrow the expectation to the shared failure
  find_2  info  confidence low  evidence evt_000015, evt_000022
      claim      both remaining tool failures trace back to the same missing file, so the cases overlap
      suggestion consider one case for the missing path instead of one per class

unverified
  - a case asserts that an error class does not recur; it does not establish why the class happened
  - a case carries the occurrences this trace recorded, so a rerun that fails in a different shape of the same class is not covered by it
  - guardrail refusals produce no case, so 1 refused call is not part of what a model reviews

model
ok               true
provider         openai-compatible
model            stub-model
requests         1
events sent      6
bytes sent       7389
redacted fields  0
error            none
  - the quoted events do not say whether the two tool_error occurrences were the same mistake
```

What is sent, and only this: the eval-gen task statement, the answer contract, five
observations and six quoted events. Each observation restates one case — its id, the
expectation verbatim, the occurrence and fatal counts, the event types and tools that
produced it, and the line and event id of its first and last occurrence — and is anchored
to the case's first anchored occurrence. Each quoted event is one the cases cite, in file
order. The file path is left out unless `--send-paths` is typed. A quoted event's payload is sent with every credential-looking value replaced by `[redacted]`, and the model section counts them under `redacted fields`.

The model reviews the cases; it does not write them. It is told not to rewrite an
expectation and not to propose a case the trace does not support, and a case whose
occurrences do not share one failure is a finding rather than a correction. That boundary
is the reason `--out` still writes the deterministic report under `--model`: a case file is
the record of a run that already happened, and has to be the same bytes for the same trace
no matter which model answered. The stdout report carries the findings and the file does
not, so the difference between the two is exactly the model's contribution.

No request is made when the trace produced no case. A clean run has nothing to review, and
asking a model to review nothing would invite it to invent a failure. The model section
says so with `requests 0`, the exit code stays the deterministic one, and `explain --model`
is the command that asks about the run itself.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation, `2`
when the trace file or the schema could not be read, `3` when the cases were produced but
could not be written, `64` when the command line could not be understood, `65` when the
model answered but its answer could not be used, and `69` when no usable answer was
obtained. When `--model` is used and the model half fails, `65` or `69` replaces the code
the deterministic half would have returned, because a caller must not read `0` as "the
cases are fine" when the model was never heard from.

### `trace fix-suggest FILE`

Names the directions one trace file's own records point at. Where `errors` says what went
wrong and `eval-gen` says what a rerun has to avoid, this says where to look next: one
suggestion per rule, each citing the events it was derived from and stating beside itself
what it does not establish. The file is validated first, for the same reason every other
command validates first.

```bash
./bin/trace fix-suggest examples/failed.jsonl
./bin/trace fix-suggest examples/cancelled.jsonl
./bin/trace fix-suggest examples/failed.jsonl --json
```

Terminal output for `examples/failed.jsonl`:

```text
file         examples/failed.jsonl
schema       bundled
run_id       run_02
status       failed
input        Summarize the files in notes/ and write report.md
events       26
failures     7
errors       6
refusals     1
suggestions  4

  sug_001  repeated_error_class  tool_error x2
      title  the error class tool_error was recorded 2 times
      action look for one shared cause across the 2 occurrences of tool_error before treating them as separate failures
      basis  class tool_error occurred 2 times (0 fatal) from error.recorded x2
      limit  repetition does not establish a shared cause; the occurrences may be independent
      evidence  16:evt_000016, 23:evt_000023

  sug_002  tool_failure  read_file x1
      title  the tool read_file failed 1 time
      action inspect what read_file was asked and what came back on each failed call
      basis  read_file has 1 failed call in this trace, plus 1 refused call reported apart
      limit  the trace records that the call failed, not whether the tool, its input or its environment was at fault
      evidence  15:evt_000015

  sug_003  tool_failure  run_command x1
      title  the tool run_command failed 1 time
      action inspect what run_command was asked and what came back on each failed call
      basis  run_command has 1 failed call in this trace
      limit  the trace records that the call failed, not whether the tool, its input or its environment was at fault
      evidence  22:evt_000022

  sug_004  guardrail_refusals  the run x1
      title  1 call was refused by a guard
      action review the guard policy and the requests that tripped it; a refused call was blocked on purpose, so the direction is a policy or request change rather than a retry
      basis  the file records 1 guardrail refusal
      limit  a refusal is not a failure; whether the guard was right is not recorded
      evidence  13:evt_000013

findings
  none

unverified
  - a suggestion names a direction to look, derived from a pattern in this trace; it is not a verified cause, and none of them were executed
  - what each suggestion does not establish is stated beside it, under does_not_establish
  - a suggestion covers the events this trace recorded, so a direction about a shape of failure this run did not hit is not among them
  - guardrail refusals are a separate suggestion from failures, so 1 refused call is reviewed as a policy question rather than a broken call
  - no model was called, so these suggestions are only what the trace records

model
  disabled
```

`--json` prints the same report as JSON with stable keys, in this order: `command`, `file`,
`schema`, `run_id`, `status`, `input_summary`, `events`, `failures`, `errors`, `refusals`,
`suggestions`, `unverified`, `findings`, `model`. Each entry of `suggestions` carries
`suggestion_id`, `rule`,
`title`, `action`, `error_type`, `tool`, `count`, `fatal`, `first_line`, `last_line`,
`first_event_id`, `last_event_id`, `evidence`, `basis`, `does_not_establish`, always in
that order, and each entry of `evidence` carries the line, the event id, the event type,
what that event contributes and the `fatal` flag where the event type has one.

Reading the report:

- Seven rules, fired in the order a reader asks the questions in: is this trace complete
  and self-consistent, then what failed, then what was blocked on purpose.
  `incomplete_run` and `dangling_reference` come first because a reader who acts on the
  failure suggestions of a truncated file has been misled by the ordering, not by the
  content. `fatal_failure`, `repeated_error_class` and `tool_failure` follow, then
  `permission_denied` and `guardrail_refusals`.
- Every count is read off the evidence listed beside it, and the evidence comes from the
  `errors` report rather than from the events again, so a suggestion can never disagree
  with `trace errors` about the same event. `count` is the number of events the
  suggestion rests on and `fatal` is how many of those were recorded fatal.
- `repeated_error_class` fires from two or more occurrences of one class, and
  `fatal_failure` from one or more fatal ones. A class that qualifies for both produces
  two suggestions over different sets: the fatal occurrences alone, then all of them,
  which is why the counts differ.
- A refused call is never part of a failure count. `tool_failure` counts the calls that
  broke and names the refused ones in its basis, because a blocked call is the guard
  doing its job; `guardrail_refusals` is its own suggestion and asks for a policy review
  rather than a fix.
- `permission_denied` reads the permission decisions rather than the errors, because a
  denial is not an error: a tool that was never allowed to run cannot have succeeded, and
  the cancelled example above is exactly that shape -- a run with no failure at all and
  one denied permission in it.
- `action` is a direction to take with the file open, not a promised fix, and
  `does_not_establish` says what the suggestion cannot claim. `repetition does not
  establish a shared cause` is the load-bearing one: two occurrences of one class may be
  two unrelated failures, and the trace does not say which.
- A trace with no pattern this slice knows about prints `(no suggestions)` and still
  exits `0`. That is a report about a clean-looking run, not a claim that the run was
  healthy, and the `unverified` block says so.

Nothing is changed, nothing is executed, and nothing is sent anywhere: without `--model`
nothing leaves the machine and the same file always produces the same bytes. Exit codes:
`0` when the report was delivered, `1` when the trace failed validation, `2` when the
trace file or the schema could not be read, `64` when the command line could not be
understood. Finding a great deal to suggest about does not change the exit code, for the
same reason finding a great many errors does not change `trace errors`.

### `trace fix-suggest FILE --model`

The same directions, with a model reading them against the events they cite. `--model` is
the only thing in this command that opens a network connection.

```bash
./bin/trace fix-suggest examples/failed.jsonl --model --model-name NAME
```

Terminal output for `examples/failed.jsonl`, with a local stub standing in for a real
provider, excerpted to the model half:

```text
findings
  find_1  warning  confidence medium  evidence evt_000016, evt_000023
      claim      the two tool_error occurrences carry different messages, so the shared-cause direction rests on two failures that may be unrelated
      suggestion read both messages before looking for one cause
  find_2  info  confidence low  evidence evt_000013
      claim      the refused call is the same read_file step the tool_failure suggestion points at, so the refusal and the failure may be one event read two ways
      suggestion check whether the refused call and the failed call are the same request

unverified
  - a suggestion names a direction to look, derived from a pattern in this trace; it is not a verified cause, and none of them were executed
  - what each suggestion does not establish is stated beside it, under does_not_establish
  - a suggestion covers the events this trace recorded, so a direction about a shape of failure this run did not hit is not among them
  - guardrail refusals are a separate suggestion from failures, so 1 refused call is reviewed as a policy question rather than a broken call

model
ok               true
provider         openai-compatible
model            stub-model
requests         1
events sent      5
bytes sent       7385
redacted fields  0
error            none
  - the quoted events do not say whether the two tool_error occurrences were the same mistake
```

What is sent, and only this: the fix-suggest task statement, the answer contract, four
observations and five quoted events. Each observation restates one suggestion -- its id, its
rule, the class or tool it rests on, its counts, its basis and its action verbatim, and the
line and event id of its first and last event -- and is anchored to the first of those
events. Each quoted event is one the suggestions cite, in file order, and an event two rules
cite is quoted once. The file path is left out unless `--send-paths` is typed. A quoted event's payload is sent with every credential-looking value replaced by `[redacted]`, and the model section counts them under `redacted fields`.

The model reads the directions; it does not write them. It is told not to rewrite an action
and not to propose a direction the trace does not support, and a suggestion whose events do
not share one pattern is a finding rather than a correction. The directions are this tool's
own and stay the same bytes whatever a model says, so the difference between a report with
`--model` and one without is exactly the model's contribution.

No request is made when the trace produced no suggestion. A clean-looking run has nothing to
review, and asking a model to review nothing would invite it to invent a direction. The
model section says so with `requests 0`, the exit code stays the deterministic one, and
`explain --model` is the command that asks about the run itself.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation, `2`
when the trace file or the schema could not be read, `64` when the command line could not
be understood, `65` when the model answered but its answer could not be used, and `69` when
no usable answer was obtained. When `--model` is used and the model half fails, `65` or `69`
replaces the code the deterministic half would have returned, because a caller must not
read `0` as "the directions are sound" when the model was never heard from.

### `trace diff FILE FILE`

Compares two JSONL trace files and reports every difference: the run identity, the
summary counters and the events themselves. Both files are validated first, so a trace
with a schema error or a broken invariant is reported with the same errors `validate`
prints and exits `1` instead of being compared.

```bash
./bin/trace diff examples/success.jsonl examples/failed.jsonl
./bin/trace diff examples/success.jsonl examples/failed.jsonl --json
```

Terminal output for the two examples, excerpted:

```text
run
run_id  run_01 -> run_02
summary
status                   completed -> failed
terminal_event_id        evt_000019 -> evt_000026
duration_ms              4630 -> 5730
events                   19 -> 26
events
~ evt_000003  model.response.completed  line 3 / line 3
      /payload/duration_ms: 920 -> 960
~ evt_000009  tool.call.completed       line 9 / line 9
      /payload/result_bytes: 1536 -> 2048
+ evt_000026  run.failed                only in b: line 26
diff: 37 changes
```

What is compared, and what is not:

- Events are aligned by `event_id`. An event present on one side only is reported as
  added (`+`, only in b) or removed (`-`, only in a). The tool never re-pairs events
  across the two files: a step that moved or changed shape shows up as the events it
  actually is, not as a quiet merge.
- A changed event (`~`) lists every differing leaf as a JSON pointer, for example
  `/payload/usage/input_tokens`. A field that exists on one side only is reported as
  `absent` on the other. Arrays compare as whole values, so a reordered list is one
  difference; object key order never matters.
- The compared content of an event is its `type` and its `payload`. `timestamp` and
  `run_id` are run-specific, so they cannot produce a meaningful per-event difference;
  the run identity is reported once, in the `run` section.
- Summary counters come from `summary`, minus the fields that describe the report
  itself (`command`, `file`, `schema`) and the wall-clock `started_at` / `ended_at`
  instants that differ between any two runs. `duration_ms` carries the timing signal.

`--json` prints the same report as JSON with stable keys, in this order: `command`,
`schema`, `files`, `events`, `identical`, `changes`. Every entry of `changes` carries
`kind`, `field`, `event_id`, `type`, `line_a`, `line_b`, `a`, `b`, `fields`, always in
that order, and every entry of `fields` carries `path`, `a`, `b`.

| `kind` | Meaning |
| ---|---|
| `run` | The two files carry different `run_id` values. |
| `summary` | A summary counter differs; `field` names it, `a` and `b` hold the two values. |
| `event_added` / `event_removed` | The event id exists in only one file; `line_a` / `line_b` hold its line number there. |
| `event_changed` | The event exists in both files with different content; `fields` lists the differing leaves. |

Exit codes: `0` when the two traces are identical, `1` when they differ or when a file
fails validation, `2` when a file or the schema could not be read, `3` when the report
could not be written, `64` when the command line could not be understood.

### `trace compare FILE FILE`

Compares the failure profiles of two JSONL trace files: the run status, the failure
totals, every error class and every failing tool, each with its counts in both files and
the delta between them. `diff` answers what differs event by event; this answers whether
the run got worse, which is the question a developer has after changing a prompt or a
tool. Both files are validated first, so an invalid trace is reported rather than
compared.

```bash
./bin/trace compare examples/success.jsonl examples/failed.jsonl
./bin/trace compare examples/success.jsonl examples/failed.jsonl --json
```

Terminal output for `examples/success.jsonl` against `examples/failed.jsonl`:

```text
compare  examples/success.jsonl vs examples/failed.jsonl
schema   bundled

field     a          b         delta
run_id    run_01     run_02        -
status    completed  failed  changed
events    19         26           +7
failures  0          7            +7
errors    0          6            +6
refusals  0          1            +1
fatal     0          0             0

error classes
  type               a  b  delta  verdict
  tool_error         -  2     +2  new
  command_failed     -  1     +1  new
  file_not_found     -  1     +1  new
  guardrail_refusal  -  1     +1  new
  rate_limited       -  1     +1  new
  task_failed        -  1     +1  new

tool failures
  tool         calls a  calls b  failed a  failed b  refusals a  refusals b  delta  verdict
  read_file          2        5         0         2           0           1     +2  increased
  run_command        0        1         0         1           0           0     +1  new

findings
  none

unverified
  - the comparison does not establish why a class or a tool moved, only that it did
  - events that did not fail are not part of this comparison, so a difference between two successful runs is not reported here
  - no model was called, so this report only restates what the two traces record

model
  disabled

compare: 9 differences in the failure profile
```

What is compared:

- The header table puts the two runs side by side: identity, status, event count and the
  four failure totals, each with its delta. A delta carries its sign, so `+2` cannot be
  misread as an unsigned count.
- `status_changed` counts as one difference on its own. A cancelled run and a completed
  run both have zero failures, and calling that pair identical would read as an
  all-clear for the cancellation.
- `error classes` lists every class that occurred in either trace, ordered by the size of
  the movement, then by the second trace's count, then by name. A `null` side means the
  class never occurred in that trace. The verdicts are `new`, `resolved`, `increased`,
  `decreased`, `shifted` and `unchanged`.
- `shifted` means the count held still while the composition moved, for example the same
  number of failures with one more of them fatal. The terminal cell names which counter
  moved.
- `tool failures` lists only the tools that failed somewhere: a tool that was called ten
  times without failing is not part of a failure profile. `new` and `resolved` are read
  off the tool's absence from one trace, not off a zero counter.
- Every counter comes from the same aggregation `errors` and `tools` print, so one side's
  class counts sum to its `failures` and its listed tool failures sum to its
  `tool.call.failed` events. The commands cannot disagree with each other.

What is not compared:

- Run identity. Two runs that failed in the same way compare identical even when nothing
  else about them matches; the structural differences, `run_id` included, are `diff`'s
  business.
- Events that did not fail. A tool that completed in both traces, a model response that
  succeeded, a permission that was approved: none of them move this report.
- Timestamps and durations. A candidate run that takes twice as long fails the same way,
  and that is a `summary` or `diff` question.

Exit codes: `0` when the failure profiles match, `1` when they differ or when a file
fails validation, `2` when a file or the schema could not be read, `3` when the report
could not be written, `64` when the command line could not be understood.

With `--model` two more codes join them, described in the next section.

### `trace compare FILE FILE --model`

The same comparison, with a model reading the two failure profiles. `--model` is the only
thing in this command that opens a network connection; without it nothing leaves the
machine and the same pair of files always produces the same bytes.

```bash
./bin/trace compare examples/success.jsonl examples/failed.jsonl --model --model-name NAME
```

Terminal output for `examples/success.jsonl` against `examples/failed.jsonl`, with a
local stub standing in for a real provider:

```text
compare  examples/success.jsonl vs examples/failed.jsonl
schema   bundled

field     a          b         delta
run_id    run_01     run_02        -
status    completed  failed  changed
events    19         26           +7
failures  0          7            +7
errors    0          6            +6
refusals  0          1            +1
fatal     0          0             0

error classes
  type               a  b  delta  verdict
  tool_error         -  2     +2  new
  command_failed     -  1     +1  new
  file_not_found     -  1     +1  new
  guardrail_refusal  -  1     +1  new
  rate_limited       -  1     +1  new
  task_failed        -  1     +1  new

tool failures
  tool         calls a  calls b  failed a  failed b  refusals a  refusals b  delta  verdict
  read_file          2        5         0         2           0           1     +2  increased
  run_command        0        1         0         1           0           0     +1  new

findings
  find_1  warning  confidence medium  evidence b:evt_000013
      claim      the loop guard blocked a repeated read of the same file in the second trace only
      suggestion find out why the candidate re-reads notes/a.md
  find_2  error  confidence high  evidence b:evt_000022
      claim      run_command failed with exit code 1 in the second trace and never ran in the first
      suggestion check whether notes/missing.md is expected to exist

unverified
  - the comparison does not establish why a class or a tool moved, only that it did
  - events that did not fail are not part of this comparison, so a difference between two successful runs is not reported here

model
ok               true
provider         openai-compatible
model            stub-model
requests         1
events sent      10
bytes sent       10251
redacted fields  0
error            none
  - the quoted events do not say why the file was read twice

compare: 9 differences in the failure profile
```

What is sent, and only this: the compare task statement, the answer contract, eleven
observations and ten quoted events. Each observation restates one side of one row that
moved — the status change, one error class, one failing tool — and names the file it was
read from. Each quoted event carries its side. The two file paths are left out unless
`--send-paths` is typed. A quoted event's payload is sent with every credential-looking value replaced by `[redacted]`, and the model section counts them under `redacted fields`.

Why the evidence is side-qualified: both traces may carry the same event id, so a bare id
does not say which file it came from. A finding therefore cites `a:EVENT_ID` or
`b:EVENT_ID`, and the set of ids the model may cite is built in that form, so an answer
that cites a bare id is rejected whole rather than bound to whichever file a reader
guessed. Either side can be opened afterwards: `./bin/trace show examples/failed.jsonl
--event evt_000013`.

What is not sent: the model is never shown an event that no observation cites, and past
`--max-excerpt` events the rest are named in the report rather than quoted. The failure
totals, the deltas and the verdicts are not recomputed for the model either; they are the
same numbers the tables above carry.

No request is made when the two failure profiles are identical. There is no difference
for a model to read, and asking for one would invite it to invent evidence. The model
section says so with `requests 0`, the exit code stays the deterministic one, and
`explain --model` on either trace is the command that asks about one trace's failures.

Exit codes: `0` when the profiles match and the model, if asked, answered; `1` when they
differ; `2` when a file or the schema could not be read; `3` when the report could not be
written; `64` when the command line could not be understood; `65` when the model answered
but its answer could not be used; `69` when no usable answer was obtained. When `--model`
is used and the model half fails, `65` or `69` replaces the code the deterministic half
would have returned, because a caller must not read `1` as "the model agreed the profiles
differ" when the model was never heard from.

### `trace explain FILE`

Reduces one JSONL trace file to evidence-bound observations and reports what it says
about how the run ended. The file is validated first, for the same reason every other
command validates first.

```bash
./bin/trace explain examples/failed.jsonl
./bin/trace explain examples/failed.jsonl --json
```

Terminal output for `examples/failed.jsonl`:

```text
file    examples/failed.jsonl
schema  bundled
run_id  run_02
status  failed
events  26

observations
  obs_1  evt_000026  line 26  run failed: failed; task_failed: report.md was not produced; last failure: command_failed (evt_000022)
  obs_2  evt_000013  line 13  tool failed: read_file; 10 ms; guard loop_block; guardrail refusal; guardrail_refusal: repeated read of notes/a.md blocked after 4 attempts
  obs_3  evt_000015  line 15  tool failed: read_file; 80 ms; file_not_found: notes/missing.md does not exist
  obs_4  evt_000016  line 16  error recorded: tool_error: read_file failed: file_not_found; related evt_000015
  obs_5  evt_000018  line 18  model response failed: stub-model-1; 1000 ms; rate_limited: upstream returned HTTP 429
  obs_6  evt_000022  line 22  tool failed: run_command; 340 ms; command_failed: exit code 1: cat: notes/missing.md: No such file or directory
  obs_7  evt_000023  line 23  error recorded: tool_error: run_command failed: command_failed; related evt_000022
  obs_8  evt_000025  line 25  model response: stub-model-1; 790 ms; 6400 input / 64 output tokens; stop

findings
  none

unverified
  - no model was called, so this report only restates what the trace records

model
  disabled
```

`--json` prints the same report as JSON with stable keys, in this order: `command`,
`file`, `schema`, `run_id`, `status`, `events`, `observations`, `findings`, `unverified`,
`model`. Each observation carries `id`, `kind`, `event_id`, `line`, `statement`, and the
`model` section carries `enabled`, `ok`, `provider`, `model`, `requests`, `sent_events`,
`request_bytes`, `redacted_fields`, `unverified`, `error`. `redacted_fields` counts the
 payload values that were withheld before the request was built; it is `0` when nothing
 looked like a credential and `0` again when no request was made.

Reading the sections:

- `observations` restates events, it does not interpret them. The order is fixed rather
  than file order, because a reader wants the outcome first: the terminal event, then
  everything that failed or was refused in file order, then the last thing the model
  said. Each one reuses the same one-line description `timeline` prints, so the two
  commands cannot describe one event two different ways.
- `findings` is empty unless a model produced them. A finding is the model's reading,
  never the tool's, and it carries the model's own `confidence` verbatim.
- `unverified` is deterministic: what this report does not establish. A model's own
  declared gaps live in `model.unverified`, so the two are never mixed.
- `model` reports whether a model was asked, whether it answered, which one, how many
  requests were made, how many events were quoted, how many bytes left the machine, and
  the failure when there was one.

Without `--model` the whole report is deterministic: no network, no API key, and the
same file always produces the same bytes.

#### Asking a model

```bash
export OPENAI_API_KEY=...        # never read from a file, never written anywhere
export OPENAI_MODEL=...          # or pass --model-name
./bin/trace explain examples/failed.jsonl --model --model-name stub-model
```

`--model` is the only switch in this repository that opens a network connection. Without
it nothing is sent anywhere, even when `OPENAI_BASE_URL` points at an unreachable host.

| Option | Default | Meaning |
| ---|---|---|
| `--model` | off | Ask a model. Nothing is sent without it. |
| `--model-name NAME` | `$OPENAI_MODEL` | Which model. There is no default: this tool does not pick a model for you. |
| `--provider NAME` | `openai-compatible` | Which backend. One is implemented. |
| `--timeout SEC` | 60 | Seconds to wait. No retry happens on timeout. |
| `--send-paths` | off | Include the trace file's own path in the request. |
| `--max-excerpt N` | 50 | How many cited events may be quoted. The rest are named in `unverified` but not sent. |

What one request contains: the task statement, the answer contract, the observations,
and the events those observations cite. Nothing else. Not the file, not the whole trace,
not the events that no observation points at, and not the API key, which travels as a
bearer header and appears nowhere in the body or in any report.

What comes back must match the contract that was sent: `findings`, each with a
`severity` from `info`/`warning`/`error`, a `confidence` from `low`/`medium`/`high`, a
non-empty `claim`, a `suggestion`, and at least one `evidence` entry naming an event id
that exists in the trace. An answer that is not JSON, that carries an unknown field,
that invents a severity, or that cites an event id which is not in the file is rejected
whole rather than partly believed, and the command exits non-zero. A rejected answer is
reported as a rejection; the deterministic observations are still printed, and the exit
code says the model half failed.

Exit codes: `0` when the report was delivered, `1` when the trace failed validation, `2`
when the trace file or the schema could not be read, `3` when the report could not be
written, `64` when the command line could not be understood, `65` when the model
answered but its answer could not be used, and `69` when no usable answer was obtained
from the model.

A model failure is never presented as a successful explanation, and a low-confidence
finding is never presented as a deterministic fact. Both are the model's words, in the
model's own section of the report.

### Planned commands (not implemented)

Everything the plan named for this tool is implemented and documented above: `validate`,
`summary`, `timeline`, `show`, `tools`, `errors`, `diff`, `compare`, `explain`, `eval-gen`
and `fix-suggest`, with `--model` on `compare`, `explain`, `eval-gen` and `fix-suggest`.
Nothing is left planned.

## Development

Requirements: Node.js 20 or newer. Developed and tested on Node.js 22.

```bash
npm install
npm run build
npm run typecheck
npm test

./bin/trace validate examples/success.jsonl
./bin/trace summary examples/failed.jsonl
./bin/trace timeline examples/cancelled.jsonl
./bin/trace show examples/failed.jsonl --event evt_000013
./bin/trace tools examples/failed.jsonl
./bin/trace errors examples/failed.jsonl
./bin/trace eval-gen examples/failed.jsonl
./bin/trace fix-suggest examples/failed.jsonl
```

### Packing and installing

The package is not published to npm and this version is not planned to be: the release
target is a GitHub repository, tag and release, and an npm package is a question for a
later one. What the tarball proves is narrower: the package packs and installs, and a
packed copy is exercised the way a consumer would use it:

```bash
npm pack --pack-destination /tmp
mkdir /tmp/trace-clean && cd /tmp/trace-clean && npm init -y
npm install /tmp/agent-trace-doctor-0.1.0.tgz
trace-doctor validate /absolute/path/to/examples/success.jsonl
```

The tarball carries `dist/src`, `bin/trace`, `schemas` and `CHANGELOG.md`, plus the
`README.md`, `README.zh-CN.md`, `LICENSE` and `package.json` npm always includes, and
nothing else: the tests, the examples, the spike and the TypeScript sources stay in the
repository. The `bin` entry is `trace-doctor`, so an installed copy puts that command on
the `PATH` of the project that installed it.

### Continuous integration

`.github/workflows/ci.yml` runs, on Node 20 and on Node 22: `npm ci`, `npm run
typecheck`, `npm test`, `npm run build`, a smoke of the built CLI, and a packed-tarball
install into an empty directory with one command run from the installed copy.

It has never run. While this package sat inside another repository it was inert there,
because GitHub reads workflows only from the root of the repository it builds; here it is
live, and its first execution is still pending. Nothing has executed it, so what it
establishes is that the steps were written and reviewed, not that they pass. The
account's GitHub Actions was unavailable when this repository was published, so the
first run is a pending item rather than a scheduled one.
**It will stay that way by decision, not by oversight (2026-10-17).** The blocker is
account-side billing for GitHub Actions, and the maintainer decided not to clear it:
the paid CI gate is not worth what it would cost for this project, so this workflow is
kept in the tree as a written, reviewed, deliberately unexecuted record of the steps.
Read every sentence above as "written and reviewed", never as "passed". Anyone who
wants the runner's verdict can run the same six steps locally -- the exact commands are
in the workflow -- and the versions measured locally are the ones listed below.

What has been measured without a runner: this tree ran green on Node 20.14.0 and Node
22.23.3 -- `npm ci`, `typecheck`, the full suite (624 tests in 23 files on each leg) and
`build`, each exit 0, on a second machine on 2026-10-15 against the same lockfile -- so
`engines: >=20` is a tested fact for the versions measured rather than an intent. Node
26 anywhere on it, and every other version in range, remain unmeasured. An earlier tree
-- slice S14, 579 tests -- was run green on Node 20.14.0, 22.23.3 and 26.11.1, which is
evidence about that tree and not about this one. And the built-CLI and packed-install
checks: the suite imports `src/` directly, so no test has ever started `dist/`'s CLI or
installed the tarball, and both were checked by hand on Node 22 alone.

### Running the mini agent spike

The spike is how the schema gets checked against something real. It is not part of the
published CLI and is not needed to use the tool.

```bash
npm run build
./bin/spike-run --out /tmp/spike.jsonl          # real run, real trace, self-validated
./bin/spike-run --out /tmp/spike.jsonl --json   # the run report as JSON
./bin/spike-run --out - --steps 3               # trace on stdout, three turns allowed
./bin/spike-run --out /tmp/spike.jsonl --keep   # keep the sandbox it created
```

`spike-run` exits `0` when the run completed and its trace validated, `1` when either
did not, `2` when the sandbox could not be prepared or the run threw, `3` when the
report or the trace file could not be written, and `64` when the command line could not
be understood.

The model is a scripted replay, so a run costs nothing and reaches no network. To try
a real model, implement `ModelProvider` in `spike/model.ts` and pass it to `runAgent`:
nothing else in the spike needs to change, and the trace format does not move.

### Regenerating the committed example

```bash
./bin/spike-run --out examples/spike-run.jsonl
```

The file is a real run, so its timestamps and durations change every time and the diff
of a regeneration is never empty. That is expected. The tests assert its structure
(event counts, tool set, effect dispositions, capture placement), not its bytes.

## Boundaries

- Reads local files only. Never writes to, renames or modifies an input file, and never
  executes content found in one.
- A trace file is untrusted input, and the schema says so: a payload may carry fields
  this tool has never heard of, so a recorder can extend without a schema bump. Nothing
  reads those fields. Every counter comes from a named field of a known event type, so a
  payload that adds `outcome: "completed"` beside a `status` that says `failed`, or
  `refused: true` beside a failure the recorder did not mark as a refusal, moves nothing
  — `tests/injection.test.ts` holds the two traces side by side and compares every
  counter. Payload prose is quoted where an event is restated and acted on nowhere.
- A quoted event's payload reaches the model with every credential-looking value replaced
  by `[redacted]`. The rule is key names, not value shapes: a value is withheld when the
  key holding it says it is a credential — `api_key`, `access_token`, `authorization`,
  `password`, `secret` and the rest, matched exactly or as a `_`-prefixed suffix, so
  `openai_api_key` is caught and `input_tokens` is not. A value that merely looks like a
  key under a name that says nothing is sent, and the model section reports how many
  values were withheld under `redacted fields`. This is the request boundary and only the
  request boundary: the local report is untouched, because the engineer who owns the file
  is the one person entitled to read it, and `show` still prints the value in full.
- Every task statement and system prompt says that the quoted payloads are data a run
  recorded, not instructions to the model, and that text inside a payload which reads like
  an instruction is content to report rather than a directive to follow. That is a stated
  boundary, not a guarantee: a model can still be misled, which is why every finding must
  cite an event id that exists in the trace and is rejected whole when it does not.
- Every command writes its report to stdout and nothing else. `eval-gen --out DIR` is the
  single exception: it writes one JSON file inside `DIR`, named after the run id, in a
  directory it creates if it is missing, and it refuses to replace a file that is
  already there unless `--force` is passed. Without `--out` it writes nothing at all,
  which makes the plain command a dry run of the same thing. The file holds the
  deterministic report in both modes: `--model` adds findings to the stdout report and
  never to the file, because a case file has to be the same bytes for the same trace
  whatever a model said about it.
- `explain`, `compare`, `eval-gen` and `fix-suggest` without `--model` are local and
  deterministic: no network, no API key, no clock, and the same file always produces the
  same bytes.
- `--model` is the only network path in this repository. It is off unless it is typed,
  it makes exactly one request and never retries, and it sends the task statement, the
  answer contract, the observations and the events those observations cite. Nothing
  else: not the file, not the whole trace, and not the events no observation points at.
  The trace file's own path is left out unless `--send-paths` is passed.
- The API key is read from `OPENAI_API_KEY` and travels as a bearer header. It is never
  written to a file, never echoed, and appears in no report and no test fixture.
- A model answer is checked against the same contract that was sent to it, and a
  finding that cites an event id which is not in the trace is rejected whole.
- `diff` has no model half. It compares events rather than failure profiles, so `--model`
  is an unknown option on it rather than a flag that is accepted and ignored, because a
  command that does not take a model must not look as though it does.
- Accepts only schema version `1`. Does not attempt to read arbitrary JSONL.
- The packed tarball carries `dist/src`, `bin/trace`, `schemas` and `CHANGELOG.md` and
  nothing else. An installed copy is the CLI alone: the tests, the examples, the spike
  and the sources stay in the repository, and `--model` behaves exactly as it does here.
- A trace file may contain sensitive data. Check before sharing one, and check again
  before passing one to a model.

## License

Apache License, Version 2.0. The full text is in `LICENSE` at the root of this
repository, and npm carries it into every packed copy. The copyright line names this
project's contributors rather than an employer: who maintains the public repository is
already carried by the author, committer and tagger of every commit and tag, which is
the one place that identity has to be exact.

## Not decided yet

- The live model path has never been called. Every model test talks to a local stub
  server, so the request shape is verified against a stub and not against an endpoint.
  The first real call spends the user's quota and is theirs to make.

Fields the schema still does not have, because nothing has exercised them yet:
`trace.dropped` / `trace.drop_reason` (our recorder never drops an event), cost fields
such as `estimated_cost_usd` and `cost_status` (the spike model has no cost), and
multi-slot attribution beyond `role: "main"` (the spike runs one model). See
`spike/SCHEMA_REVIEW.md` for the full list and the reason each is absent rather than
guessed at.
