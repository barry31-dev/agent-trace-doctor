# Release notes

> **v0.1.0 was released on 2026-10-16** as a public repository, an
> annotated tag and a GitHub release at
> https://github.com/barry31-dev/agent-trace-doctor. `CHANGELOG.md`
> records what was built, slice by slice; this file records what a
> reader of that release is entitled to rely on, which is a different
> claim.
>
> The package is not published to npm, and this version is not planned to
> be. What "open source" means here is the GitHub release named above; an
> npm package is a question for a later version.

> The command name is `trace-doctor` and the license is Apache-2.0. Both
> were decided after the slices below were written, and the notes that
> described them as open have been corrected rather than left to
> contradict the manifest.

## v0.1.0

### What this is

A command-line tool for inspecting, validating and comparing agent run
traces. Every command reads a trace and prints a report and changes
nothing on disk; `eval-gen --out` is the one exception, and it writes
only the file it was told to write. `--model`, on the four commands that
take it, is the only thing in this repository that opens a network
connection, and it is off unless it is typed.

### How to run it

The command is `trace-doctor`. From a checkout it is run by path, because
a checkout has not been installed:

```bash
npm install
npm run build
./bin/trace validate examples/success.jsonl
```

A packed copy runs by command name, because the `bin` entry is what an
install puts on the `PATH`:

```bash
npm pack --pack-destination /tmp
mkdir /tmp/td-clean && cd /tmp/td-clean && npm init -y
npm install /tmp/agent-trace-doctor-0.1.0.tgz
trace-doctor validate /absolute/path/to/examples/success.jsonl
```

Exit codes: `0` the report was delivered, `1` validation failed or a
difference was found, `2` the trace or the schema file could not be read,
`3` the report could not be written, `64` the command line could not be
understood, and `65` / `69` for the two ways a model answer can fail,
which only the four `--model` forms can produce. Each command's section
in `README.md` lists the codes it can return.

### What has been measured

Run results, with the interpreter and the date, not estimates.

- **The suite: 624 tests in 23 files, all passing**, on Node **22.22.1**
  with npm **10.9.4** (2026-10-15), on the tree this file ships in.
  `npm run typecheck` and `npm run build` both exited `0` on the same
  interpreter the same day, before the documentation-only edits that
  produced this file; no TypeScript has changed since.
- **A packed copy installs and runs**: `npm pack`, an install into an
  empty directory and one command from the installed copy, all exit `0`
  (2026-10-15, same interpreter).
- **Three further Node versions ran an earlier tree green**: `20.14.0`,
  `22.23.3` and `26.11.1`, each with `typecheck` and `build` exit `0` and
  **579 tests** passing (2026-10-15, a second machine). That tree was
  slice S14, before the slices that took the count to 624, so it is
  evidence about that tree and not about this one.
- **This tree ran green on Node 20 and Node 22**: `20.14.0` and
  `22.23.3`, each with `npm ci`, `typecheck`, the full suite --
  **624 tests in 23 files** -- and `build` exiting `0` (2026-10-15, a
  second machine, the same lockfile before and after). Node 20's
  `npm ci` printed one `EBADENGINE` warning about a dev dependency's
  declared range; it is a warning, the install completed, and the
  suite it drives passed.
- **The CI workflow has never run.** `.github/workflows/ci.yml` exists
  and its steps were checked locally for what can be checked without a
  runner -- the file parses as YAML, every `run:` block parses as bash,
  `npm ci` resolves against the lockfile, and each command exits the
  number the workflow asserts -- and it is live in this repository. It
  was inert while this package sat inside another repository, because
  GitHub reads workflows only from the root of the repository it builds;
  its first execution here is still pending, and the account's GitHub
  Actions was unavailable when this repository was published.

### What has not

- **No real provider has ever been called.** Every model test talks to a
  local stub server, so the request shape is verified against a stub and
  not against an endpoint. The first real call spends the user's quota
  and is theirs to make.
- **Node 26 anywhere on this tree**, and every other version in range:
  `engines` says `>=20`, which for this tree is tested at `20.14.0` and
  `22.23.3` and an intent for the rest.
- **No trace from a real agent run** except the mini agent spike's own;
  the three files under `examples/` are synthetic.
- **macOS on arm64 only.** No other platform has run this.
- **Nothing is published outside GitHub**: the public repository, the
  `v0.1.0` tag and the GitHub release exist as of 2026-10-16; no npm
  package does, and none is planned for this version.

### Decided, and what is still open

The three things this file used to list as open were decided on
2026-10-15, together, because each of them had been blocking the release
rather than decorating it:

- **License: Apache-2.0.** The full text is at the repository root as
  `LICENSE`, and npm carries it into every packed copy.
- **Command name: `trace-doctor`.** The project keeps the manifest's
  `agent-trace-doctor`; `trace` was a placeholder from the design drafts
  and is not the name. `bin` carries the decided name, and
  `"private": true` is gone from the manifest.
- **`README.zh-CN.md`.** It exists and matches the English README command
  for command, exit code for exit code and boundary for boundary.

One thing is still open and only the account owner can close it: **the
continuous-integration workflow has never run.** GitHub reads workflows
only from the root of the repository it is building, so the workflow was
inert while this package sat inside another repository, and the account's
Actions was unavailable when this repository was published. Its first
execution in this repository is the open item; what has been measured
without a runner is listed above.

The status of that workflow is maintained here, in the tree it describes,
rather than in a working repository, because this file ships with the
release.
