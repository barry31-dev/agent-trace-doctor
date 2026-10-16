# Schema review after the first real trace

Slice S4 of the development plan. The
loop it closes is:

```text
trace schema -> synthetic traces -> validate / summary / timeline / diff
  -> mini agent spike writes a REAL trace -> review and revise the schema
```

The previous three slices built the first half against synthetic examples. This one
runs a real five-step agent, writes what it actually produced, and then reads that
trace back to find out what the schema could not express. Every change below is tied
to something the run or its tests actually did.

## What the spike is

`spike/` is a development tool, not part of the published CLI. It exists to
answer one question: what does a real agent run look like in this trace format?

```bash
npm run build
./bin/spike-run --out examples/spike-run.jsonl
```

It builds a throwaway sandbox with three synthetic notes, runs a five-step scripted
agent inside it, writes the trace, and then validates that trace with the product's
own `validate` before reporting success. The model is a `ScriptedModel` replaying a
fixed plan: **no network, no API key, no model call, no cost.** That is deliberate.
`ModelProvider` in `spike/model.ts` is the seam a real provider plugs into, and
plugging one in is a change to that file alone.

The committed `examples/spike-run.jsonl` is the real output of a real run on
2026-10-14 (node v22.22.1): 22 events, run id `run_spike_05`, five model turns, four
tool calls, one permission decision, terminal `run.finished`.

## What the run forced the schema to gain

### F1. `effect_disposition` on `tool.call.completed`

This was the field the S1 changelog explicitly deferred to this slice. The spike is
the reason it could be added honestly rather than guessed at.

Three values, not the two the source evidence suggested.
Section 8 of the reverse-engineering notes records a comparable agent's `effect_disposition ∈
{none, unknown}`: `none` for read-only, `unknown` when the outcome is unclear. That pair
cannot answer the first question a reader of our trace has, which is "did this run
change anything". A `write_file` that completed is neither read-only nor unclear. So
the enum is:

| value | meaning |
| --- | --- |
| `none` | read-only, nothing outside the process changed |
| `applied` | completed, and the side effect is in place |
| `unknown` | did not complete cleanly, so a side effect may or may not be there |

The deviation from the source enum is deliberate and is recorded in the schema
description. Each tool declares its own disposition once, on `ToolDefinition.effect`,
and the agent loop copies it onto the completed event and nowhere else, so there is
one place to audit.

Real values from the committed trace: `none` for `list_dir` and both `read_file`
calls, `applied` for the `write_file`.

### F2. `capture` and `output_summary` on `model.response.completed`

Turns 1 and 5 produced text and the schema had nowhere to put it. `capture` takes the
three values from section 5.1 of the same notes (`inline` / `inline_from_stream` / `db_ref`) and
`output_summary` carries a short body when the capture is inline. Full response text
stays out of the trace by design.

A second finding came out of the first version: it wrote `capture: "inline"` on every
turn, including the three that only called tools and produced no text at all. That
tells a reader a body is in the event when there is no body. The recorder now omits
`capture` when the turn produced nothing, which is what "absent means the recorder
kept no response body" already promised.

### F3. `model.role`, `slot_label`, `streamed`

Added from section 5.1 of the same notes: `role ∈ {main, reference, aggregator}` plus a free
`slot_label`, on both the request and the response; `streamed` on the response only.

**Exercised only in its single-model form.** The committed trace records
`role: "main"`, `slot_label: "planner"`, `streamed: false` on every turn. The
multi-slot case, which is the whole point of the fields, is **not exercised** and
stays unverified until a multi-model run exists.

### F4. Tool availability and schema hash at run start

Section 8 of the notes names "why did the model never call this tool" as a question a trace cannot
answer, and proposes a `tool_definition` event with `tool.available`,
`tool.schema_hash` and `tool.effective_schema_hash`.

Recorded in `run.started.payload.config_summary.tools` instead of a new event type.
`config_summary` already exists as the open run-configuration object, so this needs
no new event, no enum change and no change to the fourteen-type count. Each entry
carries `name`, `schema_hash` and `available`. The schema text itself is hashed
rather than inlined, following the same note.

The committed trace records four tools, one of them (`fetch_url`) explicitly
`available: false`. The spike has no network path on purpose, and leaving the tool
out of the registry entirely would have been the easier choice that also leaves the
`available` flag untested.

Not added: `tool.effective_schema_hash` and `tool.override_keys`. Those describe a
runtime schema mutation our spike does not perform, so there is nothing to record.

### F5. `path_escape` in the `guard` enum

A probe run asked `read_file` for `../../etc/hostname`. The tool refused, and the
refusal came out as `error.type: "argument_contract"` with **no** `guard` value,
because none of the seven values taken from that agent covers "outside the sandbox". A
reader scanning guard statistics would never have seen that the run tried to escape.

`path_escape` was added for that. The other seven values remain unexercised by our
recorder: they describe that agent's guard chain, not ours.

### F6. `result_bytes` documented, not changed

The real run exposed an ambiguity rather than a bug. `write_file` reports
`result_bytes: 26`, which is the size of its confirmation message, not of the bytes
it wrote. `read_file` reports the size of the body it read. Both are "the size of the
result the tool produced", but a reader could easily take 26 for "26 bytes written".
The schema now says so explicitly. The semantics did not change.

## Bugs the spike and its tests caught in our own code

These are the reason the slice was worth running. None of them were visible from
reading the code.

**Identical schema hashes for different tools.** The first real run gave `list_dir`
and `read_file` the same `schema_hash`. The canonicaliser was
`JSON.stringify(parameters, Object.keys(parameters).sort())`, whose second argument
is a key allowlist applied recursively at every level, not a sort. It stripped the
nested `description` fields and dropped `max_bytes` entirely, which is exactly the
information that tells the two schemas apart. Two tools with different contracts
hashing identically defeats the purpose of recording a hash at all. Replaced with a
recursive canonicaliser; a regression test asserts the three tool schemas hash
distinctly.

**Silent truncation.** A test reading a 500-byte file with `max_bytes: 10` got
`truncated: true` and a summary with no `[truncated]` marker, because the marker was
only added when the summary exceeded the tool's own cap. The schema promises
truncation is never silent, so the marker is now added whenever the body was clipped
by either cap.

**`--steps=3` rejected as an unknown option.** The inline `--out=` / `--workdir=`
handling fell through to the unknown-option branch. Found by the argument-parsing
tests, not by the happy path.

## Not exercised, and therefore not added

Recording these as gaps rather than filling them in speculatively.

| gap | why it is not here |
| --- | --- |
| `trace.dropped` / `trace.drop_reason` (the notes, §5.1 item 5) | Our recorder never drops an event. There is no drop path to observe, so a field for it would be a guess. |
| `estimated_cost_usd` / `actual_cost_usd` / `cost_status` / `cost_source` (the notes, §8) | The stub model has no cost. Adding cost fields now would produce a trace that claims a cost accounting it does not have. |
| `tool_result_contract` as an error class | Our tool boundary is a TypeScript discriminated union, so a malformed result cannot be constructed at runtime. That agent needs the class because its boundary is dynamic. This is a design difference, not an omission to fix. |
| `effect_disposition: "unknown"` from a real call | Only `fetch_url` declares it, and that tool never runs because it is withheld. The value is in the schema and tested for, but no real call produced it. |
| `role: "reference"` / `"aggregator"` | Single-model spike. See F3. |
| The seven values taken from that agent's `guard` chain | Describe that agent's guard chain. Our sandbox produces `path_escape` and nothing else. |
| Node 20 | Only node v22.22.1 is installed here. `engines` says `>=20`; that is a claim about intent, not a tested fact. |
| Non-zero durations | The committed trace has `duration_ms: 0` almost everywhere because the stub model and local file I/O are fast. It is real, and it carries no timing signal. A real model run would. |

## What the self-check proves, and what it does not

`spike-run` validates its own output with the product's loader, schema and
cross-line invariants before reporting success, and the test suite asserts the same
for the happy path and for the failure paths. That proves the recorder and the
validator agree on this input.

It does not prove the schema fits a real model's output. No model produced a single
event in this slice. It does not prove the CLI works on Node 20, and it does not
exercise the multi-slot, cost or drop paths listed above.
