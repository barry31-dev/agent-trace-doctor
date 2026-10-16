import { asText, distribution, payloadOf } from "./analyze.js";
import type { Distribution, RunStatus } from "./analyze.js";
import type { ErrorOccurrence, ErrorsReport } from "./errors.js";
import type { LoadedEvent } from "./loader.js";

/**
 * Eval-case generation from one validated trace.
 *
 * `errors` says what went wrong in a run; nothing says what a rerun of that run has to
 * avoid. This turns the failures of one trace into the smallest set of assertions that
 * can be checked against a later run: one case per error class, each carrying the
 * occurrences it was built from, so a reader can go from an assertion back to the exact
 * line and event that justify it.
 *
 * The cases are derived from the `errors` report rather than recomputed from the
 * events: the counts in a case describe the occurrences that case carries, and the
 * occurrences come from the list `errors` already built. Nothing here touches the
 * clock, the file system or the network, so the same trace always produces the same
 * bytes. What is written to disk, if anything, is the CLI's business, not this one's.
 */

/** One regression assertion plus the evidence it rests on. */
export interface EvalCase {
  /** Stable within one report: `case_001`, `case_002`, in class order. */
  case_id: string;
  /** `error.type`, the same class `errors` and `compare` report. */
  error_type: string;
  /**
   * The assertion in words. Deliberately about the class alone: which tools carried it
   * is in `tools` below, and an assertion that named them would read as one claim while
   * being two.
   */
  expectation: string;
  /** Occurrences this case carries, which is `occurrences.length`. */
  count: number;
  /** How many of those were recorded as fatal. */
  fatal: number;
  /** Event types that produced this class in this trace, most frequent first. */
  sources: Distribution[];
  /** Tools that produced it, by name; empty when the failures name no tool. */
  tools: string[];
  first_line: number | null;
  last_line: number | null;
  first_event_id: string | null;
  last_event_id: string | null;
  /**
   * Every occurrence the case rests on, in file order, exactly as `errors` reports
   * them. Guardrail refusals are not among them: a refusal is the guard doing its job,
   * so an assertion that the run must not refuse would ask for the guard to be removed.
   */
  occurrences: ErrorOccurrence[];
}

export interface EvalGenReport {
  command: "eval-gen";
  file: string;
  schema: string;
  run_id: string | null;
  /** How the run ended, so cases from a cancelled run are not read as a clean bill. */
  status: RunStatus;
  /** `run.started.input_summary` as the recorder wrote it, the scenario the cases belong to. */
  input_summary: string | null;
  /** Events in the file, not the number of failures. */
  events: number;
  /** Every failure event, refusals included, as `errors` counts them. */
  failures: number;
  /** Failures that are not guardrail refusals: the ones cases are built from. */
  errors: number;
  /** Guardrail refusals, reported apart for the same reason `errors` keeps them apart. */
  refusals: number;
  cases: EvalCase[];
  /**
   * Error classes that produced no case because every occurrence of them was a
   * refusal. Listed rather than dropped, so a reader looking for a class `errors`
   * reported can see it was seen here and left alone on purpose.
   */
  skipped_refusals: string[];
}

/**
 * The run's own `input_summary`, or null when no `run.started` carried one. Read from
 * the events rather than from the errors report because that report does not carry it,
 * and a case without the scenario it belongs to cannot be rerun.
 */
export function readInputSummary(events: LoadedEvent[]): string | null {
  for (const { event } of events) {
    const record = event as Record<string, unknown> | null;
    if (record === null || record.type !== "run.started") {
      continue;
    }
    return asText(payloadOf(event).input_summary);
  }
  return null;
}

/** Distinct tool names of one set of occurrences, ordered so the same input always prints the same. */
function toolsOf(occurrences: ErrorOccurrence[]): string[] {
  const names = new Set<string>();
  for (const occurrence of occurrences) {
    if (occurrence.tool !== null) {
      names.add(occurrence.tool);
    }
  }
  return Array.from(names).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Builds the eval-case report. Cases follow the class order `errors` already uses, so
 * the dominant failure comes first and two runs with the same classes print in the same
 * order. A class whose every occurrence was a refusal produces no case; a class with
 * both real failures and refusals produces a case over the real ones only, which is why
 * a case's `count` can be lower than the same class's count in `errors`.
 */
export function buildEvalGen(errors: ErrorsReport, inputSummary: string | null): EvalGenReport {
  const byClass = new Map<string, ErrorOccurrence[]>();
  for (const occurrence of errors.occurrences) {
    if (occurrence.guardrail_refusal === true) {
      continue;
    }
    const kept = byClass.get(occurrence.type);
    if (kept === undefined) {
      byClass.set(occurrence.type, [occurrence]);
    } else {
      kept.push(occurrence);
    }
  }

  const cases: EvalCase[] = [];
  const skippedRefusals: string[] = [];
  for (const row of errors.classes) {
    const kept = byClass.get(row.type) ?? [];
    if (kept.length === 0) {
      skippedRefusals.push(row.type);
      continue;
    }
    const first = kept[0];
    const last = kept[kept.length - 1];
    const sources = new Map<string, number>();
    for (const occurrence of kept) {
      sources.set(occurrence.event, (sources.get(occurrence.event) ?? 0) + 1);
    }
    cases.push({
      case_id: `case_${String(cases.length + 1).padStart(3, "0")}`,
      error_type: row.type,
      expectation: `a rerun of this scenario must not record the error class ${row.type}`,
      count: kept.length,
      fatal: kept.filter((occurrence) => occurrence.fatal === true).length,
      sources: distribution(sources),
      tools: toolsOf(kept),
      first_line: first?.line ?? null,
      last_line: last?.line ?? null,
      first_event_id: first?.event_id ?? null,
      last_event_id: last?.event_id ?? null,
      occurrences: kept,
    });
  }

  return {
    command: "eval-gen",
    file: errors.file,
    schema: errors.schema,
    run_id: errors.run_id,
    status: errors.status,
    input_summary: inputSummary,
    events: errors.events,
    failures: errors.failures,
    errors: errors.errors,
    refusals: errors.refusals,
    cases,
    skipped_refusals: skippedRefusals.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  };
}
