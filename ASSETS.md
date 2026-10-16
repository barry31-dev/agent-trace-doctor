# Asset manifest

> Zero external assets. Everything in this package was authored for it.
> Counts come from a measured pass over the tree at commit `3a1bb576`, taken by a
> read-only verification pass on 2026-10-15, for the release checklist item that
> asks for a public asset manifest. Nothing here is a projection: every number below
> is the output of a command that was run on this tree, and each command is named.

> **Extended 2026-10-15 by the development pass, in the same round.** The counts
> below were measured at `3a1bb576`, and that round then added two files of its
> own (`ASSETS.md` and `docs/verification-2026-10-15-r2-asset-registration.md`),
> so the tracked set moved underneath them. A dated correction sits in
> "Inventory" rather than a silent rewrite: the manifest describes the moment of
> its measurement, and the two moments are both real. This pass also adds what
> the first one did not measure -- every external URL in the text files, and
> which gates remain open.

## Scope

This manifest covers the **release tree** as it would be assembled for a public
repository. Two directories in this package are deliberately outside it, each for a
stated reason, and both are listed under "Excluded" below.

| Member | In the release tree | Why |
|---|---|---|
| `src/`, `spike/`, `tests/` | yes | authored here, synthetic data |
| `schemas/`, `bin/trace`, `bin/spike-run` | yes | authored here |
| `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `RELEASE_NOTES.md` | yes | authored here |
| `.github/workflows/ci.yml` | yes | authored here |
| `examples/*.jsonl` | yes | synthetic |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `.gitignore` | yes | project skeleton; the lockfile is npm's resolution metadata, not authored content |
| `LICENSE` | yes | the standard Apache-2.0 text with one line filled in; no third-party text is carried in it |
| this file | yes | a manifest is part of what it manifests, or the tree would carry an unlisted member |
| `docs/verification-*` | **no** | machine-specific internal record; see "Excluded" |
| `node_modules/`, `dist/` | **no** | install and build output, both gitignored |

## Inventory (measured 2026-10-15 at `3a1bb576`)

**72 git-tracked files, 7 file kinds.** The kinds below are the measured breakdown
across `git ls-files`, not an estimate:

| Kind | Count | Encoding |
|---|---:|---|
| TypeScript (`.ts`) | 53 | ASCII in all 53 (0 non-ASCII bytes each) |
| Markdown (`.md`) | 6 | UTF-8 in 4, ASCII in 2 |
| JSON (`.json`) | 5 | ASCII in all 5 |
| JSON Lines (`.jsonl`) | 4 | ASCII in all 4 |
| YAML (`.yml`) | 1 | ASCII |
| `.gitignore` (no extension) | 1 | ASCII |
| Node launcher (no extension) | 2 | ASCII, executable (`100755`) |

**No file in this package contains a NUL byte** (checked byte-wise over all 72
tracked files), so nothing here is binary. The four Markdown files with non-ASCII
bytes are `README.md` (5 lines), `spike/SCHEMA_REVIEW.md` (7), and the two
`docs/verification-*` records (13 and 7) -- the latter two are excluded from the
release tree, so **inside the release tree the only non-ASCII bytes are 5 lines of
typographic dashes in `README.md`**.

⚠️ **Dated correction, 2026-10-15 (same day, later pass).** The figures above are
the `3a1bb576` measurement and are left as written. Re-measured after that round's
own writes, the tracked set is **74 files and 8 Markdown files**: the two additions
are this manifest and `docs/verification-2026-10-15-r2-asset-registration.md`, and
both are internal to the same round. The third `docs/verification-*` record is
excluded from the release tree exactly like the other two, so the release-tree
subset of that count is unchanged in kind -- 71 files, of which the only non-ASCII
bytes are `README.md`'s dashes and `spike/SCHEMA_REVIEW.md`'s quoted title. The
`3a1bb576` numbers are not wrong; they are a snapshot, and this is the later one.

⚠️ **Dated correction, 2026-10-15 (later still, after this round's content fixes).**
Two counts moved since the paragraph above. ① A read-only verification pass added
`docs/verification-2026-10-15-r2-release-surface-recheck.md`, so the tracked set is
**75 files and 9 Markdown files** and the release-tree subset is **72** -- four
`docs/verification-*` records are excluded now, not three. The byte-wise NUL check was
re-run over all 75 files and still finds zero. ② This round rewrote parts of
`spike/SCHEMA_REVIEW.md` to drop internal document paths and another project's name, which
removed three of its non-ASCII lines: it now has **4** (two `∈`, two `§`) where the
snapshots above record 7. Inside the release tree the non-ASCII bytes are therefore
`README.md`'s 5 lines of typographic dashes plus those 4 symbol lines.

⚠️ **Dated correction, 2026-10-15 (later still, when the three open decisions landed).**
The tracked set grew by two members -- `LICENSE` and `README.zh-CN.md` -- so it is now
**77 files and 10 Markdown files**, and the release-tree subset is **73** (the same four
`docs/verification-*` records are still excluded). The byte-wise NUL check was re-run
over all 77 and still finds zero. ② The non-ASCII picture changed shape rather than
growing: `README.zh-CN.md` is written in Chinese and carries **377** non-ASCII lines,
which is most of the tree's non-ASCII bytes by line count. Every one of them is UTF-8
text, not a binary artefact, and the byte-wise NUL check above is what distinguishes
the two. The tarball gained two files for the same reason: `LICENSE` and
`README.zh-CN.md` ride along as npm's always-included members rather than through
`files`, which is unchanged.

**Dated correction, 2026-10-16 (development slot; counts refreshed against the
current tree, nothing re-measured that a later pass had not already measured).** The
tracked set is now **79 files and 12 Markdown files**, and the release-tree subset is
still **73**: **six** `docs/verification-*` records are excluded now, not four. The two
members added since the paragraph above are verification passes' own records
(`docs/verification-2026-10-15-r2-release-surface-fix-recheck.md` and
`docs/verification-2026-10-15-r1-package-install.md`). A read-only pass that writes its
record into the tree it just measured raises the tracked count by one and the excluded
count by one, so the subset does not move -- which is why the subset has read 71 for four
consecutive corrections while the tracked count went 74, 75, 76, 77, 79. Measured per
commit with `git ls-tree -r --name-only` at `3a1bb576` / `62486b5b` / `65ffee83` /
`6ad1a3a7` / `76fe6bc5` / `939c75eb` / `a7e57055`: tracked 72 / 74 / 74 / 75 / 76 / 78 / 79,
excluded 2 / 3 / 3 / 4 / 5 / 5 / 6, subset 70 / 71 / 71 / 71 / 71 / 73 / 73. One earlier
correction states the subset as **72** at the 75-file snapshot; 75 tracked minus 4
excluded is **71**, so that figure is an arithmetic slip in a dated paragraph, left as
written and corrected here rather than rewritten. The byte-wise NUL check was re-run over
all 79 and still finds zero. The check is a byte-count comparison -- `wc -c` against
`tr -d '\000' | wc -c` -- and it was validated against a file known to contain a NUL
before being trusted on this tree. That validation matters: a shell `grep` for a NUL byte
silently matches **every** file under zsh (the NUL cannot survive argument passing, so the
pattern collapses to empty and 79 of 79 files are reported binary), and `rg` refuses to
match NUL at all. Neither tool can produce this number, so a pass that used either and
reported "zero NUL bytes" reported a number its method could not have produced.

The non-ASCII inventory inside the release tree is **four files**, not the three the
paragraph above implies, and this manifest is the one earlier corrections left out:
`README.zh-CN.md` **377** lines, this file **8** lines, `README.md` **5** lines of
typographic dashes, and `spike/SCHEMA_REVIEW.md` **4** lines. This file's own count is
self-referential -- editing it can change it -- so it is stated as measured at this
commit rather than as a property of the manifest. This paragraph is written in ASCII on
purpose: a correction that adds its own non-ASCII lines would invalidate the number it
reports, which is how the omission above survived four passes.

**Dated correction, 2026-10-16 (second pass on the same day; counts refreshed against the
current tree).** The tracked set is now **80 files and 13 Markdown files**, and the
release-tree subset is still **73**: **seven** `docs/verification-*` records are excluded
now, not six. The one member added since the paragraph above is a verification pass's own
record (`docs/verification-2026-10-16-r1-node-legs-on-current-tree.md`). This is the same
shape as the correction above it and it will recur: a read-only pass writes its record
into the tree it just measured, so tracked +1 and excluded +1 and the subset does not move.
That record states in its own closing section that it deliberately did not refresh these
counts, calling the lag known and dated rather than absorbing it silently; this section
performs that refresh. Measured per commit with `git ls-tree -r --name-only` at
`939c75eb` / `a7e57055` / `24f3bad9` / `d5be6e48`: tracked 78/79/79/80, excluded 5/6/6/7,
subset 73/73/73/73. The byte-wise NUL check was re-run over all 80 and still finds zero,
by the same `wc -c` against `tr -d '\000' | wc -c` method validated above.

**What did not change: the release tree itself.** The new member is inside `docs/`, so the
release-tree subset stays 73 and the non-ASCII inventory inside the release tree stays
**four files**, with this manifest still at **8** lines. The new record does carry 4
non-ASCII lines of its own, but they sit inside the excluded directory and so are not part
of the published surface; they are counted in the 13 Markdown files, not in the four. This
paragraph is ASCII on purpose, for the same reason as the one above it.

**Dated correction, 2026-10-16 (third pass on the same day; counts refreshed against the
current tree).** The tracked set is now **82 files and 15 Markdown files**, and the
release-tree subset is still **73**: **nine** `docs/verification-*` records are excluded
now, not seven. The two members added since the paragraph above are two more verification
passes' own records -- `docs/verification-2026-10-16-registry-refresh-80-7.md`, which is
the registration refresh the paragraph above it asked for, and
`docs/verification-2026-10-16-s31-cleanroom-wordlist.md`, a read-only re-check of a shared
gate change. This is the same shape as the two corrections above it and it will recur: a
read-only pass writes its record into the tree it just measured, so tracked +1 and
excluded +1 and the subset does not move. That recurrence is now at **three**, and the
reason it is not a mistake is the one the correction above states -- the pass that
measures the tree is also the pass that adds to it. Measured per commit with
`git ls-tree -r --name-only` at `939c75eb` / `a7e57055` / `24f3bad9` / `d5be6e48` /
`a7b1f121` / `4a52ba05` / `916c435e` / `52293ae6`: tracked 78/79/79/80/80/81/82/82,
excluded 5/6/6/7/7/8/9/9, subset 73/73/73/73/73/73/73/73. The byte-wise NUL check was
re-run over all 82 and still finds zero, by the same `wc -c` against
`tr -d '\000' | wc -c` method validated above.

**What did not change: the release tree itself, again.** Both new members are inside
`docs/`, so the release-tree subset stays 73 and the non-ASCII inventory inside the
release tree stays **four files**, with this manifest still at **8** lines. The two new
records carry 4 and 21 non-ASCII lines of their own, but they sit inside the excluded
directory and so are not part of the published surface; they are counted in the 15
Markdown files, not in the four. This paragraph is ASCII on purpose, for the same reason
as the two above it.

**Dated correction, 2026-10-16 (fourth pass on the same day; counts refreshed against the
current tree).** The tracked set is now **83 files and 16 Markdown files**, and the
release-tree subset is still **73**: **ten** `docs/verification-*` records are excluded
now, not nine. The member added since the paragraph above is one more verification
pass's own record -- `docs/verification-2026-10-16-registry-refresh-82-9.md`, the
independent re-check of the refresh the paragraph above it performed. This is the same
shape as the three corrections above it and it will recur: a read-only pass writes its
record into the tree it just measured, so tracked +1 and excluded +1 and the subset does
not move. That recurrence is now at **four**. Measured per commit with
`git ls-tree -r --name-only` at `939c75eb` / `a7e57055` / `24f3bad9` / `d5be6e48` /
`a7b1f121` / `4a52ba05` / `916c435e` / `52293ae6` / `297d15be` / `bc4f9085`: tracked
78/79/79/80/80/81/82/82/83/83, excluded 5/6/6/7/7/8/9/9/10/10, subset
73/73/73/73/73/73/73/73/73/73. The last of those, `bc4f9085`, touches nothing under this
package (it fixes a shared gate's diagnostic path outside it), so it is listed as the
control that shows the package count did not move. The byte-wise NUL check was re-run
over all 83 and still finds zero, by the same `wc -c` against `tr -d '\000' | wc -c`
method validated above.

**What did not change: the release tree itself, a third time.** The new member is inside
`docs/`, so the release-tree subset stays 73 and the non-ASCII inventory inside the
release tree stays **four files**, with this manifest still at **8** lines. The new
record carries 3 non-ASCII lines of its own, but they sit inside the excluded directory
and so are not part of the published surface; they are counted in the 16 Markdown
files, not in the four. This paragraph is ASCII on purpose, for the same reason as the
three above it.

**`LICENSE` now exists.** The sentence below still reads "No `LICENSE` file exists yet",
which was true when it was written and is not true now: R0 landed the standard Apache-2.0
text on 2026-10-15 with one line filled in. The sentence is left as a snapshot and this
note supersedes it. The license text carries no third-party content and no maintainer
identity beyond the contributor line, so it adds nothing to the clean-room surface.

**The published tarball is smaller than the tree.** `npm pack` at this commit
produced `agent-trace-doctor-0.1.0.tgz`, **29 files**, which is what the `files`
whitelist in `package.json` declares, plus the two files npm adds on its own:
`dist/src/**` (24 compiled modules, one per source file), `bin/trace`,
`schemas/trace.schema.json` and `CHANGELOG.md` from the whitelist, and `README.md`
and `package.json`, which npm always includes whether they are listed or not.
`tests/`, `examples/`, `spike/`, `tsconfig*.json` and
`.github/` are absent from it, so the npm surface and the repository surface are
**not** the same set and this manifest covers both.

## Authorship and rights

- **Code**: authored directly in this package. The only imports are the Node
  standard library plus npm-pinned transitive dependencies recorded in
  `package-lock.json` (sha256 `0f884d28d240033ea5953b040bd3af8d96c39a916e2669e6b33c7b23b1e76d59`,
  unchanged across the two verification legs). No third-party code is vendored,
  copied, or derived.
- **Data**: `examples/*.jsonl` and every fixture under `tests/` are synthetic. Run
  ids, event ids and task statements were written for this package. No account,
  organisation, person or business field appears in them.
- **Prose**: written for this package. There is no upstream source to attribute.
  `README.zh-CN.md` is a translation of `README.md` written here rather than
  translated from anyone else's text, and it states the same commands, exit codes
  and boundaries as the English file it accompanies.
- **No trademark, logo, icon, colour scheme, screenshot, font, or third-party media**
  is used anywhere in the release tree. There is no image, audio, or video file in
  the package at all.

## Third-party references in text

The release tree's text mentions exactly one third-party name, `OpenAI`, and it
names an **HTTP dialect rather than a product**: `src/model/openai.ts` implements
`OpenAICompatibleClient`, `DEFAULT_PROVIDER = "openai-compatible"`, and the code
reads `OPENAI_API_KEY` for the opt-in `--model` path. Whether that phrasing is
acceptable in a public tree is **an open project decision**, not this manifest's; the
rest of a measured check is that no other external name appears. One documented
example also mentions `gpt-5-mini` as a `--model-name` value (README) -- a model
name typed by a user, not a claim about that model.

**External URLs, every one of them (measured 2026-10-15).** A name scan and a URL
scan are different checks, and the first pass only did the name one: it concluded
that `README.md` and `CHANGELOG.md` "reference no external URL", which was false
on `CHANGELOG.md`'s fourth line. The table below is the whole list, produced by
searching every text file in the release-tree candidate for `http://` and
`https://` rather than by recalling what was written:

| Reference | Where | What it is |
| --- | --- | --- |
| JSON Schema draft 2020-12 | `schemas/trace.schema.json`, `src/schema.ts`, several tests | the `$schema` dialect identifier. `ajv` resolves it locally; nothing is downloaded. |
| `https://api.openai.com/v1` | `src/model/config.ts`, `tests/model.test.ts` | the default endpoint of the one backend implemented. A request is made only when a model flag and a key are given, and no test reaches it. |
| `http://127.0.0.1:<port>/v1` | `tests/` | a local stub server the suite starts itself. One case points at port 9, where nothing listens, to prove the connection-refused path. |
| `https://example.com` | `tests/spike.test.ts` | the reserved example domain, inside a trace written to be hostile to the parser. |
| Keep a Changelog 1.1.0 | `CHANGELOG.md` | a link to a public format specification, not copied content. Only the URL is referenced. |
| registry and funding URLs | `package-lock.json` | resolution metadata npm writes for `ajv` and `ajv-formats`; not authored content. |

Nothing in this package fetches anything at build, render or documentation time:
no image, font, script or stylesheet is loaded, and the documentation is
self-contained. The one outbound request the code can make is the opt-in model
call described in the second row above, which needs both a flag and a key. Every
row above is an identifier, an endpoint or a link, never content that was copied.

**No `LICENSE` file exists yet**: the license decision is
still open, so this tree currently carries no third-party license text either
(Apache-2.0 is the agent's proposal, following the `AgentFleetDoctor` precedent).

## Excluded from the release tree

- **The dated `docs/verification-*.md` records** are internal records of read-only
  re-runs by a read-only verification pass. Their prose
  names the second machine throughout, so keeping them would put an
  internal machine name in a public repository. `publish_trace_doctor.py` excludes
  the **whole `docs/` directory** (`FORBIDDEN_DIRS = ("node_modules", "docs")`)
  rather than a filename pattern, so a future verification record is excluded the
  day it is written instead of needing a new exclusion.

  > **Correction, 2026-10-15 (later pass, same day).** This bullet used to name a
  > constant, `FORBIDDEN_GLOBS = ("docs/verification-*",)`, that no longer exists
  > in the script: the filename glob was replaced by the directory exclusion
  > earlier in the same round, precisely because a name pattern would admit a
  > future record that happened to be called something else. The conclusion did
  > not change -- these records stay out -- but a reader who searched the script
  > for the quoted line would not have found it. Two other documents in this round
  > carry the same stale name: the V9 record, which predates the change and is
  > therefore a snapshot of what was true when it was written, and the V10 record,
  > which came after the change and still quoted the old constant -- the second is
  > the error, not the first.
  >
  > This is a content decision, not an asset-rights one; the files stay in the
  > internal repository.
- **`node_modules/`** is an install tree and third-party code, which the same
  gate forbids (`FORBIDDEN_DIRS`).
- **`dist/`** is build output and gitignored; the package publishes it only through
  `npm pack`.

## What has been measured, and by which command

| Check | Command | Result |
|---|---|---|
| File inventory and kinds | `git ls-files` + kind grouping | 72 files, 7 kinds (at `3a1bb576`; 74 / 8 after that round's own writes; 75 / 9 after the later verification record) |
| Binary presence | byte read of all 75 files | 0 files with a NUL byte (re-run over the current set) |
| Non-ASCII locations | `grep -c '[^ -~]'` per file | 3 files in the release tree, all Markdown; 4 more in the excluded records |
| Release-tree membership | `publish_trace_doctor.py --preflight` | reports the 4 open items still missing; no surface failure |
| Forbidden-member gate | `publish_trace_doctor.py --gate-only <probe>` | passes a clean clone, refuses a planted `docs/verification-*` and `node_modules/` |
| Internal-context scan | `rg` over the tarball and the tracked tree | 0 hits in the tarball; 1 in the tracked tree, the excluded record itself -- **but read "Clean-room" below: the word list cannot see a project name of this shape or a document path** |
| Trademark / vendor scan | `rg -i` over the release tree | only `OpenAI` as a dialect name, `gpt-5-mini` as a user-typed example, `macOS` as a platform name |
| External URLs | `rg -o` with an `http` / `https` pattern, over every text file in the candidate set | the six rows above; the name scan alone had missed `CHANGELOG.md`'s format link |
| Inventory, re-measured | `git ls-files` after the later verification record | 75 files, 9 Markdown; see the dated corrections in "Inventory" |

## Clean-room

The candidate set is scanned for internal context by the publication channel
(`publish_trace_doctor.py`), and that scan runs a **positive control before it
believes a zero-hit result**: a file that must be reported is planted, watched for,
and removed. Without it, "zero hits" cannot be told apart from a scanner that never
read the files. The current tree measures zero hits with the install and build
artefacts excluded as non-members.
A zero-hit result still only covers the strings the list carries. On 2026-10-15 a pass
that read the files instead of the list found another project's name in four of them
and internal document paths in two, and the list carries neither kind; both are now
described rather than named. The list itself has **not** been extended -- it lives in
the shared publication gate, which serves another package as well -- so this manifest
does not claim the scan would catch a repeat, and extending it is tracked as its own
item.

⚠️ **Dated correction, 2026-10-15 (the same day, after the decisions landed).** The
paragraph above called the removed name "a real company name". It is not one: it is
the name of an open-source agent project, the object the reverse-engineering notes
describe, and its resemblance to a private email domain is a coincidence. The rule
already registered for third-party names permits descriptive mention, so removing it
was a conservative choice rather than a requirement. What the pass did establish is
the part that matters and is unchanged by the correction: a zero-hit scan cannot
prove this tree self-contained, because the word list carries neither a project name
of this shape nor a document path.

## Remaining gates

- **The CI workflow has never run.** `.github/workflows/ci.yml` is live in the
  published repository and has never been executed; it was inert while this package
  sat inside another repository, and the account's GitHub Actions was unavailable
  when the repository was published. What has been measured is this tree on Node
  20.14.0 and 22.23.3, by hand, on two machines.
- **No real provider has ever been called.** Every model test talks to a local stub
  server, so the request shape is verified against a stub and not against an
  endpoint.
- **No npm release, and none planned.** The public repository, the `v0.1.0`
  annotated tag and the GitHub release were created on 2026-10-16; nothing has
  been published to npm, and this version is not planned to be.

> **Correction, 2026-10-15, same day.** The three gates that used to sit at the top of
> this list are closed. `LICENSE` is present and carries the Apache License, Version
> 2.0, in full with the copyright line filled in; `README.zh-CN.md` is present and
> states the same commands, exit codes and boundaries as the English README; and
> `package.json` carries `"bin": {"trace-doctor": "bin/trace"}` with `"private": true`
> gone. What is left on this list is what no agent can close from here: the workflow
> has never run, no real provider has been called, and nothing is released. The
> publication channel's member check still asserts all five members, so a deletion of
> any of them fails the gate rather than passing quietly.

## Registration

These files are registered in the project's internal asset register as `ASSET-209`
onward, with the five items that register requires -- exact path and hash, source or
author, the basis for the permitted use, permitted use and channel, reviewer and
date. The registration records an agent self-determination under the user's
2026-10-08 delegation (project-authored build products and text), which changes who
signs, not whether the review happened.

**Dated correction, 2026-10-16 (fifth pass on the same day; counts refreshed against the
current tree).** The tracked set is now **84 files and 17 Markdown files**, and the
release-tree subset is still **73**: **eleven** `docs/verification-*` records are
excluded now, not ten. The member added since the paragraph above is one more
verification pass's own record -- `docs/verification-2026-10-16-s33-f8-fix-and-s34-registry.md`,
the independent re-check of the F8 diagnostic fix and the registry refresh the paragraph
above it performed. This is the same shape as the four corrections above it and it will
recur: a read-only pass writes its record into the tree it just measured, so tracked +1
and excluded +1 and the subset does not move. That recurrence is now at **five**. Measured
per commit with `git ls-tree -r --name-only` at `939c75eb` / `a7e57055` / `24f3bad9` /
`d5be6e48` / `a7b1f121` / `4a52ba05` / `916c435e` / `52293ae6` / `297d15be` / `bc4f9085` /
`c9343ade`: tracked 78/79/79/80/80/81/82/82/83/83/84, excluded 5/6/6/7/7/8/9/9/10/10/11,
subset 73/73/73/73/73/73/73/73/73/73/73. The merge `1ba788cf` reads 84/11/73 as well and is
listed as the control that shows a merge does not move the package count either. The
byte-wise NUL check was re-run over all 84 and still finds zero, by the same `wc -c`
against `tr -d '\000' | wc -c` method validated above.

**What did not change: the release tree itself, a fourth time.** The new member is inside
`docs/`, so the release-tree subset stays 73 and the non-ASCII inventory inside the
release tree stays **four files**, with this manifest still at **8** lines. The new
record carries 5 non-ASCII lines of its own, but they sit inside the excluded directory
and so are not part of the published surface; they are counted in the 17 Markdown
files, not in the four. This paragraph is ASCII on purpose, for the same reason as the
four above it.

**Dated correction, 2026-10-16 (sixth pass on the same day; counts refreshed against the
current tree).** The tracked set is now **85 files and 18 Markdown files**, and the
release-tree subset is still **73**: **twelve** `docs/verification-*` records are
excluded now, not eleven. The one member added since the paragraph above is one more
verification pass's own record -- `docs/verification-2026-10-16-s35-registry-refresh-84-11.md`,
the independent re-check of the registry refresh the paragraph above it performed. This is
the same shape as the five corrections above it and it will recur: a read-only pass writes
its record into the tree it just measured, so tracked +1 and excluded +1 and the subset
does not move. That recurrence is now at **six**. Measured per commit with
`git ls-tree -r --name-only` at `939c75eb` / `a7e57055` / `24f3bad9` / `d5be6e48` /
`a7b1f121` / `4a52ba05` / `916c435e` / `52293ae6` / `297d15be` / `bc4f9085` / `c9343ade` /
`1ba788cf` / `e1214b67` / `66f14fbd`: tracked 78/79/79/80/80/81/82/82/83/83/84/84/84/85,
excluded 5/6/6/7/7/8/9/9/10/10/11/11/11/12, subset 73/73/73/73/73/73/73/73/73/73/73/73/73/73.
The merge `1ba788cf` reads 84/11/73 and the registry-only refresh `e1214b67` reads
84/11/73 as well; both are listed as controls, because neither a merge nor a refresh that
edits this manifest and nothing else moves the tracked count. The byte-wise NUL check was
re-run over all 85 and still finds zero, by the same `wc -c` against
`tr -d '\000' | wc -c` method validated above.

**What did not change: the release tree itself, a fifth time.** The new member is inside
`docs/`, so the release-tree subset stays 73 and the non-ASCII inventory inside the
release tree stays **four files**, with this manifest still at **8** lines. The new record
carries 10 non-ASCII lines of its own, but they sit inside the excluded directory and so
are not part of the published surface; they are counted in the 18 Markdown files, not in
the four. This paragraph is ASCII on purpose, for the same reason as the five above it.

## Dated corrections, 2026-10-16 (C1 and C2, development pass)

Two sentences in this manifest claimed more than the measurement behind them
covered. Both are corrected here by the convention used everywhere above: the
original sentences stay where they are, and the narrower claim sits next to them.
Nothing below re-measures a count. Every number named here is the output of a
command that was run, and the command is named with it. This section is ASCII on
purpose, for the same reason as the paragraphs above it.

### C1 - "the release tree itself" was not what was measured

The manifest ends with "What did not change: the release tree itself, a fifth
time." What that pass measured is narrower: the release-tree **member count**
stayed 73, and the non-ASCII inventory inside the release tree stayed four
files. This manifest is itself a release member -- the Scope table lists
`this file | yes` -- and its own bytes moved: `git diff --numstat e1214b67
2917924f -- ASSETS.md` reads **26 added, 0 removed**. "Membership unchanged" and
"member bytes unchanged" are two different claims, and only the first one was
measured.

The same block also drifted on its ordinal: it calls the recurrence "now at
six" two paragraphs before a paragraph that calls itself "a fifth time". This
file has carried an ordinal slip before, so from this correction on each count
is read at the commit named beside it rather than at "now".

**Binding rule adopted here.** A record that lands inside the excluded `docs/`
directory does not change the release surface, so it does not by itself require
a rewrite of the release-surface claims in this manifest. Two such records
landed after the counts above were read at `66f14fbd`:
`docs/verification-2026-10-16-s36-registry-refresh-and-q25.md` and
`docs/verification-2026-10-16-audit-c1-c2-recheck.md`. Both are excluded by the
same rule, so the release subset stays 73 and the four-file non-ASCII inventory
is untouched. Current tracked and excluded totals are kept in the internal
registry, which lives outside this package; this manifest does not restate them.

### C2 - the word list: extended in the repository copy, not in the deployed one

The Clean-room section says "The list itself has **not** been extended", and
the 2026-10-15 correction repeats that the list "carries neither a project name
of this shape nor a document path". Both sentences were true of the copy they
were written about, and both are now false of the copy the release gate loads.

Measured on 2026-10-16 by importing both copies and reading the pattern, with
no scan re-run. The repository copy that the release script loads from beside
itself (`SHARED_GATE_PATH = os.path.join(HERE, "publish_afd.py")`), sha256
prefix `69ee7cce6547`, carries **29** branches. **14** of them were added on
2026-10-16, and those additions include internal document paths -- a
repository-root instruction file, and three branch names of the shape
`line/<name>` -- plus a personal name and a private email domain. The remaining
additions are internal directory names in the project's working language; they
are not reproduced here, because this manifest is scanned by the very list it
describes. The deployed copy used by the machine-side scheduled jobs, sha256
prefix `48dc945e501d`, still carries **15**, the pre-extension set. The two
copies are not in sync, and deploying the repository copy is a separate open
item owned by another lane; it was not done here.

So "not been extended" is true of the deployed copy and false of the repository
copy, and "carries no document path" is false of the repository copy and true of
the deployed one. The zero-hit reading stands and is stronger for it, not
weaker: the 14 added branches were swept over the release members by an
independent pass on 2026-10-16, not by this manifest's own scanner, and read
zero hits. A zero hit still only covers the strings the list carries, so a
longer list does not prove that every internal reference is gone.

### What this correction does not claim

- It does not claim the release checklist is green. The CI workflow has still
  never run; that item is registered in the internal registry as an open
  question and is not decided here.
- It does not claim the deployed gate copy was updated, redeployed, or verified
  beyond reading its word list.
- It does not restate the tracked, Markdown, or excluded totals. The paragraphs
  above keep the values they were measured with, at the commits named beside
  them.

## Dated corrections, 2026-10-16 (C3, the release itself)

- **The repository exists and the channel is implemented.** The public repository
  `https://github.com/barry31-dev/agent-trace-doctor` was created empty through
  `gh` with the publisher token at 2026-10-16 21:49 CST (`gh repo view` reads
  `private: false`, default branch `main`, `size: 0`). The publication channel
  `publish_trace_doctor.py --publish` now performs the three remaining steps --
  root commit, annotated tag `v0.1.0`, GitHub release -- and was rehearsed
  end to end on this machine with the remote steps recorded instead of executed.
  **No byte has been pushed to the public repository yet**, so this paragraph does
  not describe a release; it describes a repository plus a rehearsed channel.
- **Two statements in this file became false at that moment and were corrected in
  place rather than left to contradict the tree**: the CI workflow's "inert while
  this package sits inside another repository" and the "No release exists" gate.
  The dated paragraph above them, which closes with "nothing is released", is
  history from 2026-10-15 and was not rewritten; the same rule covers every dated
  count paragraph in this file.
- **What did not change**: the inventory, the two non-ASCII files inside the
  release tree, the zero binaries, the external URL list, the excluded `docs/`
  directory and the 73-member release tree. What changed is wording in five text
  files -- `README.md`, `README.zh-CN.md`, `RELEASE_NOTES.md`, `CHANGELOG.md` and
  this manifest -- and the internal register's hash rows for those five were
  refreshed in the same pass.
-- **Counts, re-measured for this pass** (`git ls-files` over the tree this pass
  commits): tracked **90**, Markdown **23**, `docs/verification-*` records **17**,
  release-tree subset **73** -- the same 73 as every pass above, because both records
  this pass adds land inside the excluded directory. The byte-wise NUL check was
  re-run over all 90 and still finds zero, by the same validated `wc -c` against
  `tr -d '\000' | wc -c` method. The internal register's hash block was re-computed
  for all 90 files and every row matched.
- **Counts move once more, in the same round, and this paragraph is the correction.**
  While this pass was being committed, another machine landed
  `docs/verification-2026-10-16-s40-candidate-assembly-dry-run-m3.md` on `main`
  (`0c6cb4e1`, the independent re-check of the S40 assembly). Merging it makes the
  committed tree **91 tracked / 24 Markdown / 18 verification records**, still with
  the release-tree subset at **73**. The NUL check was re-run over all 91 and still
  finds zero; the register's hash block was re-computed for 91 rows and every row
  matched. The two readings are recorded side by side rather than the earlier one
  overwritten, because the 90 / 23 / 17 figure is what this pass's own additions
  produce and the 91 / 24 / 18 figure is what a reader of the commit actually sees.
- **What this correction does not claim**: that the workflow has run (it has not,
  and its first execution in the published repository is still pending), that any
  real provider has been called (none has), or that anything is published to npm
  (nothing is).
