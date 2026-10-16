# Release notes

> **v0.1.0 is published to a public repository at**
> https://github.com/barry31-dev/agent-trace-doctor. That repository was
> created public on 2026-10-16, and measured read-only on 2026-10-17 it is no
> longer empty: its `main` is one root commit,
> `8848261132aa56d9724f52e287de1fba06a6fb8c`, and the annotated tag `v0.1.0`
> points at it. The GitHub release for that tag does not exist -- the same
> read reports zero releases -- and the channel that pushes the tree, cuts
> the tag and creates the release is implemented and rehearsed end to end
> while refusing to act on a remote that already has refs, which is why
> that one step is still open. `CHANGELOG.md` records what was built,
> slice by slice; this file records what a reader of that release will be
> entitled to rely on, which is a different claim.
>
> **Superseded 2026-10-17:** the release for `v0.1.0` now exists. It was created
> through the same channel this paragraph describes, in its follow-up mode, and
> read back from the API on the same day: the release is present, the commit's
> the release is on tag `v0.1.1` (there is still no release for `v0.1.0`), neither draft
> nor prerelease, the tag object `549f117a` has tagger
> `barry31-dev <329888575+barry31-dev@users.noreply.github.com>`, and the follow-up
> commit `f4d73c22` has author, committer, `author.login` and `committer.login` all
> `barry31-dev`, and the
> follow-up commit that carries this correction sits on top of that root commit.
> The CI workflow has still never run and by the maintainer's decision will not --
> GitHub Actions here sits behind an account-side billing gate this project does
> not intend to clear -- so no line in these notes should be read as a runner
> having executed the workflow.
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
  **Superseded 2026-10-17: it will not run, by decision.** The blocker is
  account-side billing for GitHub Actions, and the maintainer chose not to
  clear it -- for this project the paid gate costs more than what it would
  prove. The workflow stays in the tree as a written and reviewed record of
  the steps, and every sentence above it should be read that way: the
  commands were checked locally for what a runner is not needed to check,
  and no runner has executed them.

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
- **Nothing is published outside the GitHub repository named above**: as of
  2026-10-17 the repository exists and carries the annotated `v0.1.0` tag,
  while the GitHub release for that tag does not exist yet -- that is the
  one step still open. No npm package exists either, and none is planned
  for this version.

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

One thing is still open and the account owner has now decided how it is
handled: **the continuous-integration workflow has never run.** GitHub reads
workflows only from the root of the repository it is building, so the workflow
was inert while this package sat inside another repository, and the account's
Actions was unavailable when the repository above was created. On 2026-10-16
the owner decided this item is deferred and does not block publication
("not now, later"), so it is recorded here as unmet rather than as passed. Its
first execution in this repository is still an open item; what has been measured
without a runner is listed above.

The status of that workflow is maintained here, in the tree it describes,
rather than in a working repository, because this file ships with the
release.
