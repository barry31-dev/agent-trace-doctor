import { buildErrors } from "./errors.js";
import { buildTools } from "./tools.js";
import type { ErrorClassRow } from "./errors.js";
import type { ToolRow } from "./tools.js";
import type { RunStatus } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";

/**
 * Failure-profile comparison of two validated traces.
 *
 * `diff` answers "what differs between these two runs" event by event, which is the
 * wrong shape for the question a developer has after changing a prompt or a tool: did
 * the run get worse? This answers that one. It compares the failure profile only: the
 * run status, the failure totals, every error class and every tool that failed
 * somewhere, each with its counts in both traces and the delta between them. Events
 * that did not fail are `diff`'s business, so two completely different runs that
 * failed in the same way compare identical here.
 *
 * The numbers are not recomputed: each side is aggregated by `buildErrors` and
 * `buildTools`, so a counter in this report is the same counter those commands print,
 * and the two cannot drift apart. Like them it is a pure function over loaded events:
 * no clock, no file system, no network, so the same pair of files always produces the
 * same bytes.
 */

/**
 * How one row moved between the two traces. `new` and `resolved` are used only when
 * one side never had the row at all; `shifted` means the count held still while the
 * composition moved, for example the same number of failures with one more of them
 * fatal, which is a change a count-only verdict would call "unchanged".
 */
export type CompareVerdict = "new" | "resolved" | "increased" | "decreased" | "shifted" | "unchanged";

/** One side of an error-class comparison. Null when the class never occurred there. */
export interface ErrorClassSide {
  count: number;
  fatal: number;
  refusals: number;
  first_line: number | null;
  first_event_id: string | null;
}

export interface ErrorClassComparison {
  /** `error.type`, the stable error class. */
  type: string;
  a: ErrorClassSide | null;
  b: ErrorClassSide | null;
  /** `count_b - count_a`, with an absent side counted as zero. */
  delta: number;
  fatal_delta: number;
  refusals_delta: number;
  verdict: CompareVerdict;
}

export interface ToolComparison {
  tool: string;
  calls_a: number;
  calls_b: number;
  failed_a: number;
  failed_b: number;
  /** Failed calls that were guardrail refusals, a subset of `failed` on the same side. */
  refusals_a: number;
  refusals_b: number;
  failed_delta: number;
  /** Where the tool first appears in each file; null when it never appears there. */
  first_line_a: number | null;
  first_line_b: number | null;
  first_event_id_a: string | null;
  first_event_id_b: string | null;
  verdict: CompareVerdict;
}

/** The facts one trace contributes to the comparison, as `errors` reports them. */
export interface RunFacts {
  run_id: string | null;
  status: RunStatus;
  events: number;
  failures: number;
  errors: number;
  refusals: number;
  fatal: number;
}

export interface CompareReport {
  command: "compare";
  schema: string;
  files: { a: string; b: string };
  runs: { a: RunFacts; b: RunFacts };
  /**
   * Whether the two runs ended differently. Counted as one difference on its own: a
   * run that was cancelled and a run that completed both have zero failures, and
   * calling that pair identical would read as an all-clear for the cancellation.
   */
  status_changed: boolean;
  classes: ErrorClassComparison[];
  tools: ToolComparison[];
  /**
   * Everything that moved: the status change, every class whose verdict is not
   * `unchanged` and every failing tool whose verdict is not `unchanged`. Stated so a
   * reader can reconcile the closing line against the two tables.
   */
  differences: number;
  identical: boolean;
}

function classSide(row: ErrorClassRow | undefined): ErrorClassSide | null {
  if (row === undefined) {
    return null;
  }
  return {
    count: row.count,
    fatal: row.fatal,
    refusals: row.refusals,
    first_line: row.first_line,
    first_event_id: row.first_event_id,
  };
}

/**
 * One verdict rule for both tables. An absent side wins, because "this never happened
 * there" is a different statement from "this happened fewer times"; then the primary
 * count decides; and only when the count holds still do the secondary counters get a
 * say, so a same-count change in composition still shows up as a difference.
 */
function verdictOf(absentA: boolean, absentB: boolean, delta: number, secondaryDelta: number): CompareVerdict {
  if (absentA) {
    return "new";
  }
  if (absentB) {
    return "resolved";
  }
  if (delta > 0) {
    return "increased";
  }
  if (delta < 0) {
    return "decreased";
  }
  if (secondaryDelta !== 0) {
    return "shifted";
  }
  return "unchanged";
}

/** Biggest movement first, then the larger second-trace count, then the name. */
function byMovementThenName(
  left: { delta: number; name: string; countB: number },
  right: { delta: number; name: string; countB: number },
): number {
  const leftMovement = Math.abs(left.delta);
  const rightMovement = Math.abs(right.delta);
  if (leftMovement !== rightMovement) {
    return rightMovement - leftMovement;
  }
  if (left.countB !== right.countB) {
    return right.countB - left.countB;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function runFacts(
  runId: string | null,
  status: RunStatus,
  events: number,
  failures: number,
  errors: number,
  refusals: number,
  fatal: number,
): RunFacts {
  return { run_id: runId, status, events, failures, errors, refusals, fatal };
}

/**
 * Compares the failure profiles of two validated traces. Both sides must have passed
 * `validateEvents` first: the caller relies on that for unique event ids and one run
 * id per file, none of which this function re-checks.
 */
export function buildCompare(
  fileA: string,
  fileB: string,
  schemaLabel: string,
  eventsA: LoadedEvent[],
  eventsB: LoadedEvent[],
): CompareReport {
  const errorsA = buildErrors(fileA, schemaLabel, eventsA);
  const errorsB = buildErrors(fileB, schemaLabel, eventsB);
  const toolsA = buildTools(fileA, schemaLabel, eventsA);
  const toolsB = buildTools(fileB, schemaLabel, eventsB);

  const classRowsA = new Map(errorsA.classes.map((row) => [row.type, row]));
  const classRowsB = new Map(errorsB.classes.map((row) => [row.type, row]));
  const classTypes = Array.from(new Set([...classRowsA.keys(), ...classRowsB.keys()]));
  const classes: ErrorClassComparison[] = classTypes.map((type) => {
    const a = classSide(classRowsA.get(type));
    const b = classSide(classRowsB.get(type));
    const delta = (b?.count ?? 0) - (a?.count ?? 0);
    const fatalDelta = (b?.fatal ?? 0) - (a?.fatal ?? 0);
    const refusalsDelta = (b?.refusals ?? 0) - (a?.refusals ?? 0);
    return {
      type,
      a,
      b,
      delta,
      fatal_delta: fatalDelta,
      refusals_delta: refusalsDelta,
      verdict: verdictOf(a === null, b === null, delta, fatalDelta === 0 ? refusalsDelta : fatalDelta),
    };
  });
  classes.sort((left, right) =>
    byMovementThenName(
      { delta: left.delta, name: left.type, countB: left.b?.count ?? 0 },
      { delta: right.delta, name: right.type, countB: right.b?.count ?? 0 },
    ),
  );

  const toolRowsA = new Map(toolsA.tools.map((row) => [row.tool, row]));
  const toolRowsB = new Map(toolsB.tools.map((row) => [row.tool, row]));
  // Only tools that failed somewhere are listed. A tool that was called ten times
  // without failing is not part of a failure profile, and listing it would push the
  // tools that did fail below the fold.
  const failingTools = Array.from(new Set([...toolRowsA.keys(), ...toolRowsB.keys()])).filter(
    (tool) => (toolRowsA.get(tool)?.failed ?? 0) > 0 || (toolRowsB.get(tool)?.failed ?? 0) > 0,
  );
  const tools: ToolComparison[] = failingTools.map((tool) => {
    const rowA: ToolRow | undefined = toolRowsA.get(tool);
    const rowB: ToolRow | undefined = toolRowsB.get(tool);
    const failedDelta = (rowB?.failed ?? 0) - (rowA?.failed ?? 0);
    const refusalsDelta = (rowB?.guardrail_refusals ?? 0) - (rowA?.guardrail_refusals ?? 0);
    return {
      tool,
      calls_a: rowA?.calls ?? 0,
      calls_b: rowB?.calls ?? 0,
      failed_a: rowA?.failed ?? 0,
      failed_b: rowB?.failed ?? 0,
      refusals_a: rowA?.guardrail_refusals ?? 0,
      refusals_b: rowB?.guardrail_refusals ?? 0,
      failed_delta: failedDelta,
      first_line_a: rowA?.first_line ?? null,
      first_line_b: rowB?.first_line ?? null,
      first_event_id_a: rowA?.first_event_id ?? null,
      first_event_id_b: rowB?.first_event_id ?? null,
      // A tool that never appears in a trace is a different statement from one that
      // appears and never fails, so absence is read off the presence of a row rather
      // than off a zero counter.
      verdict: verdictOf(rowA === undefined, rowB === undefined, failedDelta, refusalsDelta),
    };
  });
  tools.sort((left, right) =>
    byMovementThenName(
      { delta: left.failed_delta, name: left.tool, countB: left.failed_b },
      { delta: right.failed_delta, name: right.tool, countB: right.failed_b },
    ),
  );

  const runs = {
    a: runFacts(errorsA.run_id, errorsA.status, errorsA.events, errorsA.failures, errorsA.errors, errorsA.refusals, errorsA.fatal),
    b: runFacts(errorsB.run_id, errorsB.status, errorsB.events, errorsB.failures, errorsB.errors, errorsB.refusals, errorsB.fatal),
  };
  const statusChanged = runs.a.status !== runs.b.status;
  const differences =
    (statusChanged ? 1 : 0) +
    classes.filter((row) => row.verdict !== "unchanged").length +
    tools.filter((row) => row.verdict !== "unchanged").length;

  return {
    command: "compare",
    schema: schemaLabel,
    files: { a: fileA, b: fileB },
    runs,
    status_changed: statusChanged,
    classes,
    tools,
    differences,
    identical: differences === 0,
  };
}
