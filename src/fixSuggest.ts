import { asRecord, asText, distribution, payloadOf, readRunOutcome } from "./analyze.js";
import type { RunStatus } from "./analyze.js";
import type { ErrorOccurrence, ErrorsReport } from "./errors.js";
import type { LoadedEvent } from "./loader.js";
import { readInputSummary } from "./evalGen.js";

/**
 * Candidate directions, derived from one validated trace.
 *
 * `errors` says what went wrong and `eval-gen` says what a rerun has to avoid; neither
 * says where to look next. This does, and the line it will not cross is the one between
 * a pattern and a cause. Every suggestion here is a restatement of something the trace
 * records -- a class that repeated, a tool that failed, a call a guard refused -- plus a
 * direction a reader could take with the file open. Nothing is claimed about why
 * anything happened, nothing is applied, and every suggestion states beside itself what
 * it does not establish, because a suggestion that reads as a diagnosis is the one
 * failure mode this command could have.
 *
 * It is a pure function over the `errors` report and the loaded events, like everything
 * else that reads a trace: no clock, no file system, no network, so the same trace always
 * produces the same suggestions. What a model half may add is not this module's business,
 * and nothing here prepares a request -- which is also why the one note about whether a
 * model was called does not live here. It is a fact about the invocation, not about the
 * derivation, so the caller that knows the answer appends it.
 */

/** One event a suggestion rests on, in the shape a reader can open. */
export interface FixEvidence {
  line: number;
  event_id: string;
  /** The event type, the same value `errors` reports for the same event. */
  event: string;
  /**
   * What this event contributes to the suggestion: the error class and message it
   * carried, the decision it recorded, or the reference it points at.
   */
  note: string;
  /** `error.recorded.fatal` where the event has the field, null where it does not. */
  fatal: boolean | null;
}

/** One candidate direction, with the pattern that produced it and its limit. */
export interface FixSuggestion {
  /** Stable within one report: `sug_001`, `sug_002`, in rule order. */
  suggestion_id: string;
  /** Which rule produced this, so two runs suggest in the same vocabulary. */
  rule: FixRule;
  title: string;
  /** The direction in words. Something to do with the file open, never a promised fix. */
  action: string;
  /** The error class the suggestion rests on, when it rests on one. */
  error_type: string | null;
  /** The tool the suggestion rests on, when it rests on one. */
  tool: string | null;
  /** How many events back this suggestion, which is `evidence.length`. */
  count: number;
  /** How many of those were recorded fatal. */
  fatal: number;
  first_line: number | null;
  last_line: number | null;
  first_event_id: string | null;
  last_event_id: string | null;
  /** Every event the suggestion was derived from, in file order. */
  evidence: FixEvidence[];
  /** The pattern in this trace that fired the rule. */
  basis: string;
  /** What this suggestion does not establish. Stated per suggestion, never left implied. */
  does_not_establish: string;
}

export interface FixSuggestReport {
  command: "fix-suggest";
  file: string;
  schema: string;
  run_id: string | null;
  /** How the run ended, read from the same place `errors` reads it. */
  status: RunStatus;
  /** `run.started.input_summary` as the recorder wrote it: the scenario the suggestions belong to. */
  input_summary: string | null;
  /** Events in the file, not the number of failures. */
  events: number;
  failures: number;
  errors: number;
  refusals: number;
  suggestions: FixSuggestion[];
  /** What this report does not establish. Deterministic, and never model-written. */
  unverified: string[];
}

/**
 * The rules, in the order they fire.
 *
 * The order is the order a reader asks the questions in: is this trace complete and
 * self-consistent, then what failed, then what was blocked on purpose. A reader who
 * acts on the failure suggestions of a truncated file has been misled by the ordering,
 * not by the content, which is why the trace-level rules come first.
 */
export const FIX_RULES = [
  "incomplete_run",
  "dangling_reference",
  "fatal_failure",
  "repeated_error_class",
  "tool_failure",
  "permission_denied",
  "guardrail_refusals",
] as const;

export type FixRule = (typeof FIX_RULES)[number];

/** What one rule says, before the evidence it rests on is attached. */
interface RuleStatement {
  rule: FixRule;
  title: string;
  action: string;
  basis: string;
  does_not_establish: string;
  error_type: string | null;
  tool: string | null;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

/** The loaded event on one line, or null when the file does not carry that line. */
function eventAt(events: LoadedEvent[], line: number): LoadedEvent | null {
  for (const loaded of events) {
    if (loaded.line === line) {
      return loaded;
    }
  }
  return null;
}

/** The evidence entry for one failure occurrence, exactly as `errors` reports it. */
function occurrenceEvidence(occurrence: ErrorOccurrence): FixEvidence {
  const note = occurrence.message.length === 0 ? occurrence.type : `${occurrence.type}: ${occurrence.message}`;
  return {
    line: occurrence.line,
    event_id: occurrence.event_id,
    event: occurrence.event,
    note,
    fatal: occurrence.fatal,
  };
}

/**
 * Turns one rule statement plus its evidence into a suggestion.
 *
 * The counts and the first and last anchors are read off the evidence rather than passed
 * in, so no number in a suggestion can disagree with the events listed beside it. The id
 * is assigned by the caller, which knows the order.
 */
function finish(statement: RuleStatement, evidence: FixEvidence[], index: number): FixSuggestion {
  const first = evidence[0];
  const last = evidence[evidence.length - 1];
  return {
    suggestion_id: `sug_${String(index + 1).padStart(3, "0")}`,
    rule: statement.rule,
    title: statement.title,
    action: statement.action,
    error_type: statement.error_type,
    tool: statement.tool,
    count: evidence.length,
    fatal: evidence.filter((entry) => entry.fatal === true).length,
    first_line: first?.line ?? null,
    last_line: last?.line ?? null,
    first_event_id: first?.event_id ?? null,
    last_event_id: last?.event_id ?? null,
    evidence,
    basis: statement.basis,
    does_not_establish: statement.does_not_establish,
  };
}

/** `error.recorded x2` for one sources distribution, the same shape the other reports print. */
function sourcesText(sources: { value: string; count: number }[]): string {
  return sources.map((source) => `${source.value} x${source.count}`).join(", ");
}

/**
 * Builds the suggestion report.
 *
 * The grouping is over `errors.occurrences` rather than over the events, so every count
 * here is the count `trace errors` reports for the same event and the two commands cannot
 * drift. The two rules that are not about failures read the events directly, because
 * `errors` does not carry permission decisions or the absence of a terminal event; both
 * use the same predicate the analyzer uses to count them.
 */
export function buildFixSuggest(errors: ErrorsReport, events: LoadedEvent[]): FixSuggestReport {
  const statements: { statement: RuleStatement; evidence: FixEvidence[] }[] = [];

  // 1. A file with no terminal event is a prefix, and a failure profile read off a
  // prefix is the one thing most likely to send a reader the wrong way.
  if (errors.status === "incomplete") {
    const last = events[events.length - 1];
    const evidence: FixEvidence[] =
      last === undefined
        ? []
        : [
            {
              line: last.line,
              event_id: asText(asRecord(last.event)?.event_id) ?? "",
              event: asText(asRecord(last.event)?.type) ?? "unknown",
              note: "the last event in the file",
              fatal: null,
            },
          ];
    statements.push({
      statement: {
        rule: "incomplete_run",
        title: "the trace has no terminal event",
        action: "treat this failure profile as a prefix and recover the rest of the run before acting on it",
        basis: `the file records ${errors.events} event${plural(errors.events)} and none of them is run.finished, run.failed or run.cancelled`,
        does_not_establish:
          "why the recording stopped is not in the file, so the failures listed here may be the whole story or a fraction of it",
        error_type: null,
        tool: null,
      },
      evidence,
    });
  }

  // 2. A related_event_id that points nowhere makes every reference in the file a little
  // less trustworthy, which is worth saying before the failures are read.
  for (const reference of errors.dangling_references) {
    const loaded = eventAt(events, reference.line);
    const record = asRecord(loaded?.event);
    statements.push({
      statement: {
        rule: "dangling_reference",
        title: "an event points at an event id this file does not carry",
        action: "check whether the trace was truncated or the recorder wrote the wrong id before trusting related_event_id",
        basis: `line ${reference.line}: ${reference.event_id} points at ${reference.referenced}`,
        does_not_establish:
          "the referenced event is absent from this file; whether it ever existed is not recorded here",
        error_type: null,
        tool: null,
      },
      evidence: [
        {
          line: reference.line,
          event_id: reference.event_id,
          event: asText(record?.type) ?? "unknown",
          note: `points at ${reference.referenced}, which no event in the file claims`,
          fatal: null,
        },
      ],
    });
  }

  // 3. and 4. The failure rules, over the occurrences `errors` already grouped. Classes
  // come in the order `errors` uses, so the dominant failure is suggested first.
  const realByClass = new Map<string, ErrorOccurrence[]>();
  const fatalByClass = new Map<string, ErrorOccurrence[]>();
  const realByTool = new Map<string, ErrorOccurrence[]>();
  const refusals: ErrorOccurrence[] = [];
  const refusedByTool = new Map<string, number>();
  for (const occurrence of errors.occurrences) {
    if (occurrence.guardrail_refusal === true) {
      refusals.push(occurrence);
      if (occurrence.tool !== null) {
        refusedByTool.set(occurrence.tool, (refusedByTool.get(occurrence.tool) ?? 0) + 1);
      }
      continue;
    }
    const kept = realByClass.get(occurrence.type);
    if (kept === undefined) {
      realByClass.set(occurrence.type, [occurrence]);
    } else {
      kept.push(occurrence);
    }
    if (occurrence.fatal === true) {
      const fatalKept = fatalByClass.get(occurrence.type);
      if (fatalKept === undefined) {
        fatalByClass.set(occurrence.type, [occurrence]);
      } else {
        fatalKept.push(occurrence);
      }
    }
    if (occurrence.tool !== null) {
      const toolKept = realByTool.get(occurrence.tool);
      if (toolKept === undefined) {
        realByTool.set(occurrence.tool, [occurrence]);
      } else {
        toolKept.push(occurrence);
      }
    }
  }

  for (const row of errors.classes) {
    const fatal = fatalByClass.get(row.type) ?? [];
    if (fatal.length > 0) {
      statements.push({
        statement: {
          rule: "fatal_failure",
          title: `${fatal.length} occurrence${plural(fatal.length)} of ${row.type} ${fatal.length === 1 ? "was" : "were"} recorded fatal`,
          action: `start from the fatal occurrence${plural(fatal.length)} of ${row.type}; they are the ones the recorder marked fatal`,
          basis: `class ${row.type} has ${fatal.length} fatal occurrence${plural(fatal.length)} of ${row.count} in this trace`,
          does_not_establish: "fatal is the recorder's label; the trace does not record what qualified an error as fatal",
          error_type: row.type,
          tool: null,
        },
        evidence: fatal.map(occurrenceEvidence),
      });
    }
  }

  for (const row of errors.classes) {
    const kept = realByClass.get(row.type) ?? [];
    if (kept.length < 2) {
      continue;
    }
    const sources = new Map<string, number>();
    for (const occurrence of kept) {
      sources.set(occurrence.event, (sources.get(occurrence.event) ?? 0) + 1);
    }
    statements.push({
      statement: {
        rule: "repeated_error_class",
        title: `the error class ${row.type} was recorded ${kept.length} times`,
        action: `look for one shared cause across the ${kept.length} occurrences of ${row.type} before treating them as separate failures`,
        basis: `class ${row.type} occurred ${kept.length} time${plural(kept.length)} (${kept.filter((entry) => entry.fatal === true).length} fatal) from ${sourcesText(distribution(sources))}`,
        does_not_establish: "repetition does not establish a shared cause; the occurrences may be independent",
        error_type: row.type,
        tool: null,
      },
      evidence: kept.map(occurrenceEvidence),
    });
  }

  // 5. One suggestion per failing tool, most failures first, so the tool that broke most
  // often is the one read first. Refusals are counted apart and mentioned in the basis,
  // because a refused call is not a broken one.
  const tools = Array.from(realByTool.entries()).sort((left, right) =>
    right[1].length - left[1].length || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
  );
  for (const [tool, kept] of tools) {
    const refused = refusedByTool.get(tool) ?? 0;
    statements.push({
      statement: {
        rule: "tool_failure",
        title: `the tool ${tool} failed ${kept.length} time${plural(kept.length)}`,
        action: `inspect what ${tool} was asked and what came back on each failed call`,
        basis:
          `${tool} has ${kept.length} failed call${plural(kept.length)} in this trace` +
          `${refused === 0 ? "" : `, plus ${refused} refused call${plural(refused)} reported apart`}`,
        does_not_establish: "the trace records that the call failed, not whether the tool, its input or its environment was at fault",
        tool,
        error_type: null,
      },
      evidence: kept.map(occurrenceEvidence),
    });
  }

  // 6. Permission decisions are not errors, so `errors` does not carry them; the scan
  // below is the same predicate `summarize` counts with, and a denied call is a plausible
  // reason a later tool never ran.
  const denied: FixEvidence[] = [];
  for (const { line, event } of events) {
    const record = asRecord(event);
    if (asText(record?.type) !== "permission.resolved") {
      continue;
    }
    const payload = payloadOf(event);
    if (payload.decision !== "denied") {
      continue;
    }
    const decidedBy = asText(payload.decided_by);
    denied.push({
      line,
      event_id: asText(record?.event_id) ?? "",
      event: "permission.resolved",
      note: decidedBy === null ? "permission denied" : `permission denied by ${decidedBy}`,
      fatal: null,
    });
  }
  if (denied.length > 0) {
    statements.push({
      statement: {
        rule: "permission_denied",
        title: `${denied.length} permission request${plural(denied.length)} ${denied.length === 1 ? "was" : "were"} denied`,
        action: "check whether the denials are what the failures rest on; a tool that never ran cannot have succeeded",
        basis: `the file records ${denied.length} denied permission decision${plural(denied.length)}`,
        does_not_establish: "a denial is a decision, not an error; whether it was the right decision is not recorded",
        error_type: null,
        tool: null,
      },
      evidence: denied,
    });
  }

  // 7. Refusals last, and never as failures: the guard did its job, so the direction is
  // a policy or request change rather than anything about the tool.
  if (refusals.length > 0) {
    statements.push({
      statement: {
        rule: "guardrail_refusals",
        title: `${refusals.length} call${plural(refusals.length)} ${refusals.length === 1 ? "was" : "were"} refused by a guard`,
        action: "review the guard policy and the requests that tripped it; a refused call was blocked on purpose, so the direction is a policy or request change rather than a retry",
        basis: `the file records ${refusals.length} guardrail refusal${plural(refusals.length)}`,
        does_not_establish: "a refusal is not a failure; whether the guard was right is not recorded",
        error_type: null,
        tool: null,
      },
      evidence: refusals.map(occurrenceEvidence),
    });
  }

  const suggestions = statements.map((entry, index) => finish(entry.statement, entry.evidence, index));

  const unverified: string[] = [
    "a suggestion names a direction to look, derived from a pattern in this trace; it is not a verified cause, and none of them were executed",
    "what each suggestion does not establish is stated beside it, under does_not_establish",
  ];
  if (suggestions.length === 0) {
    unverified.push(
      "the trace records no pattern this slice knows how to suggest about, which is not a claim that the run was healthy",
    );
  }

  return {
    command: "fix-suggest",
    file: errors.file,
    schema: errors.schema,
    run_id: errors.run_id,
    status: readRunOutcome(events).status,
    input_summary: readInputSummary(events),
    events: errors.events,
    failures: errors.failures,
    errors: errors.errors,
    refusals: errors.refusals,
    suggestions,
    unverified,
  };
}
