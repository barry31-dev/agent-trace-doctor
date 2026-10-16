# Changelog

All notable changes to Agent Trace Doctor are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

A public repository exists at https://github.com/barry31-dev/agent-trace-doctor and
carries this tree's root commit and the annotated tag `v0.1.0` (measured read-only
2026-10-17), while the GitHub release for that tag does not exist yet, so the `0.1.0`
entry below is a version cut whose release is still to be cut, and the `Unreleased`
entry above it is a correction to this release rather than a next one. The command
name, the license and the Chinese README were
open when the slices below landed; they are settled now, and the entries that
described them as open were corrected rather than left to contradict the manifest.
>
> **Superseded 2026-10-17:** the release for `v0.1.0` now exists -- created on
> that day through the publication channel's follow-up mode and read back from
> the API: release present, commit author/committer and tag tagger all
> `barry31-dev/agent-trace-doctor`, follow-up commit on top of the published root. The CI workflow
> has never run and will not by the maintainer's decision, because GitHub
> Actions here is behind an account-side billing gate this project does not
> intend to clear.

## [Unreleased]

### Fixed

- The statements that described this version as unreleased were corrected instead of
  being left to contradict the tree: `README.md`, `README.zh-CN.md`, `RELEASE_NOTES.md`
  and `ASSETS.md` said no release existed and described the CI workflow as inert, while
  a public repository does exist and the publication channel is implemented. Each
  corrected paragraph keeps its date, so a reader can still see what it used to say.
- The same correction was applied in the opposite direction: several of those
  paragraphs had claimed the tag and the release already existed. They have not --
  the repository is empty, and the channel that will push this tree to it has only
  been rehearsed. Both directions are now stated as measured.
  **Superseded 2026-10-17**: "the repository is empty" was true when it was written
  and false the same day, when the root commit and the annotated tag `v0.1.0` were
  pushed to it at 14:37 UTC. The sentence is kept as written rather than rewritten;
  the current reading is the next entry.
- **Third correction, 2026-10-17, after the tree was actually pushed.** A read-only
  measurement (`gh api` plus `git ls-remote`) reports the public repository as
  carrying one root commit, `8848261132aa56d9724f52e287de1fba06a6fb8c`, with the
  annotated tag `v0.1.0` pointing at it and **zero GitHub releases**. The tag exists;
  the release does not. The paragraphs in `README.md`, `README.zh-CN.md` and
  `RELEASE_NOTES.md` that said nothing had been pushed were corrected to that
  reading, each keeping the date it was measured. The five Markdown files the public
  repository carries -- which state that a release exists -- are the only members by
  which that tree differs from this one; the other sixty-eight are byte-identical,
  so what remains to be published is wording and not code.

### Added

- The publication channel gained the three steps that follow repository creation:
  pushing the candidate tree's root commit, the annotated tag and the GitHub release,
  each gated by the identity, commit-message, clean-room and surface checks before
  any remote is contacted, and refused outright when the remote already has refs.
- The clean-room scan now distinguishes "the only hit is this package's own published
  address" from "the tree carries internal context": the address is re-checked with the
  text removed, and a private repository address, the ssh alias and the account's other
  identities still refuse the tree.

`0.1.0` is the terminal version on this line -- the plan gives it a freeze node rather
than a `0.2` -- so what belongs here is a correction to this release and not a next one.
The open decisions that used to sit here are gone: the command name, the license and
the Chinese README were all settled on 2026-10-15 and folded into `0.1.0` below, because
a reader of this version is the one who needs them.

## [0.1.0] - 2026-10-15

### Added

- **The three decisions the release tree was waiting on** (`package.json`, `LICENSE`,
  `README.zh-CN.md`). The plan's first milestone is a ruling on the public repository
  name, the command name, the license and the confirmation that this version is the
  terminal one, and every one of them had been blocking packaging. The ruling landed on
  2026-10-15: the project stays `agent-trace-doctor`, the command becomes
  `trace-doctor` rather than the `trace` placeholder the design drafts used, the license
  is Apache-2.0, and `0.1.0` is confirmed as the terminal version with no npm release
  planned from it. `bin` now carries the decided name and `"private": true` is gone, so
  a packed copy installs a command instead of a path; `LICENSE` is the full Apache-2.0
  text with the copyright line filled in, which npm carries into every tarball whatever
  `files` says; and `README.zh-CN.md` states the same commands, the same exit codes and
  the same boundaries as the English README, checked command for command and code for
  code rather than by eye. Two tests that pinned the old state -- no `bin` entry and
  `"private": true` -- now pin the decided one, and the publication channel's member
  check gained a case for a `bin` key whose target is not there, because a key pointing
  at a missing script fails every call rather than some of them.
- **An asset manifest for the release-tree candidate** (`ASSETS.md`). The plan's release
  criterion asks for public assets to be registered and reviewed, and the repository
  keeps its half of that registration; this file is the half a reader of the package can
  check. What it records was measured after the last write of this round rather than
  asserted: 71 tracked files in 7 kinds, the two Markdown files that carry non-ASCII
  bytes and what those bytes are, zero binaries of any kind (every file was read as
  bytes and none contains a NUL), and every `http://` / `https://` string in the text
  files with what each one is -- dialect identifiers, a default endpoint, a local stub
  server, the reserved example domain, a link to a public format specification, and the
  registry metadata npm writes into the lockfile. It also states what is excluded and
 why, that the tree it describes is not assembled yet, and which gates remain open: no
 `LICENSE`, no `README.zh-CN.md`, no `bin` entry, a workflow that has never run, no real
 provider call, and no release. It is not part of the packed tarball: `files` is
 unchanged, so the packed surface is still exactly the compiled CLI, its entry script
 and the bundled schema.
  > **Correction, 2026-10-15, later the same day.** The three of those gates that named
  > decisions -- `LICENSE`, `README.zh-CN.md` and the `bin` entry -- are closed by the
  > entry at the top of this section, and the file itself was updated with them. What
  > remains open is what no agent can close from here: the workflow has never run, no
  > real provider has been called, and nothing is released.
- **Release notes for the packed version** (`RELEASE_NOTES.md`). The plan's release
  criterion asks for a release-notes file and a README that declare three things a
  reader cannot otherwise see: that no real provider has ever been called, what was
  measured on Node 20 and Node 22, and that nothing is published to npm. Each was
  already stated somewhere in this README, scattered across sections, and one of them
  too broadly -- "no machine this was developed on has Node 20 installed" was written
  from one machine's point of view, while a second machine had run the suite green on
  Node 20.14.0, 22.23.3 and 26.11.1 at slice S14. The file states every measured run
  with its interpreter, its machine and its tree, so the 624-test run on Node 22.22.1 is
  not read as covering Node 20 and the 579-test run is not read as covering this one.
  The README carries the same three declarations where a reader already looks: the
  packing section says no npm release exists and none is planned for this version, the
  CI section says which tree each Node run belongs to, and the status line names the
  slices the tree actually carries, S0-S22 rather than S0-S19.
- **Continuous integration for the published tree** (`.github/workflows/ci.yml`). Two legs,
  Node 20 and Node 22, each running `npm ci`, `typecheck`, `test` and `build`, then two
  checks no test performs. The first runs the built CLI: the suite imports `src/`
  directly, so nothing automated had ever proved that `npm run build` leaves a `dist/`
  `bin/trace` can start from, or that the bundled-schema lookup still resolves once the
  schema travels inside a tarball. The second packs the tarball, installs it into an empty
  directory and validates a trace from the installed copy, because the suite pins what
  `files` declares and only an install proves the declaration is sufficient. `diff`'s exit
  `1` is asserted rather than swallowed, so a CLI that stopped reporting a difference is
  exactly as red as one that crashed. Action pins were resolved from `actions/*` tags and
  re-read as commit objects before being written down.
- **The workflow has never run** (same file). GitHub reads workflows only from the root of
  the repository it builds, so this one is inert while the package sits inside another
  repository, and nothing has executed it since it was written. What it leaves unproven is
  the two things it exists for: the suite on Node 20, which the tree this entry describes
  has not been run on, and the built-CLI and packed-install checks, which were verified
  by hand on Node 22 only. Its steps were checked locally for what can be checked
  without a runner -- the file parses as YAML, every `run:` block parses as bash,
  `npm ci` resolves
  against the lockfile, and each command in the two new steps exits the number the
  workflow asserts -- which is not the same as the workflow passing.
- **Credential-looking values are withheld from a model request** (`src/model/redact.ts`,
  `src/explain.ts`, `src/compareModel.ts`, `src/evalGenModel.ts`,
  `src/fixSuggestModel.ts`). A trace payload is data a run recorded, and the schema
  deliberately allows fields the tool does not know about so a recorder can extend
  without a schema bump -- so one of those fields can be a credential, from a tool that
  logged its own configuration or a request that echoed an authorization header. A quoted
  payload was sent verbatim, which the design draft's request boundary forbids: it says
  the API key is not sent. Every value under a key whose name says it holds a credential
  is now replaced by `[redacted]` before the request is built. The rule is key names, not
  value shapes -- `api_key`, `access_token`, `authorization`, `password`, `secret` and the
  rest, matched exactly or as a `_`-prefixed suffix, so `openai_api_key` is caught and
  `input_tokens` is not. A value that merely looks like a key under a name that says
  nothing is still sent, and the README states that limit rather than leaving a reader to
  assume a safety nobody implemented.
- **The request reports how many values it withheld** (`src/model/types.ts`,
  `src/explain.ts`, `src/compareModel.ts`, `src/evalGenModel.ts`,
  `src/fixSuggestModel.ts`, `src/report.ts`, `src/cli.ts`). `redacted_fields` joins
  `requests`, `sent_events` and `request_bytes` on the attempt and on every model section,
  and prints as `redacted fields` in the terminal report. It is `0` when nothing looked
  like a credential and `0` again when no request was made, so the number describes what
  left the machine rather than what the trace holds. It travels beside the wire payload
  rather than inside it: the payload lists its fields explicitly, and a count about the
  request is not part of the request.
- **Withholding is the request boundary and only the request boundary**
  (`src/model/redact.ts`, `tests/explain.test.ts`). The local report is untouched, because
  the engineer who owns the file is the one person entitled to read it and `show` still
  prints the value in full; hiding it locally would take away the only place it can be
  inspected. A test holds the two halves apart: the excerpt loses the values and counts
  them, and the loaded event keeps them.
- **The walk is depth-capped** (`src/model/redact.ts`). `JSON.parse` accepts nesting far
  deeper than a recursive walk survives -- measured on this repository's Node, a
  100,000-level array parses and walking one overflows the stack at 20,000 -- so a trace
  that used to load would have taken the CLI down inside the redaction pass. Past 32
  levels the subtree is withheld instead of walked, which costs a value nobody would have
  read and makes the failure impossible.
- **Every task statement and system prompt declares the quoted payloads to be data**
  (`src/model/contract.ts`, `tests/model.test.ts`). Text inside a payload can be written
  to look like an instruction, so all four tasks now say the quoted events are data a run
  recorded, that such text is content to report and never a directive to follow, and that
  no payload can change what the model was asked to do; all four system prompts say the
  same. This is a stated boundary, not a guarantee -- a model can still be misled, which
  is why a finding must cite an event id that exists in the trace and is rejected whole
  when it does not.
- **Test suite for slice S17** (Vitest, 18 further tests, 604 total): which keys are
  withheld and which are not, that the shape of a payload survives with only the values
  replaced, that a non-string credential value is withheld rather than guessed harmless,
  that a container held under a credential name goes whole, that a value which only looks
  like a credential under an unrelated name is still sent, that the pass is deterministic,
  that a subtree past the walk depth is withheld rather than walked, that no bundled
  example carries a field the rule touches, that the excerpt loses the values and counts
  them while the loaded event keeps them, that the count reaches both the report and the
  request, and that every task statement and system prompt carries the untrusted-data
  sentence.
- **One task statement, not two** (`src/model/openai.ts`, `tests/model.test.ts`). The
  payload builders chose `EXPLAIN_TASK`, `COMPARE_TASK`, `EVAL_GEN_TASK` and
  `FIX_SUGGEST_TASK` themselves, so the sentence a model was given existed twice: once
  on the request object the draft builder returned, and once inside the transport. The
  `task` field on all four request types was written and read by nobody, and nothing
  compared the two copies, so the model could have been given one task statement while
  the tool's own request recorded another. The transport now sends `request.task`, the
  string the draft builder put there, so there is exactly one copy -- which is the same
  rule `contract.ts` already states for the answer contract, that the shape sent is the
  shape enforced. The hand-made request in `tests/model.test.ts` carried the placeholder
  `"explain"` and now carries the real statement, because a fixture that does not look
  like a real request cannot prove anything about one.
- **A hostile trace moves nothing** (`tests/injection.test.ts`, 17 further tests, 621
  total). The design draft's test matrix lists instruction injection as one row of the
  security line, and the untrusted-data sentence is a promise about a model rather than
  a proof about this tool, so the row was still open. A trace is built whose payloads
  are written to be obeyed -- a `run.started` telling the model to reply with one word,
  an `args_summary` claiming a deletion was already approved, an error message naming an
  event id that does not exist and asking for a field the contract does not declare --
  and three things are held against it. The tool's own behaviour: every counter and every
  exit code is the same whether that prose is hostile or neutral, and byte-stable across
  runs. The schema's opening: the same trace is rebuilt with unknown fields that assert
  the opposite of what the declared ones say, and no counter moves, because every counter
  is read from a named field of a known event type and nothing reads an unknown one. The
  request's instruction positions: the system prompt is byte-identical to the exported
  constant and the task statement to its own, whatever the payload says, so the hostile
  text can only sit where an event is quoted as a record. And the answer contract still
  refuses, whole, an answer that did as the payload asked -- a bare word, a fabricated
  event id, an extra top-level field, an `approved` flag inside a finding, a finding
  citing nothing.
- **The package installs and runs from a clean environment** (`package.json`,
  `package-lock.json`, `tests/package.test.ts`). `ajv` and `ajv-formats` are runtime
  imports of `src/`, but they had been declared as devDependencies, and a consumer
  install skips those: an installed CLI would have crashed on its first schema compile,
  in a directory with no `node_modules/ajv` to import. They are dependencies now, and a
  test fails if a runtime import of `src/` is ever declared anywhere but
  `dependencies` again.
- **A packed surface, pinned and then verified** (`package.json`). `files` lists
  `dist/src`, `bin/trace`, `schemas` and `CHANGELOG.md`, so the tarball is the compiled
  CLI, its entry script, the bundled schema the lookup walks up to find, and the
  changelog -- not the tests, the examples, the spike or the TypeScript sources. The
  packed tarball was installed into an empty directory and the CLI run from there:
  `validate` exits `0` on a valid example, `1` on a trace whose line lacks `payload` and
  carries a numeric `schema_version`, and `2` on a missing file, and `summary`,
  `timeline` and `diff` all ran against the examples from the installed copy.
- **No `bin` entry, deliberately** (`package.json`). The command name is still
  undecided, and a `bin` key would ship the `trace` placeholder as though it were not.
  A test pins the absence, so the entry appears when the name is decided rather than by
  accident, and the README states that an installed copy is run by path until then.
  > **Correction, 2026-10-15, later the same day.** The name was decided and the entry
  > appeared: `bin` is `trace-doctor`, the test now pins that instead of the absence,
  > and the README's install section runs the installed copy by command name.
- **The description names every implemented command again** (`package.json`). It still
  listed `compare`, `explain` and `eval-gen` as the model-bearing commands a slice after
  `fix-suggest --model` landed; a test now fails if a command name goes missing from it.
- **Test suite for slice S15** (Vitest, 7 further tests, 586 total): every runtime
  import of `src/` declared in `dependencies` and none of them in `devDependencies`, the
  packed surface being exactly the four intended entries with each source entry present
  in the repository, the bundled schema sitting inside that surface, the description
 naming every implemented command and the four that take `--model`, no `bin` entry
 while the command name is undecided, and the package staying private until the release
 decision.
  > **Correction, 2026-10-15, later the same day.** The last two of those are now the
  > opposite: the suite pins that `bin` carries the decided name and that `"private"`
  > is absent, which is the same check with the sign flipped. The first three are
  > unchanged.
- **`trace fix-suggest FILE --model`** (`src/fixSuggestModel.ts`, `src/model/contract.ts`,
  `src/model/types.ts`, `src/model/openai.ts`, `src/report.ts`, `src/cli.ts`). The model
  half of the last planned command, which closes it: the directions this slice's
  predecessor wrote, read back against the events they cite. Each suggestion is restated
  as one observation quoting its own action verbatim, with its rule, the class or tool it
  rests on, its counts, its basis and the line and event id of its first and last event,
  so a model cannot be seen to have approved a direction other than the one the command
  prints. `--model` is the only thing in the command that opens a network connection.
- **The model reads the directions and never writes them** (`src/fixSuggestModel.ts`,
  `src/cli.ts`). The task statement forbids rewriting an action and forbids proposing a
  direction the trace does not support, and a suggestion whose events do not share one
  pattern is reported as a finding rather than a correction. The directions are this
  tool's own and stay the same bytes whatever a model says, so the difference between a
  report with `--model` and one without is exactly the model's contribution.
- **An event two rules cite is quoted once** (`src/fixSuggestModel.ts`). A class whose
  every occurrence was fatal fires both `fatal_failure` and `repeated_error_class` over
  the same events, so the wanted set is a set and the file is walked once. Sending the
  same event twice would charge the caller for a duplicate and let a finding cite it
  twice as though it were two pieces of evidence.
- **No request when the trace produced no suggestion** (`src/fixSuggestModel.ts`,
  `src/cli.ts`). A clean-looking run has nothing to review, and asking a model to review
  nothing would invite it to invent a direction. The call is skipped, the model section
  records why with `requests 0`, and the exit code stays the deterministic one, for the
  same reason `eval-gen --model` stays at `0` for a trace with no case.
- **A model failure replaces the deterministic exit code** (`src/cli.ts`). `fix-suggest
  --model` was asked for two things, so a caller that gets `0` must not read it as "the
  directions are sound" when the model was never heard from. `65` and `69` therefore win
  over `0`, and the deterministic suggestions are still in the report.
- **`completeFixSuggest` on the model client** (`src/model/openai.ts`). A fourth entry
  point beside `complete`, `completeCompare` and `completeEvalGen`, all four sharing one
  transport path: the task statement and the system prompt arrive with the payload rather
  than being chosen inside the client, so another task cannot quietly reuse the wrong
  one. The evidence label is the plain `this trace`, because there is one trace here and a
  bare event id says which file it came from.
- **Test suite for slice S14** (Vitest, 31 further tests, 579 total): one observation per
  suggestion anchored to the first of its events that carries an id, the action quoted
  verbatim, the counts and both anchors stated, the excerpt being exactly the events the
  suggestions cite in file order with an event two rules cite quoted once, the events past
  `--max-excerpt` named rather than quoted, a finding being allowed to cite an unquoted
  but real event, the no-suggestion skip in both directions, the deterministic notes for
  the truncated file, the shapes this run did not hit and the refusals, the folding of a
  success, a failure and a skip, the stable key order of both output modes,
  byte-stability, the deterministic half staying byte for byte whatever the model half
  adds, the no-model note never reaching a report built for a model call, and the
  terminal output shown in the README against what the command actually prints. The CLI
  suite covers a real HTTP request against a local stub proving the payload, the file path
  staying out unless `--send-paths`, every exit code including `65`, `69` and `64`, and
  the no-suggestion skip making no request at all.

- **`trace fix-suggest FILE`** (`src/fixSuggest.ts`, `src/report.ts`, `src/cli.ts`). The
  deterministic half of the last planned command: the directions one trace's own records
  point at. Seven rules, fired in the order a reader asks the questions in --
  `incomplete_run`, `dangling_reference`, `fatal_failure`, `repeated_error_class`,
  `tool_failure`, `permission_denied`, `guardrail_refusals` -- so a file with no terminal
  event suggests its own incompleteness before anything suggests acting on its failures.
  Every suggestion cites the events it was derived from, and states beside itself what it
  does not establish.
- **A suggestion is a direction, never a diagnosis** (`src/fixSuggest.ts`). The trace
  records what happened, not why, so each rule restates a pattern and stops there:
  `repetition does not establish a shared cause` is stated on the suggestion that could
  most easily be read as a cause, and `fatal is the recorder's label` on the one that
  could most easily be read as a severity. Nothing is applied, nothing is written, and
  nothing is sent anywhere.
- **Suggestions are built from the `errors` report, not from the events again**
  (`src/fixSuggest.ts`). Every count in a suggestion is the count `trace errors` reports
  for the same event, so the two commands cannot drift. The two rules that are not about
  failures read the events directly, because `errors` does not carry permission decisions
  or the absence of a terminal event; both use the same predicate the analyzer counts
  them by.
- **A refused call is never part of a failure count** (`src/fixSuggest.ts`).
  `tool_failure` counts the calls that broke and names the refused ones in its basis, and
  `guardrail_refusals` is its own suggestion that asks for a policy review rather than a
  fix, because a refusal is the guard doing its job.
- **`permission_denied` reads decisions, not errors** (`src/fixSuggest.ts`). A denial is
  not an error, and a tool that was never allowed to run cannot have succeeded, which is
  why `examples/cancelled.jsonl` -- a run with no failure in it at all -- produces
  exactly one suggestion.
- **`--model` stays an unknown option on `diff`** (`src/cli.ts`). `diff` compares events
  rather than failure profiles, and a command that does not take a model must not accept
  the flag and quietly ignore it. `fix-suggest` took the flag in slice S14.
- **`trace eval-gen FILE [--out DIR] [--force] --model`** (`src/evalGenModel.ts`,
  `src/report.ts`, `src/cli.ts`). The cases slice S11 writes, read back against the
  events they cite. Each case is restated as one observation quoting its own expectation
  verbatim, with its occurrence and fatal counts, its sources and tools, and the line and
  event id of its first and last occurrence, so a model cannot be seen to have approved an
  assertion other than the one the command prints. `--model` is the only thing in the
  command that opens a network connection.
- **The model reviews the cases and never writes them** (`src/evalGenModel.ts`,
  `src/cli.ts`). The task statement forbids rewriting an expectation and forbids
  proposing a case the trace does not support, and a case whose occurrences do not share
  one failure is reported as a finding rather than a correction. This is why `--out`
  writes the deterministic report under `--model` too: a case file is the record of a run
  that already happened, and has to be the same bytes for the same trace no matter which
  model answered. The stdout report carries the findings and the file does not, so the
  difference between the two is exactly the model's contribution. `writeCaseFile` is
  handed the deterministic bytes in both modes rather than the rendered report.
- **No request when the trace produced no case** (`src/evalGenModel.ts`, `src/cli.ts`). A
  clean run has nothing to review, and asking a model to review nothing would invite it to
  invent a failure. The call is skipped, the model section records why with `requests 0`,
  and the exit code stays the deterministic one, because a skipped call is a no-op rather
  than a failure and a caller reading 65 or 69 would go looking for a provider problem
  that does not exist.
- **A model failure replaces the deterministic exit code** (`src/cli.ts`). `eval-gen
  --model` was asked for two things, so a caller that gets `0` must not read it as "the
  cases are fine" when the model was never heard from. `65` and `69` therefore win over
  `0`, and the deterministic cases are still in the report.
- **`completeEvalGen` on the model client** (`src/model/openai.ts`). A third entry point
  beside `complete` and `completeCompare`, all three sharing one transport path: the task
  statement and the system prompt arrive with the payload rather than being chosen inside
  the client, so a fourth task cannot quietly reuse the wrong one. The evidence label is
  the plain `this trace` rather than the side-qualified one, because there is one trace
  here and a bare event id says which file it came from.
- **Test suite for slice S12** (Vitest, 31 further tests, 521 total): one observation per
  case anchored to that case's first anchored occurrence, the expectation quoted verbatim,
  the counts and both anchors stated, the excerpt being exactly the events the cases cite
  in file order and nothing else, the events past `--max-excerpt` named rather than
  quoted, a finding being allowed to cite an unquoted but real event, the no-case skip in
  both directions, the deterministic notes for the why, the shape, the refusals and the
  missing terminal event, the folding of a success, a failure and a skip, the stable key
  order of both output modes, byte-stability, the file being the report minus the model
  half and nothing else, and the terminal output shown in the README against what the
  command actually prints. The CLI suite covers a real HTTP request against a local stub
  proving the payload, the file path staying out unless `--send-paths`, the written file
  never carrying a model's words, every exit code including `65`, `69` and `64`, and the
  no-case skip making no request at all.

- **`trace eval-gen FILE [--out DIR] [--force]`** (`src/evalGen.ts`, `src/caseWriter.ts`,
  `src/report.ts`, `src/cli.ts`). The failures of one trace restated as regression cases:
  one case per error class, each carrying every occurrence it rests on with its line
  number and event id, so an assertion can be followed back to the event that justifies
  it. The cases are built from the `errors` report rather than from the events again, so
  no counter in a case can disagree with the command that owns it.
- **The first command that writes a file** (`src/caseWriter.ts`). Every other command
  reads a trace and prints a report and changes nothing on disk; `eval-gen --out DIR`
  writes one JSON file named after the run id, in a directory it creates if it is
  missing. Without `--out` it writes nothing at all, which makes the plain command a dry
  run of the same thing `--out` does.
- **An existing case file is never replaced unless `--force` is passed**
  (`src/caseWriter.ts`, `src/cli.ts`). A case file is the record of a run that already
  happened, and silently overwriting it would lose the only evidence the earlier run
  left. The refusal is exit code `3`, the code that already meant "the report could not
  be delivered", because the cases were produced and then not delivered.
- **A run id cannot name a path outside `--out`** (`src/caseWriter.ts`). A `run_id` is
  recorder data, not a path component: it may contain a slash, a leading dash or nothing
  usable at all. Every character outside `A-Za-z0-9._-` becomes an underscore, a result
  that is empty, a dot, a dot-dot or option-looking falls back to a fixed name, and the
  name is capped in length. This is the project's first path-escape surface, and it is
  covered in both directions.
- **Guardrail refusals produce no case** (`src/evalGen.ts`). A refusal is the guard doing
  its job, so an assertion that the run must not refuse would ask for the guard to be
  removed. A class whose every occurrence was a refusal is named under
  `skipped_refusals` instead of being dropped, so a reader looking for a class `errors`
  reported can see it was seen here and left alone on purpose. A class with both real
  failures and refusals produces a case over the real ones only, and takes its first and
  last line from them rather than from the refusal ahead of them.
- **`reportForWriteFailure`** (`src/validate.ts`). The report shape for output that was
  produced and not delivered, kept apart from `reportForInputFailure` because the two
  want different things done about them: the trace was fine, the cases exist, and the
  problem is a directory, a permission or a file that would have been replaced. A caller
  reading "input could not be read" would go and look at the one file that is not the
  problem.
- **Test suite for slice S11** (Vitest, 46 further tests, 490 total): the case count of
  the real trace hand-checked against the file, every occurrence a case cites being the
  occurrence `errors` reports for the same event, a refusal-only class producing no case
  and being named instead, a mixed class keeping only its real failures and taking its
  first and last line from them, the tool and source distributions, the reconciliation
  of every counter against the `errors` report, the stable key order of both output
  modes, byte-stability, and the terminal output shown in the README against what the
  command actually prints. The writer suite covers the file name a run id produces,
  including every way a run id could name a path outside the directory it was given, and
  the directory creation, the overwrite refusal, the forced replacement and the
  unwritable-directory path.
- **`trace compare FILE FILE --model`** (`src/compareModel.ts`, `src/report.ts`,
  `src/cli.ts`). The deterministic comparison of slice S9 plus a model reading of the
  two failure profiles, the same way `explain --model` reads one trace. What moved is
  restated as observations, one per side of each moved row, and the events those
  observations cite are quoted with the side they came from. `--model` is the only thing
  in the command that opens a network connection.
- **Side-qualified evidence** (`src/compareModel.ts`, `src/model/types.ts`,
  `src/model/contract.ts`). Both traces may carry the same event id, so a finding about
  a pair cites `a:EVENT_ID` or `b:EVENT_ID` rather than a bare id. The set of ids the
  model may cite is built in that form, which makes a bare id fail as evidence instead
  of being bound to whichever file a reader guessed, and the rejection message repeats
  the convention so the caller is not sent looking for an id that was never valid.
- **One observation per side, never one about the pair** (`src/compareModel.ts`). A
  status change has two terminal events, and an observation anchored to neither would
  leave the model with nothing it is allowed to cite while the answer contract still
  demands at least one citation. A side with no event of its own is left out rather than
  stated without evidence, so a tool the other trace never called carries one
  observation instead of two.
- **No request when there is nothing to ask about** (`src/compareModel.ts`,
  `src/cli.ts`). Two traces with identical failure profiles have no difference for a
  model to read, and asking for one would invite it to invent evidence. The call is
  skipped, the model section records why with `requests 0`, and the exit code stays the
  deterministic one: a skipped call is a no-op, not a failure, and a caller reading 65
  or 69 would go looking for a provider problem that does not exist.
- **A model failure replaces the deterministic exit code** (`src/cli.ts`). `compare
  --model` is asked for two things, so a caller that gets `1` must not read it as "the
  model agreed the profiles differ" when the model was never heard from. `65` and `69`
  therefore win over `0` and `1`, and the deterministic verdict is still in the report.
- **`completeCompare` on the model client** (`src/model/openai.ts`). A second entry
  point beside `complete`, both sharing one transport path: the task statement and the
  system prompt arrive with the payload rather than being chosen inside the client, so
  a third task cannot quietly reuse the wrong one. The explain payload is unchanged,
  key for key.
- **The model section, findings and unverified blocks are now shared renderers**
  (`src/report.ts`). `explain` and `compare` describe the same kind of model call, and
  two copies of that block would drift into describing it two different ways. In
  `compare` they sit between the tables and the closing verdict, so the last line of the
  report is still the deterministic answer to the question the command was asked.
- **Test suite for slice S10** (Vitest, 24 further tests, 444 total): every observation
  anchored to a real event of the side it names, the side with no event left out, the
  quoted events being exactly the cited ones with their side, both file paths staying
  out unless `--send-paths` is given, the events past `--max-excerpt` named rather than
  dropped, a bare event id refused as evidence while a side-qualified one is accepted,
  a failed attempt keeping the deterministic report, a skipped call recorded as a
  no-op, the deterministic notes for the no-failure, identical and status-only cases,
  and a real HTTP request against a local stub server proving the request payload, the
  findings, the no-key and bad-evidence exit codes, and that `diff` still refuses
  `--model`.
- **`trace compare FILE FILE` command** (`src/compare.ts`, `src/report.ts`, `src/cli.ts`).
  Compares the failure profiles of two validated traces: the run status and failure
  totals side by side, every error class and every failing tool with its counts in both
  files and the delta between them. `diff` reports what differs event by event, which is
  the wrong shape for the question a developer has after changing a prompt or a tool:
  did the run get worse? Each side is aggregated by `buildErrors` and `buildTools` rather
  than recomputed, so a counter in this report is the counter those commands print and
  the two cannot drift apart.
- **The verdict vocabulary of one compared row** (`src/compare.ts`). `new` and `resolved`
  mean the row never occurred in the other trace, `increased` and `decreased` that its
  count moved, and `shifted` that the count held still while the composition moved: the
  same number of failures with one more of them fatal is a change a count-only verdict
  would report as unchanged. The terminal cell of a `shifted` row names the counter that
  moved, because the count columns around it show no movement.
- **The failure profile is the whole comparison, and its boundary is stated**
  (`src/compare.ts`). Run identity and events that did not fail are not compared, so two
  unrelated runs that failed in the same way compare identical; the status change counts
  as one difference on its own, because a cancelled run and a completed run both have
  zero failures and calling that pair identical would read as an all-clear for the
  cancellation. Both boundaries are documented in the README rather than left to be
  discovered.
- **`parseTwoFileArgs` in `src/cli.ts`**, the two-file argument shape, shared by `diff`
  and `compare`. It was `parseDiffArgs`; a second two-file command would have grown a
  copy of the same parsing, which is how two commands start disagreeing about what a
  valid command line is.
- **Test suite for slice S9** (Vitest, 25 further tests, 420 total): both example pairs
  in both directions, the status-only difference, two clean but unrelated runs comparing
  identical, the `shifted` verdict with its reason, the row ordering rule, the null side
  for a class that never occurred, every counter reconciled against the `errors` and
  `tools` reports, the stable key order of both output modes, byte-stability across every
  pair, every `compare` exit code, and that the terminal output shown in the README is
  what the command actually prints.
- **`trace errors FILE` command** (`src/errors.ts`, `src/report.ts`, `src/cli.ts`).
  Aggregates one validated trace by failure: every error class with its count, the
  event types that produced it and the lines and event ids where it appears, then every
  single occurrence with its event id, related event id, tool or model and message.
  `summary` counts errors on one line and `tools` says which tool misbehaved; neither
  answers "what went wrong, how often, and on which line", which is the question a
  reader has after either of them.
- **Guardrail refusals reported apart from errors** (`src/errors.ts`). The schema says a
  guardrail refusal must not be counted as a tool error, because the call was blocked on
  purpose rather than breaking. `errors` therefore tallies refusals separately and
  states `failures` as the two together, so the header reconciles against the class
  table and the occurrence list, both of which total `failures`. Summing the two would
  rank a designed block above a real crash.
- **`dangling_references`, the `related_event_id` values that point nowhere**
  (`src/errors.ts`). Every `error.recorded` may name the event it relates to, and
  nothing checked that the named event exists. The whole file is read before the check,
  so a reference pointing forwards is accepted. `validate` does not do this: it checks
  one line at a time plus the invariants it owns, and a broken cross-event link is a
  failure-triage question rather than a schema question.
- **`readRunOutcome` in `src/analyze.ts`**, the run status and terminal event id,
  extracted out of `summarize` so `errors` and `summary` cannot disagree about how a
  run ended. `errors` needs the status in its header because a report that says zero
  errors on a run that was cancelled reads like an all-clear.
- **The distribution primitives moved to `src/analyze.ts`** (`Distribution`,
  `byCountThenValue`, `distribution`, `bumpCount`). They lived in `src/tools.ts`, and a
  second command that orders distributions the same way would have grown a second copy
  of the same rule, which is how two commands start disagreeing about order.
- **Test suite for slice S8** (Vitest, 39 further tests, 395 total): every example's
  failure counts hand-checked against the file, the header reconciling with the class
  table, the refusal split, `fatal` only on `error.recorded` and null on the event types
  that have no such field, the tool / model split, class and occurrence ordering, the
  dangling-reference check in both directions, the bucket for a failure with no error
  class, `run.cancelled` not counting as a failure, the stable key order of both output
  modes, byte-stability across every example, every `errors` exit code, and that the
  terminal output shown in this README is what the command actually prints.
- **`trace tools FILE` command** (`src/tools.ts`, `src/report.ts`, `src/cli.ts`). Aggregates
  one validated trace by tool: how often each tool was called, how each call ended, which
  guards blocked the failed ones, and which effects the completed ones left. `summary`
  answers how the run went and `timeline` answers in what order things happened; neither
  answers which tool was the problem, and that is the question a reader has after either
  of them. Rows are ordered by call count so the tool the reader came to ask about is at
  the top, and every row carries the first and last line and event id where the tool
  appears, so it can be followed back with `show`.
- **The declared tool set, surfaced for the first time** (`src/tools.ts`). `run.started`
  has carried `config_summary.tools` since the spike forced it into the schema, with an
  `available` flag whose whole purpose is to explain why a tool was never called, and no
  command printed it. `tools` does: the declared set in the order it was declared, the
  declared tools that went unused, and the tools that were invoked without being
  declared. `undeclared` stays empty when the recorder declared no tool set, because with
  nothing declared no call can be called undeclared, and filling it with every tool that
  was called would read like a finding when it is an absence.
- **`unresolved`, the calls that neither completed nor failed** (`src/tools.ts`). Computed
  as `calls - completed - failed` rather than by pairing events, because a completed tool
  call does not carry the `tool_call_id` of the start it answers, so the two cannot be
  matched line by line. A negative value is reported as-is rather than clamped, because a
  trace that resolves more calls than it starts has a real inconsistency in it, and hiding
  it behind a zero would make the report lie.
- **Test suite for slice S7** (Vitest, 41 further tests, 356 total): every example's
  counters hand-checked against the file, the unresolved arithmetic in both directions,
  guards collected only from failed calls, effects only from completed ones, distributions
  ordered by count then value, rows ordered by calls then name, the declared / unused /
  undeclared split, the declared set surviving an entry with no name, the bucket for a tool
  call whose payload carries no tool name, permission events not counting as calls, the
  stable key order of both output modes, byte-stability across every example, every `tools`
  exit code, and that the terminal output shown in this README is what the command actually
  prints.
- **`trace show FILE [--event ID]` command** (`src/show.ts`, `src/report.ts`,
  `src/cli.ts`). Prints one event in full, or every event when `--event` is omitted:
  its line number, model-round step, offset from the first event, its type, the same
  one-line description `timeline` prints, and its payload exactly as the recorder wrote
  it, key order included. `show` is the command that answers the question every other
  command raises when it cites an event id: what does that line actually say. An event id
  the file does not carry is reported as not found rather than as an empty report,
  because an empty report reads like "this run had no events".
- **Test suite for slice S6** (Vitest, 27 further tests, 315 total): selection by id and
  in full, the not-found path, the payload surviving with its key order, nested objects
  on one line and a JSON `null` as `null`, the empty payload, the stable key order of
  both output modes, byte-stability, every `show` exit code including `--event` on an
  id the file does not carry, and that `--event` stays an unknown option for the other
  commands. The heaviest test compares `show` against `timeline` over every event of
  every example, because the two commands share one description of where an event sits
  and a disagreement there would make the same line number mean two things.
- **`annotateEvents` in `src/analyze.ts`**, the position facts every per-event report
  needs (file line, model-round step, offset, own duration). Extracted out of
  `buildTimeline` rather than copied, so `timeline` and `show` cannot disagree about
  where an event sits; a test compares the two over every event of every example.
- **`trace explain FILE` command** (`src/explain.ts`, `src/report.ts`, `src/cli.ts`).
  Reduces one validated trace to evidence-bound observations and reports how the run
  ended. Each observation names the event that supports it and the line that event sits
  on, so any claim in the report can be traced back to one line of one file. The order
  is fixed rather than file order, because a reader wants the outcome first: the
  terminal event, then everything that failed or was refused in file order, then the
  last thing the model said. Each observation reuses the one-line description
  `timeline` prints, so the two commands cannot describe one event two different ways.
  `findings` stays empty unless a model produced them, `unverified` is deterministic,
  and the two are never mixed. Without `--model` the whole report is deterministic: no
  network, no API key, same bytes every time.
- **The model layer** (`src/model/`), optional and off by default. Nothing in `src/`
  reaches the network unless `explain --model` is typed. `OpenAICompatibleClient`
  speaks the OpenAI chat-completions dialect over `fetch`, because gateways and local
  servers implement the same shape and the caller has already chosen the base URL. It
  makes exactly one request and never retries: a retry is a second charge the caller
  did not ask for, so a failed call is reported as a failure instead. The key is read
  from `OPENAI_API_KEY` and travels only as a bearer header.
- **One answer contract in two roles** (`src/model/contract.ts`). The same contract
  object is sent to the model as `output_contract` and compiled to check what comes
  back. Sending one shape while enforcing another would let the two drift, and a
  drifted contract is worse than none, because the report would still look validated.
- **Fabricated evidence is rejected whole** (`src/model/answer.ts`). A finding must cite
  at least one event id, and that id must exist in the trace. An answer citing an id
  which is not in the file is refused in its entirety rather than having the offending
  finding quietly dropped, because a fabricated citation is the one model failure that
  would otherwise read as a perfectly ordinary report. The check uses every event id in
  the trace, not only the quoted ones, so a finding may cite an event that exists but
  was not sent.
- **A bounded excerpt, not a file dump** (`buildExcerpt` in `src/explain.ts`). One
  request carries the task statement, the contract, the observations and the events
  those observations cite, capped at `--max-excerpt N` (default 50). Events past the cap
  are named in `unverified` but not sent, so nothing is hidden, only unquoted. The trace
  file's own path is omitted unless `--send-paths` is passed.
- **Exit codes `65` and `69`** for the model half: `65` when the model answered but its
  answer could not be used, `69` when no usable answer was obtained at all. A model
  failure keeps the deterministic observations and exits non-zero; it is never presented
  as a successful explanation. Not being able to name a model is `64` rather than `69`,
  because nothing was attempted.
- **`ajvErrorPath` exported from `src/schema.ts`**, the helper that renders an Ajv error
  as a JSON pointer. It was private to `validate.ts`, and `answer.ts` needs the same
  pointer for a contract violation, so it moved rather than being copied.
- **Test suite for slice S5** (Vitest, 67 further tests, 288 total): observation order
  and evidence binding, the excerpt cap and its overflow note, the deterministic
  `unverified` entries, byte-stability of the whole report, the terminal output shown in
  the README compared against what the command actually prints, the answer contract
  including every rejection reason, and real HTTP round-trips against a local
  `node:http` stub proving the success, non-2xx, no-content, malformed-answer,
  connection-refused and timeout paths. The CLI suite covers every `explain` exit code
  in both output modes, and `--model` against that stub with the endpoint and key
  injected through the environment.

- **Mini agent spike** (`spike/`, `bin/spike-run`, `tsconfig.build.json`). A development
  tool, not part of the published CLI. It builds a throwaway sandbox with
  three synthetic notes, runs a five-step agent inside it, writes the trace and then
  validates that trace with this tool's own loader, schema and cross-line invariants
  before reporting success. The model is a `ScriptedModel` replaying a fixed plan, so
  a run makes no network call, needs no API key and costs nothing. `ModelProvider` in
  `spike/model.ts` is the seam a real provider plugs into; nothing else changes when
  one does. `spike/SCHEMA_REVIEW.md` records what the first real trace could not
  express and what changed because of it.
- **A real example trace**, `examples/spike-run.jsonl`: 22 events, `run_spike_05`, five
  model turns, four tool calls, one approved permission, terminal `run.finished`. It
  is the output of a real run on 2026-10-14, so its timestamps and durations are real
  wall-clock values and a regeneration never produces identical bytes. Tests assert
  its structure, not its bytes.
- **`effect_disposition` on `tool.call.completed`**, the field slice S1 deferred to
  exactly this point. `none` for a read-only call, `applied` when the call completed
  and its side effect is in place, `unknown` when it did not complete cleanly so a
  side effect may or may not be there. The source evidence recorded the pair
  `{none, unknown}`; `applied` is added because that pair cannot answer "did this run
  change anything". Each tool declares its disposition once, on `ToolDefinition.effect`,
  and the agent loop copies it in one place.
- **`capture` and `output_summary` on `model.response.completed`**. `capture` is
  `inline`, `inline_from_stream` or `db_ref` and says where the response body lives;
  `output_summary` carries a short body when the capture is inline. Absent `capture`
  means the recorder kept no body, which is also the correct reading of a turn that
  only called tools.
- **`role`, `slot_label` and `streamed`** on `model.request.started` and
  `model.response.completed`. `role` is `main`, `reference` or `aggregator` and
  identifies which model slot a turn belongs to; `slot_label` is a free label;
  `streamed` reports whether the response arrived incrementally.
- **`path_escape` in the `guard` enum**. A probe run asked `read_file` for a path
  outside the sandbox and the refusal came out with no `guard` value at all, because
  none of the seven values taken from that agent covers "outside the sandbox". A reader
  scanning guard statistics would never have seen the attempt.
- **Tool availability and schema hash at run start**, in
  `run.started.payload.config_summary.tools`: each entry is
  `{name, schema_hash, available}`. This answers "why was this tool never called",
  which the source evidence names as a question a trace cannot otherwise answer. It
  reuses the existing open `config_summary` object rather than adding a fifteenth
  event type.
- **`result_bytes` documented in the schema**: the size of the full result body the
  tool produced, before truncation. It measures the result, not the thing the tool
  acted on, so a write tool reports the size of its confirmation and not of the bytes
  it wrote. The real run exposed that ambiguity; the semantics did not change.
- **`effect_disposition` in the `timeline` description**, so a completed call renders
  as `tool result: write_file; 26 bytes; effect applied`.
- **Bundled schema lookup now walks up from the module** instead of using a fixed
  relative URL. The sources sit one level below the project root and the compiled
  output sits one or two levels below it depending on `rootDir`, so no single
  relative path serves both. A missing schema now fails with a clear message instead
  of a confusing `ENOENT`.
- **Test suite for slice S4** (Vitest, 55 further tests, 221 total). The recorder's id
  sequence, single run id, non-decreasing timestamps and clock-back clamping; the
  canonical schema hash (including a regression test for the collision below); sandbox
  escapes and the `path_escape` guard; listing, reading, writing, truncating and
  missing files; the five-step event sequence in full; effect dispositions; the
  permission decision landing before the call starts; the tool set recorded at run
  start with the withheld tool visible; `capture` absent on text-free turns; the step
  limit producing `run.failed`; unknown, withheld and throwing tools; the argument
  summary; every `spike-run` exit code including the injected validation failure and
  the sandbox cleanup; and the committed example, whose structure and timeline
  rendering are asserted. The schema-rejection suite grows by six cases covering the
- **A regression test that the committed example still matches the code** that
  produces it. `examples/spike-run.jsonl` was generated before the argument-summary
  fix landed, so it kept the multi-line `write_file` content and a `trace timeline`
  over it wrapped one row across two lines. The example is regenerated, and the test
  asserts every `args_summary` in it is a single line so the artifact cannot drift
  from the code again unnoticed.

- **`trace diff FILE FILE` command** (`src/diff.ts`, `src/report.ts`, `src/cli.ts`).
  Compares two JSONL trace files and reports every difference: the run identity, the
  summary counters and the events themselves. Events are aligned by `event_id`; an
  event present on one side only is reported as added or removed with its line number,
  and a changed event lists every differing leaf as a JSON pointer, with `absent` for
  a field that exists on one side only. The compared content of an event is its `type`
  and `payload`: `timestamp` and `run_id` are run-specific and cannot produce a
  meaningful per-event difference, so the run identity is reported once instead. The
  summary comparison covers every `summary` counter except the report metadata and
  the wall-clock `started_at` / `ended_at` instants, which differ between any two
  runs; `duration_ms` carries the timing signal. No event is ever re-paired across
  the two files: the tool reports structure, not a semantic merge. Both files are
  validated first, so an invalid trace is reported with the errors `validate` prints
  and exits `1` instead of being compared. Exit code `1` means the traces differ, `0`
  that they are identical.
- **Stable `--json` diff report**: keys `command`, `schema`, `files`, `events`,
  `identical`, `changes`, and per change `kind`, `field`, `event_id`, `type`,
  `line_a`, `line_b`, `a`, `b`, `fields`, always in that order; per field change
  `path`, `a`, `b`. Terminal output groups changes into `run`, `summary` and `events`
  sections, uses `+` / `-` / `~` markers, and pads columns to the widest entry in the
  report, never to the terminal.
- **Shared argument scanner** in `src/cli.ts`: `validate`, `summary`, `timeline` and
  `diff` accept the same `--schema`, `--json` and `--help` options from one option
  loop; the two thin wrappers differ only in how many positional files they require.
- **Test suite for slice S3** (Vitest, 31 further tests): the diff reports identical
  input as identical, ignores wall-clock timestamps, compares token totals, status,
  model lists and duration without the start and end instants, aligns events by id,
  reports added and removed events with their line numbers, reports changed payload
  fields with their JSON pointers including fields present on one side only and type
  changes, compares arrays as whole values while ignoring object key order, orders
  changes deterministically, keeps JSON keys stable and output byte-identical, and
  reproduces the success-versus-failed example comparison by hand (37 changes). The
  CLI covers every exit code for the new command, both output modes, validation
  failures on either side, and unreadable inputs.
- **`trace summary FILE` command** (`src/analyze.ts`, `src/report.ts`, `src/cli.ts`).
  Aggregates one trace file: run status, duration, event counts, model call counts,
  tool call counts, permission decisions, recorded errors and token totals. Terminal
  output is aligned `label value` lines; `--json` carries the same fields with stable
  keys. The file is validated first, so an invalid trace is reported with the errors
  `validate` prints and exits `1` instead of being summarized.
- **`trace timeline FILE` command** (same modules). One line per event in file order,
  each with its line number, event id, offset from the first event, its own duration
  and a one-line description. Events are grouped into model-call steps: the step
  advances on every `model.request.started`, so a reader sees which round asked for
  which tool call. Text columns are padded to the widest cell in the report, never to
  the terminal.
- **Deterministic analyzer** (`src/analyze.ts`). `summarize`, `buildTimeline` and
  `describeEvent` are pure functions over loaded events: no clock, no file system, no
  network, so the same input always produces the same report. `describeEvent` renders
  only the fields the recorder actually wrote, so a missing optional field never
  surfaces as `undefined` or `null`, and it marks a guardrail refusal apart from a
  real tool failure.
- **Shared command-line parsing** in `src/cli.ts`: `validate`, `summary` and
  `timeline` accept the same `FILE`, `--schema` and `--json` arguments and the same
  exit codes, built from one usage template.
- **Test suite for slice S2** (Vitest, 35 further tests): the analyzer reproduces all
  three examples by hand (counts, durations, token sums, status, refusal versus real
  failure), describes every event type without placeholders, keeps line numbers when
  blank lines are skipped, numbers steps by model round, and stays byte-stable. The
  CLI covers every exit code for both new commands, both output modes, `--schema`, and
  byte-identical output for identical input.
- **`trace validate FILE` command** (`src/`, `bin/trace`, `tsconfig.build.json`).
  Reads one JSONL trace file and reports every problem it finds, with the file, the
  1-based line number, the event id and the reason. Cross-line invariants are checked
  alongside the schema: `duplicate_event_id`, `timestamp_order` and `single_run_id`.
  `--schema FILE` validates against a caller-supplied JSON Schema (draft 2020-12)
  instead of the bundled one, which is how CI pins a trace contract. A schema in
  another dialect is refused rather than mis-read.
- **Exit codes, now real rather than planned**: `0` every event validates, `1`
  validation failed, `2` the trace file or the schema file could not be read, `3` the
  report could not be written, `64` the command line could not be understood. `64` is
  `EX_USAGE`, added because a mis-typed command is not any of the other four.
- **Loader** that reports unreadable files, empty files, invalid UTF-8, a UTF-8 byte
  order mark and non-JSON lines. Each case names the file and, where one exists, the
  line number. A byte order mark is reported explicitly instead of being silently
  dropped by the text decoder and turning into unrelated schema errors.
- **Stable `--json` report**: keys `command`, `file`, `schema`, `events`, `valid`,
  `errors`, and per error `line`, `event_id`, `check`, `path`, `keyword`, `message`,
  always in that order. Terminal output uses no escape sequences and never depends on
  terminal width.
- **Trace event schema, version 1** (`schemas/trace.schema.json`, JSON Schema draft
  2020-12). Fourteen event types across the run, model, tool, permission, context and
  error families. Strict base fields with no unknown top-level keys, per-type payload
  contracts, and payload-level extension for recorders. Cross-line rules that a schema
  cannot express (event id uniqueness, timestamp order, one run id per file) are
  documented as validator work for the next slice.
- **Three synthetic example traces**: `examples/success.jsonl` (19 events, completed),
  `examples/failed.jsonl` (26 events, failed; one guardrail refusal, two real tool
  failures, one model retry), `examples/cancelled.jsonl` (8 events, cancelled after a
  denied permission). Together they cover all fourteen event types.
- **Test suite** (Vitest, 48 tests): every example line validates against the schema;
  event ids are sequential and unique; timestamps are non-decreasing; each file has
  one run id; the three examples cover all fourteen types; the cancelled example
  carries no error events; and the schema rejects missing required fields, wrong
  types, bad enums, malformed ids, unknown top-level fields and negative token counts.
- **Test suite for slice S1** (Vitest, 52 further tests): the loader covers empty
  files, whitespace-only files, missing files, directories, invalid UTF-8, a byte
  order mark, non-JSON lines with their line number, permission failures, blank lines
  that must not shift line numbers, CRLF endings, and a JSON line that is not an
  object. The validator covers required members, wrong types, bad enums, unknown
  top-level fields, malformed event ids and each cross-line invariant. The CLI covers
  every exit code, both `--json` and terminal output, custom and uncompilable schemas,
  and byte-identical output for identical input.
- **Project skeleton**: `package.json`, `tsconfig.json`, `.gitignore`.

### Changed

- **The model section gained a row, so every row in it moved** (`src/report.ts`).
  Labels are padded to the widest label in the section, and `redacted fields` is wider
  than `events sent` was, so each row of every model section gained three columns of
  padding and the terminal output changed shape without any command's answer changing.
  The README's three `--model` blocks were regenerated from real CLI output, and their
  `bytes sent` figures moved with the longer task statements: `eval-gen` 7061 to 7389,
  `fix-suggest` 7057 to 7385, `compare` 9923 to 10251. The counts are printed by the
  command before the request leaves, so they do not depend on the provider's answer.
- `src/cli.ts`'s `main` returns a promise and `bin/trace` assigns `process.exitCode`
  from it. Only `explain` awaits anything; every other command stays synchronous, so
  the dispatch did not have to be split.
- `tsconfig.build.json` uses `rootDir: "."` and builds `src` and `spike` into
  `dist/src` and `dist/spike`. `bin/trace` imports from `dist/src/cli.js`. The spike
  imports from `src/`, so the two trees cannot be built with separate roots; the
  bundled-schema lookup change above is what makes the new layout work.
- `describeEvent` renders `effect_disposition` on a completed tool call. Fields the
  recorder did not write still stay absent rather than becoming a default.
- `ValidationReport.command` is a string rather than the literal `"validate"`, and
  `validateEvents` / `reportForInputFailure` take the command name, so `summary`,
  `timeline` and `show` reuse the validation report shape for a trace they refuse to
  read.
Exit code `1` gains a second meaning, documented per command: for `show` it also means
`--event` named an event id the file does not carry. The code set itself does not grow.
- Exit code `1` gains another meaning, documented per command: for `compare` it also
  means the two failure profiles differ. The code set itself does not grow.
- `README.md`'s status block said "slice S6" and claimed `tools` and `errors` did not
  exist yet, two slices after both had landed; it now names slice S9 and every
  implemented command.

- `README.md` and `package.json` both described the tool as read-only, which stopped
  being true the moment `eval-gen --out` could write a file. The opening line, the
  status block and the `Boundaries` section now make the promise per command instead of
  for the whole repository, and name the one exception and what it refuses to do.
- Exit code `3` gains a second meaning, documented per command: for `eval-gen` it also
  means the cases were produced and the file could not be written. The code set itself
  does not grow.
- The shared exit-code block lost its leading space on the `2`, `3` and `64` lines, so
  every usage message printed three of its five codes out of column with the other two.
  A list that reads as two lists is a list a reader has to reconstruct.
- **The compare instruction positions are pinned by byte equality**
  (`tests/compareModel.test.ts`, `tests/cli.test.ts`). Both checks on the compare task
  statement looked for the evidence convention inside it with `toContain`, which passes
  whatever else the statement carries -- and a statement a payload could add to is not a
  constant. The draft-level check and the check on the bytes that actually left the
  machine now compare against `COMPARE_TASK` itself, and the wire-level check pins
  `COMPARE_SYSTEM_PROMPT` as well, so all four model halves have both instruction
  positions asserted byte for byte.
- **The version is cut to `0.1.0`** (`package.json`, `README.md`, `CHANGELOG.md`,
  `tests/package.test.ts`). The manifest carried `0.0.0` since the skeleton, which is not
  a version anybody chose, and `npm pack` turned it into a tarball name -- so the packed
  artifact was named for a release decision that had not been made, and the README's
  install command spelled that name out. The manifest now carries the version the plan's
  freeze node names, the README names the tarball `npm pack` actually produces, and the
  changelog's newest released entry is that version. Three assertions hold the three
  files together, because the version is written in three places and a bump that reaches
  one of them is a doc that names a file nobody can install. The suite stands at 624
  tests.
- The README's status line said "early development (slice S16)" while the file went on to
  describe slices S17 to S19, and the S17 note carried S18's test count. The line now
  names the version being cut, the count is S17's own, and the two missing slice notes
  are written, so the block describes this version rather than the slice it was last
  edited at.
- The packed-surface claim named four entries and then said "and nothing else", while
  `npm pack` also always puts `README.md` and `package.json` in the tarball. The claim is
  what a reader checks an installed copy against, so it now lists the two npm adds rather
  than leaving a reader to find files the sentence said were not there.

### Fixed

- **The release-tree text carried a third-party project name and internal document
  paths.** A pass over the whole candidate release tree -- not only the word list the
  publication channel scans -- found another project's name in four files
  (`schemas/trace.schema.json`, `README.md`, this file and `spike/SCHEMA_REVIEW.md`,
  ten occurrences in all) and internal document paths in `ASSETS.md` and
  `spike/SCHEMA_REVIEW.md`. The clean-room scan could not have reported either kind:
  its word list carries machine names, private paths and vendor names, but neither a
  project name of this shape nor a document path, so its zero-hit result said nothing
  about them. Both are now described rather than named -- the other project is called
  "a comparable agent implementation", and each internal path says what the document
  is instead of where it lives. The manifest's references to internal planning labels
  and to the internal asset register were reworded the same way.
  > **Correction, 2026-10-15, same round.** The first version of this bullet called
  > the name "a real company name". That was wrong: it is the name of an open-source
  > agent project, the object the reverse-engineering notes describe, and its
  > resemblance to a private email domain is a coincidence. Under the rule already
  > registered for third-party names, descriptive mention is permitted and only this
  > work's own name has to stay neutral, so removing it was a conservative choice
  > rather than a requirement. What the round did establish is the part that matters:
  > a zero-hit scan cannot prove the tree self-contained, because the list carries
  > neither kind of string.
- **`ASSETS.md` claimed nothing in the package fetches anything.** The opt-in `--model`
  path sends a request when both a flag and a key are given, so the sentence was false
  as written, and the same file already said so two rows above it. It now states what
  is true: nothing is fetched at build, render or documentation time, and the one
  outbound request the code can make needs both a flag and a key.
- **The asset manifest's tarball breakdown did not add up.** It stated 29 files and
  then listed parts summing to 31: `dist/src/**` was written as 26 files where the
  build emits 24 (one per source file, counted in `dist/`), and `CHANGELOG.md` was
  described as one of npm's implicit includes when it is in the `files` whitelist
  itself. The measured total is unchanged; the parts now reconcile with it.
- **The release surface no longer names a real model.** The `explain` stub and the
  README's `--model` example both used `gpt-5-mini` as the model name, a real product
  name in a package whose model names are invented placeholders -- the spike's scripted
  model is `stub-model-1` in every committed example. Both now say `stub-model`, and the
  README's output blocks are unaffected because none of them carried the name.
- **`spike/` was called internal in eight places while shipping in the repository.**
  The first clean-room pass over the whole tree, not just the README, found the word in
  the README, `package.json`, `bin/spike-run`, `spike/cli.ts`,
  `spike/SCHEMA_REVIEW.md` and this file.
  A member the repository structure table documents, whose schema review the README
  links to, and whose suite `npm test` runs cannot be described as not-for-outside-eyes.
  The claim that was always true -- `spike/` is not part of the published CLI, because
  the packed tarball's `files` list does not carry it -- is what the wording now says.
- **The README stated a Node 20 fact that measurement had overturned, in a sentence
  that had lost its verb.** The CI section read "The Node 20 leg: no machine this tree
  has been run on Node 22 alone" -- a broken sentence, and wrong: this tree was run
  green on Node 20.14.0 and Node 22.23.3, `npm ci` / `typecheck` / the full suite (624
  tests in 23 files on each leg) / `build` all exit 0, on a second machine on 2026-10-15
  against the same lockfile. `engines: >=20` is a tested fact for the versions measured
  and an intent for the rest; Node 26 anywhere on the tree remains unmeasured. The
  release notes carried the same claim ("has not been run on Node 20") and now carry the
  measurement, including the one `EBADENGINE` warning Node 20's install prints about a
  dev dependency's own range.
- **Two tools with different contracts hashed identically.** The first real spike run
  gave `list_dir` and `read_file` the same `schema_hash`. The canonicaliser was
  `JSON.stringify(parameters, Object.keys(parameters).sort())`, whose second argument
  is a recursive key allowlist rather than a sort: it dropped the nested `description`
  fields and `max_bytes`, which is exactly what tells the two schemas apart. Replaced
  with a recursive canonicaliser, with a regression test.
- **Truncation could be silent.** Reading a 500-byte file with `max_bytes: 10`
  reported `truncated: true` with no `[truncated]` marker, because the marker was only
  added when the summary exceeded the tool's own result cap. The schema promises
  truncation is never silent, so the marker is now added whenever the body was clipped
  by either cap.
- **`--steps=3` was rejected as an unknown option.** The inline `--out=` /
  `--workdir=` handling fell through to the unknown-option branch after a successful
  match. `--steps=N` is now accepted alongside them.
- **`capture: "inline"` was written on turns that produced no text**, claiming a body
  in an event that has none. The recorder now omits `capture` when the turn only
  called tools.
- **The argument summary could span multiple lines.** `summariseArgs` passed a string
  value through verbatim, so a tool argument carrying newlines (the `write_file`
  content in the real run) put literal line breaks into `args_summary` and wrapped the
  `timeline` row across two lines. Whitespace runs are now collapsed to single spaces
  before the length clip, keeping the field on one line as its "short human-readable
  summary" contract requires.
- **The committed example did not carry that fix.** `examples/spike-run.jsonl` was
  generated before `summariseArgs` changed, so it still held the multi-line
  `write_file` content and a `trace timeline` over it wrapped one row across two
  lines, while the changelog above already claimed the fix. The example is
  regenerated; its structure is unchanged (22 events, same ids, same payload fields),
  only the stale `args_summary` and the wall-clock timestamps differ.
- **The self-check leaked a temp directory per invocation.** `defaultValidation`
  writes the produced trace to a temp file so the loader can read it back, and never
  removed the directory. Nothing reaped it, and 61 had accumulated under the OS temp
  directory by the time this was found. Now removed in a `finally`, so it goes away
  on the failure paths too, with a test that counts the prefix before and after.

### Documentation

Slice S16 was a consistency pass over `README.md` and `CHANGELOG.md` themselves -- the
two files a reader trusts to say what the code does. Nothing in `src/`, `tests/`,
`schemas/` or `examples/` changed, and the suite still reports 586 tests.

- **A paragraph printed twice.** The `tests/` row of the repository table repeated the
  whole compare-model suite description sentence for sentence, so the row read as
  though two such suites existed. The second copy is gone.
- **A sentence that stopped mid-word.** A `Boundaries` bullet about the answer contract
  ended in a bare "A", a dangling article with nothing left to attach to. It now ends
  where the sentence ends.
- **Two entries listed twice.** The `trace fix-suggest FILE` entry appeared on two
  consecutive lines, and the "exit code `3` gains a second meaning" entry appeared
  twice, the second copy after a blank line that made it read as a new thought. Both
  duplicates are removed.
- **The inventory had a hole where slice S12 belongs.** `src/evalGenModel.ts` and its two
  renderers are the model half of `eval-gen`, and every other model half is listed;
  this one was skipped, so the table read as though a file that exists does not. Added,
  together with the missing slice S12 block.
- **Slice S13's preamble described half of its own table.** It said "the deterministic
  half of the last planned command" above rows that already included the model half's
  files. Split into S13 and S14 blocks, so each preamble matches the rows under it.
- **`docs/` went unmentioned.** The independent verification record lives in a
  top-level directory the README never named. Added to the repository table, with what
  it does and does not establish.
- **A table whose separator declared a column its header does not have.** The model flag
  table's separator row carried four cells under a three-column header, so the row a
  renderer draws the grid from disagreed with the row that names the columns. Now three,
  like the header above it.

### Not in this slice

- The redaction rule is names, not value shapes. A credential under a key whose name says
  nothing about it is sent, and nothing guesses a secret from what a value looks like: a
  fuzzy rule would be a boundary nobody could review, and the analyzer already refuses to
  infer. The list of names is the whole boundary, and the README prints it.
- `eval-gen --model` reviews the cases that were generated; it does not generate
  different ones. A model is told not to rewrite an expectation and not to propose a case
  the trace does not support, so the command answers "is this assertion standing for more
  than one failure" and not "write my test suite".
- No license yet; that is a project-level decision, deferred.
  > **Correction, 2026-10-15, later the same day.** It was decided: Apache-2.0, the full
  > text is at the repository root as `LICENSE`, and the entry at the top of this section
  > records it.
- No `README.zh-CN.md`; deferred to packaging.
  > **Correction, 2026-10-15, later the same day.** It exists, and it states the same
  > commands, exit codes and boundaries as the English README.
- No model call anywhere in the spike. `ModelProvider` is still the seam, and the spike
  still replays a scripted plan; `explain --model` is where the product side reaches a
  model.
- The live provider path has never been called. Every model test talks to a local stub
  server, so the request shape is verified against a stub and not against an endpoint.
  The first real call spends the user's quota and is theirs to make.
- `maxRequests` from the design draft is not implemented. This slice makes exactly one
  request and never retries, so the knob would have no behaviour.
- One provider only, `openai-compatible`. No streaming, no model-side tool use, no
  multi-turn conversation, and no accounting of what the call cost.
- No cost accounting, no `trace.dropped` observability, and no multi-slot attribution:
  nothing in this slice exercised them, so the schema does not claim them.
- No `bin` entry and no publish. The version is cut to `0.1.0` here, but the command name
  and the release decision are still open, so no `bin` key ships: it would publish the
  placeholder `trace` as though it were the name. `npm pack` and a local install are
  verified; publishing and tagging are not attempted.
  > **Correction, 2026-10-15, later the same day.** The name is decided, so the `bin` key
  > exists and carries `trace-doctor`; what is still true is the second half -- `npm pack`
  > and a local install are verified, publishing and tagging are not attempted. The
  > tarball's file list also grew: `README.zh-CN.md` and `LICENSE` ride along as npm's
  > always-included members rather than through `files`.
- The workflow has never run, so its Node 20 leg has never run either. That is not the
  same as the tree not running on Node 20, and this bullet used to say it was: the tree
  was measured green on Node 20.14.0 and Node 22.23.3 by hand on a second machine, which
  the "Fixed" section above records. What remains unproven is the workflow itself --
  GitHub reads workflows only from the root of the repository it builds, so this one is
  inert while the package sits inside another repository, and the account's Actions is
  unavailable. `engines: >=20` is a tested fact for the two versions measured and an
  intent for every other version in range, Node 26 included.
- The version cut is not a release, and nothing above it should be read as one. `0.1.0`
  names this tree; the command name, the license, the Chinese README and the decision to
  publish are all unchanged by it.
  > **Correction, 2026-10-15, later the same day.** The first sentence stands and the
  > second no longer does: the command name, the license and the Chinese README were all
  > decided and folded into this version, so they are changed by it. What is still
  > unchanged is the decision to publish -- no public repository, no tag, no release and
  > no npm package exists.
