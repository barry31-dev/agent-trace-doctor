import type { ValidationReport } from "./validate.js";
import type { SummaryReport, TimelineReport } from "./analyze.js";
import type { DiffChange, DiffReport } from "./diff.js";
import type { ExplainReport } from "./explain.js";
import type { ShowReport } from "./show.js";
import type { ToolsReport } from "./tools.js";
import type { ErrorsReport } from "./errors.js";
import type { EvalCase, EvalGenReport } from "./evalGen.js";
import type { EvalGenWithModel } from "./evalGenModel.js";
import type { CompareReport, ErrorClassComparison, ToolComparison } from "./compare.js";
import type { CompareModelSection, CompareWithModel } from "./compareModel.js";
import type { FixSuggestion, FixSuggestReport } from "./fixSuggest.js";
import type { FixSuggestWithModel } from "./fixSuggestModel.js";
import type { ModelFinding } from "./model/types.js";

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

/**
 * The model section, as both `explain` and `compare` print it.
 *
 * One renderer serves both so the two commands cannot drift into describing the same
 * call two different ways. `skipped` is passed in rather than read off the section
 * because only `compare` has the case: it is the one command that can be asked for a
 * model reading of a comparison that has no difference in it. `eval-gen` joins them,
 * with the case of a trace that produced no case at all, so the parameter is the
 * structural shape rather than one command's named type.
 */
function modelSectionLines(
  section: Omit<CompareModelSection, "skipped"> | Omit<EvalGenWithModel["model"], "skipped">,
  skipped: string | null,
): string[] {
  const lines: string[] = ["", "model"];
  if (!section.enabled) {
    lines.push("  disabled");
    return lines;
  }
  lines.push(
    ...labelRows([
      ["ok", String(section.ok)],
      ["provider", section.provider ?? NONE],
      ["model", section.model ?? NONE],
      ["requests", String(section.requests)],
      ["events sent", String(section.sent_events)],
      ["bytes sent", String(section.request_bytes)],
      ["redacted fields", String(section.redacted_fields)],
      ["error", section.error === null ? NONE : `${section.error.kind}: ${section.error.message}`],
    ])
      .trimEnd()
      .split("\n"),
  );
  if (skipped !== null) {
    lines.push(`  - ${skipped}`);
  }
  for (const note of section.unverified) {
    lines.push(`  - ${note}`);
  }
  return lines;
}

/** The findings block. Empty findings print as `none` rather than as nothing. */
function findingsLines(findings: ModelFinding[]): string[] {
  const lines: string[] = ["", "findings"];
  if (findings.length === 0) {
    lines.push("  none");
    return lines;
  }
  for (const finding of findings) {
    lines.push(`  ${finding.id}  ${finding.severity}  confidence ${finding.confidence}  evidence ${finding.evidence.join(", ")}`);
    lines.push(`      claim      ${finding.claim}`);
    lines.push(`      suggestion ${finding.suggestion}`);
  }
  return lines;
}

/** The unverified block: what the report does not establish, never model-written. */
function unverifiedLines(notes: string[]): string[] {
  const lines: string[] = ["", "unverified"];
  if (notes.length === 0) {
    lines.push("  none");
    return lines;
  }
  lines.push(...notes.map((note) => `  - ${note}`));
  return lines;
}

/**
 * Terminal rendering. Plain text only: no color carries information, and the field
 * order never depends on terminal width, so this and `--json` stay comparable.
 */
export function renderText(report: ValidationReport): string {
  const lines: string[] = [];
  for (const error of report.errors) {
    const where = error.line === null ? "" : `line ${error.line} `;
    const who = error.event_id === null ? "" : `(${error.event_id}) `;
    const path = error.path.length > 0 ? `${error.path}: ` : "";
    lines.push(`error: ${where}${who}${path}${error.message}`);
  }
  if (report.valid) {
    lines.push(`ok: ${report.file}: ${report.events} event${plural(report.events)} validated against ${report.schema}`);
  } else if (report.errors.some((error) => error.check === "write")) {
    // The trace was read and the report was built; what failed is the last step. Saying
    // "input could not be read" here would send a reader to the one file that is fine.
    lines.push("nothing was written");
  } else if (report.errors.some((error) => error.check === "load")) {
    lines.push("input could not be read");
  } else {
    lines.push(`invalid: ${report.errors.length} error${plural(report.errors.length)} in ${report.file}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Machine rendering. Keys are written in the literal order below and never depend on
 * terminal width or locale, so the same input always yields the same bytes.
 */
export function renderJson(report: ValidationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const UNKNOWN = "unknown";
const NONE = "none";

function labelRows(rows: [string, string][]): string {
  const width = rows.reduce((widest, [label]) => Math.max(widest, label.length), 0);
  return `${rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n")}\n`;
}

/**
 * Terminal rendering of `summary`. Labels are padded to the widest label in this
 * report, which depends only on the field names, so the same input always produces
 * the same bytes and the numbers line up in one column.
 */
export function renderSummaryText(summary: SummaryReport): string {
  return labelRows([
    ["file", summary.file],
    ["schema", summary.schema],
    ["run_id", summary.run_id ?? UNKNOWN],
    ["status", summary.status],
    ["terminal event", summary.terminal_event_id ?? NONE],
    ["started at", summary.started_at ?? UNKNOWN],
    ["ended at", summary.ended_at ?? UNKNOWN],
    ["duration", summary.duration_ms === null ? UNKNOWN : `${summary.duration_ms} ms`],
    ["events", String(summary.events)],
    ["models", summary.models.length === 0 ? NONE : summary.models.join(", ")],
    ["model requests", String(summary.model_requests)],
    ["model responses completed", String(summary.model_responses_completed)],
    ["model responses failed", String(summary.model_responses_failed)],
    ["tool calls", String(summary.tool_calls)],
    ["tool calls completed", String(summary.tool_calls_completed)],
    ["tool calls failed", String(summary.tool_calls_failed)],
    ["guardrail refusals", String(summary.tool_guardrail_refusals)],
    ["permissions requested", String(summary.permissions_requested)],
    ["permissions approved", String(summary.permissions_approved)],
    ["permissions denied", String(summary.permissions_denied)],
    ["context compactions", String(summary.context_compactions)],
    ["errors recorded", String(summary.errors_recorded)],
    ["fatal errors", String(summary.errors_fatal)],
    ["tokens input", String(summary.tokens.input)],
    ["tokens output", String(summary.tokens.output)],
    ["tokens cache read", String(summary.tokens.cache_read)],
    ["tokens cache write", String(summary.tokens.cache_write)],
    ["tokens reasoning", String(summary.tokens.reasoning)],
  ]);
}

/** Machine rendering of `summary`. Keys keep the literal order of the interface. */
export function renderSummaryJson(summary: SummaryReport): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

interface Column {
  header: string;
  align: "left" | "right";
  cells: string[];
}

/**
 * Fixed-width table. Column widths come from the widest cell in the column, never
 * from the terminal, so a wide window changes nothing and a narrow one never wraps.
 * Trailing padding is trimmed because it carries no information.
 */
export function renderTable(columns: Column[]): string {
  const widths = columns.map((column) =>
    column.cells.reduce((widest, cell) => Math.max(widest, cell.length), column.header.length),
  );
  const pad = (value: string, index: number, align: "left" | "right"): string =>
    align === "right" ? value.padStart(widths[index] ?? value.length) : value.padEnd(widths[index] ?? value.length);
  const header = columns.map((column, index) => pad(column.header, index, column.align)).join("  ").trimEnd();
  const rows = columns[0]?.cells.map((_, row) =>
    columns
      .map((column, index) => pad(column.cells[row] ?? "", index, column.align))
      .join("  ")
      .trimEnd(),
  );
  return [header, ...(rows ?? [])].join("\n") + "\n";
}

/** Terminal rendering of `timeline`: one line per event, in file order. */
export function renderTimelineText(timeline: TimelineReport): string {
  return renderTable([
    { header: "step", align: "right", cells: timeline.events.map((entry) => String(entry.step)) },
    { header: "offset_ms", align: "right", cells: timeline.events.map((entry) => String(entry.offset_ms)) },
    { header: "line", align: "right", cells: timeline.events.map((entry) => String(entry.line)) },
    { header: "event_id", align: "left", cells: timeline.events.map((entry) => entry.event_id) },
    { header: "type", align: "left", cells: timeline.events.map((entry) => entry.type) },
    { header: "summary", align: "left", cells: timeline.events.map((entry) => entry.summary) },
  ]);
}

/** Machine rendering of `timeline`. Keys keep the literal order of the interface. */
export function renderTimelineJson(timeline: TimelineReport): string {
  return `${JSON.stringify(timeline, null, 2)}\n`;
}

/**
 * Terminal rendering of one compared value. Scalars print as they are, structures as
 * compact JSON, and an absent field as `absent` rather than an empty cell.
 */
function renderValue(value: unknown): string {
  if (value === null) {
    return "absent";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function valueRows(changes: DiffChange[]): string[] {
  const width = changes.reduce((widest, change) => Math.max(widest, (change.field ?? "").length), 0);
  return changes.map(
    (change) => `${(change.field ?? "").padEnd(width)}  ${renderValue(change.a)} -> ${renderValue(change.b)}`,
  );
}

function eventRows(changes: DiffChange[]): string[] {
  const idWidth = changes.reduce((widest, change) => Math.max(widest, (change.event_id ?? "").length), 0);
  const typeWidth = changes.reduce((widest, change) => Math.max(widest, (change.type ?? "").length), 0);
  const lines: string[] = [];
  for (const change of changes) {
    const id = (change.event_id ?? "").padEnd(idWidth);
    const type = (change.type ?? "").padEnd(typeWidth);
    if (change.kind === "event_added") {
      lines.push(`+ ${id}  ${type}  only in b: line ${change.line_b}`);
      continue;
    }
    if (change.kind === "event_removed") {
      lines.push(`- ${id}  ${type}  only in a: line ${change.line_a}`);
      continue;
    }
    lines.push(`~ ${id}  ${type}  line ${change.line_a} / line ${change.line_b}`);
    for (const field of change.fields) {
      lines.push(`      ${field.path}: ${renderValue(field.a)} -> ${renderValue(field.b)}`);
    }
  }
  return lines;
}

/**
 * Terminal rendering of `diff`. A section appears only when it carries a change, so an
 * identical pair prints one line. Columns are padded to the widest entry in this
 * report, never to the terminal.
 */
export function renderDiffText(report: DiffReport): string {
  if (report.identical) {
    return `ok: ${report.files.a} and ${report.files.b} are identical\n`;
  }
  const runChanges = report.changes.filter((change) => change.kind === "run");
  const summaryChanges = report.changes.filter((change) => change.kind === "summary");
  const eventChanges = report.changes.filter(
    (change) => change.kind === "event_added" || change.kind === "event_removed" || change.kind === "event_changed",
  );
  const lines: string[] = [];
  if (runChanges.length > 0) {
    lines.push("run", ...valueRows(runChanges));
  }
  if (summaryChanges.length > 0) {
    lines.push("summary", ...valueRows(summaryChanges));
  }
  if (eventChanges.length > 0) {
    lines.push("events", ...eventRows(eventChanges));
  }
  lines.push(`diff: ${report.changes.length} change${plural(report.changes.length)}`);
  return `${lines.join("\n")}\n`;
}

/** Machine rendering of `diff`. Keys keep the literal order of the interfaces. */
export function renderDiffJson(report: DiffReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Terminal rendering of `explain`.
 *
 * Sections appear in the order a reader needs them: what the trace says, what a model
 * added, what neither establishes. Padding comes from the widest entry in this report
 * and never from the terminal, so a narrow window never reflows the output.
 */
export function renderExplainText(report: ExplainReport): string {
  const lines: string[] = labelRows([
    ["file", report.file],
    ["schema", report.schema],
    ["run_id", report.run_id ?? UNKNOWN],
    ["status", report.status],
    ["events", String(report.events)],
  ]).trimEnd().split("\n");

  lines.push("", "observations");
  if (report.observations.length === 0) {
    lines.push("  none");
  } else {
    const idWidth = Math.max(...report.observations.map((observation) => observation.id.length));
    const eventWidth = Math.max(...report.observations.map((observation) => (observation.event_id ?? "-").length));
    const lineWidth = Math.max(...report.observations.map((observation) => String(observation.line ?? 0).length));
    for (const observation of report.observations) {
      lines.push(
        `  ${observation.id.padEnd(idWidth)}  ${(observation.event_id ?? "-").padEnd(eventWidth)}  ` +
          `line ${String(observation.line ?? 0).padStart(lineWidth)}  ${observation.statement}`,
      );
    }
  }

  lines.push(...findingsLines(report.findings));
  lines.push(...unverifiedLines(report.unverified));
  lines.push(...modelSectionLines(report.model, null));

  return `${lines.join("\n")}\n`;
}

/** Machine rendering of `explain`. Keys keep the literal order of the interface. */
export function renderExplainJson(report: ExplainReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Terminal rendering of one payload value. Scalars print as they are and structures as
 * compact JSON on one line, so a payload never grows a row the reader has to scroll
 * past. A JSON `null` prints as `null`, because here it means the recorder wrote null
 * rather than the field being absent.
 */
function renderPayloadValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function payloadRows(payload: Record<string, unknown>): string[] {
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return ["  (no payload fields)"];
  }
  const width = keys.reduce((widest, key) => Math.max(widest, key.length), 0);
  return keys.map((key) => `  ${key.padEnd(width)}  ${renderPayloadValue(payload[key])}`);
}

/**
 * The header's selection line. It always states both numbers, because "every event"
 * and "one event" look the same on a one-event file, and names the id when exactly one
 * event was selected so the reader can see the request was honoured.
 */
function selectionLabel(report: ShowReport): string {
  const count = `${report.selected.length} of ${report.events} event${plural(report.events)}`;
  if (report.selected.length === 1) {
    return `${count}: ${report.selected[0]?.event_id ?? ""}`;
  }
  return count;
}

/**
 * Terminal rendering of `show`. The header says which file and how much of it was
 * selected, then each selected event gets its own block: where it sits, what it is,
 * the same one-line description `timeline` prints, and its payload. Padding comes from
 * the widest label in each block and never from the terminal.
 */
export function renderShowText(report: ShowReport): string {
  const lines: string[] = labelRows([
    ["file", report.file],
    ["schema", report.schema],
    ["run_id", report.run_id ?? UNKNOWN],
    ["events", String(report.events)],
    ["selected", selectionLabel(report)],
  ])
    .trimEnd()
    .split("\n");

  for (const shown of report.selected) {
    lines.push(
      "",
      ...labelRows([
        ["event", shown.event_id],
        ["line", String(shown.line)],
        ["step", String(shown.step)],
        ["offset", `${shown.offset_ms} ms`],
        ["type", shown.type],
        ["summary", shown.summary],
      ])
        .trimEnd()
        .split("\n"),
    );
    lines.push("payload", ...payloadRows(shown.payload));
  }

  return `${lines.join("\n")}\n`;
}

/** Machine rendering of `show`. Keys keep the literal order of the interface. */
export function renderShowJson(report: ShowReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * One distribution as a single cell: `none x3, applied x1`, or `-` when the recorder
 * wrote no value for it at all. The dash is the honest answer, because an empty cell
 * and "the recorder did not classify this" are the same fact here.
 */
function distributionCell(distribution: { value: string; count: number }[]): string {
  if (distribution.length === 0) {
    return "-";
  }
  return distribution.map((entry) => `${entry.value} x${entry.count}`).join(", ");
}

function numberCell(value: number | null): string {
  return value === null ? "-" : String(value);
}

/**
 * Terminal rendering of `tools`: the header, one row per tool, then what the recorder
 * declared. Rows are ordered by call count, so the tool a reader came to ask about is
 * at the top. Columns are padded to the widest entry in this report, never to the
 * terminal, so a narrow window never reflows the table.
 */
export function renderToolsText(report: ToolsReport): string {
  const lines: string[] = labelRows([
    ["file", report.file],
    ["schema", report.schema],
    ["run_id", report.run_id ?? UNKNOWN],
    ["events", String(report.events)],
    ["tool calls", String(report.tool_calls)],
  ])
    .trimEnd()
    .split("\n");

  lines.push("");
  if (report.tools.length === 0) {
    lines.push("(no tool calls)");
  } else {
    lines.push(
      ...renderTable([
        { header: "tool", align: "left", cells: report.tools.map((row) => row.tool) },
        { header: "calls", align: "right", cells: report.tools.map((row) => String(row.calls)) },
        { header: "completed", align: "right", cells: report.tools.map((row) => String(row.completed)) },
        { header: "failed", align: "right", cells: report.tools.map((row) => String(row.failed)) },
        { header: "unresolved", align: "right", cells: report.tools.map((row) => String(row.unresolved)) },
        { header: "refusals", align: "right", cells: report.tools.map((row) => String(row.guardrail_refusals)) },
        { header: "guards", align: "left", cells: report.tools.map((row) => distributionCell(row.guards)) },
        { header: "effects", align: "left", cells: report.tools.map((row) => distributionCell(row.effects)) },
        { header: "first", align: "right", cells: report.tools.map((row) => numberCell(row.first_line)) },
        { header: "last", align: "right", cells: report.tools.map((row) => numberCell(row.last_line)) },
      ])
        .trimEnd()
        .split("\n"),
    );
  }

  lines.push("", "declared tools");
  if (report.declared.length === 0) {
    lines.push("  (none declared)");
  } else {
    lines.push(
      ...renderTable([
        { header: "tool", align: "left", cells: report.declared.map((entry) => entry.tool) },
        { header: "available", align: "left", cells: report.declared.map((entry) => String(entry.available)) },
        { header: "schema_hash", align: "left", cells: report.declared.map((entry) => entry.schema_hash ?? "-") },
        { header: "calls", align: "right", cells: report.declared.map((entry) => String(entry.calls)) },
      ])
        .trimEnd()
        .split("\n")
        .map((row) => `  ${row}`),
    );
  }

  lines.push(
    "",
    ...labelRows([
      ["unused", report.unused.length === 0 ? NONE : report.unused.join(", ")],
      ["undeclared", report.undeclared.length === 0 ? NONE : report.undeclared.join(", ")],
    ])
      .trimEnd()
      .split("\n"),
  );

  return `${lines.join("\n")}\n`;
}

/** Machine rendering of `tools`. Keys keep the literal order of the interface. */
export function renderToolsJson(report: ToolsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * The `flags` cell of one occurrence. `fatal` and `guardrail_refusal` are mutually
 * exclusive in practice, because only `error.recorded` carries the first and only
 * `tool.call.failed` the second, so the cell is one word or a dash. A dash means the
 * event type has no such field, not that the recorder set it to false.
 */
function flagsCell(occurrence: { fatal: boolean | null; guardrail_refusal: boolean | null }): string {
  if (occurrence.fatal === true) {
    return "fatal";
  }
  if (occurrence.guardrail_refusal === true) {
    return "refusal";
  }
  return "-";
}

/**
 * The `context` cell of one occurrence: the tool or the model the failing event was
 * about. The report keeps `tool` and `model` apart in JSON, because a machine consumer
 * filtering on one of them should not have to guess which one a shared column meant;
 * the terminal folds them, since the neighbouring `event` column already says which
 * kind of event this is.
 */
function contextCell(occurrence: { tool: string | null; model: string | null }): string {
  return occurrence.tool ?? occurrence.model ?? "-";
}

/**
 * Terminal rendering of `errors`: the header, one row per error class, then every
 * occurrence in file order. The header leads with the run status, because a report
 * that says "0 errors" without saying the run was cancelled reads like an all-clear.
 * Columns are padded to the widest entry in this report, never to the terminal, so a
 * narrow window never reflows the table.
 */
export function renderErrorsText(report: ErrorsReport): string {
  const lines: string[] = labelRows([
    ["file", report.file],
    ["schema", report.schema],
    ["run_id", report.run_id ?? UNKNOWN],
    ["status", report.status],
    ["events", String(report.events)],
    ["failures", String(report.failures)],
    ["errors", String(report.errors)],
    ["refusals", String(report.refusals)],
    ["fatal", String(report.fatal)],
  ])
    .trimEnd()
    .split("\n");

  lines.push("");
  if (report.classes.length === 0) {
    lines.push("(no errors)");
  } else {
    lines.push(
      ...renderTable([
        { header: "type", align: "left", cells: report.classes.map((row) => row.type) },
        { header: "count", align: "right", cells: report.classes.map((row) => String(row.count)) },
        { header: "fatal", align: "right", cells: report.classes.map((row) => String(row.fatal)) },
        { header: "refusals", align: "right", cells: report.classes.map((row) => String(row.refusals)) },
        { header: "sources", align: "left", cells: report.classes.map((row) => distributionCell(row.sources)) },
        { header: "first", align: "right", cells: report.classes.map((row) => numberCell(row.first_line)) },
        { header: "last", align: "right", cells: report.classes.map((row) => numberCell(row.last_line)) },
      ])
        .trimEnd()
        .split("\n"),
    );

    lines.push("", "occurrences");
    lines.push(
      ...renderTable([
        { header: "line", align: "right", cells: report.occurrences.map((entry) => String(entry.line)) },
        { header: "event_id", align: "left", cells: report.occurrences.map((entry) => entry.event_id) },
        { header: "event", align: "left", cells: report.occurrences.map((entry) => entry.event) },
        { header: "type", align: "left", cells: report.occurrences.map((entry) => entry.type) },
        { header: "flags", align: "left", cells: report.occurrences.map((entry) => flagsCell(entry)) },
        { header: "related", align: "left", cells: report.occurrences.map((entry) => entry.related_event_id ?? "-") },
        { header: "context", align: "left", cells: report.occurrences.map((entry) => contextCell(entry)) },
        { header: "message", align: "left", cells: report.occurrences.map((entry) => entry.message || "-") },
      ])
        .trimEnd()
        .split("\n")
        .map((row) => `  ${row}`),
    );
  }

  lines.push(
    "",
    ...labelRows([
      [
        "dangling",
        report.dangling_references.length === 0
          ? NONE
          : report.dangling_references.map((entry) => `${entry.event_id} -> ${entry.referenced}`).join(", "),
      ],
    ])
      .trimEnd()
      .split("\n"),
  );

  return `${lines.join("\n")}\n`;
}

/** Machine rendering of `errors`. Keys keep the literal order of the interface. */
export function renderErrorsJson(report: ErrorsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** A delta with its sign, so `+2` and `-2` cannot be misread as unsigned counts. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * The verdict cell of one error class. A `shifted` verdict carries its reason in the
 * cell, because the count columns around it show no movement and a bare "shifted"
 * would leave the reader to guess which composition changed.
 */
function classVerdictCell(row: ErrorClassComparison): string {
  if (row.verdict !== "shifted") {
    return row.verdict;
  }
  const parts: string[] = [];
  if (row.fatal_delta !== 0) {
    parts.push(`fatal ${signed(row.fatal_delta)}`);
  }
  if (row.refusals_delta !== 0) {
    parts.push(`refusals ${signed(row.refusals_delta)}`);
  }
  return `shifted (${parts.join(", ")})`;
}

/** The verdict cell of one failing tool, with the same `shifted` reasoning as classes. */
function toolVerdictCell(row: ToolComparison): string {
  if (row.verdict !== "shifted") {
    return row.verdict;
  }
  return `shifted (refusals ${signed(row.refusals_b - row.refusals_a)})`;
}

/**
 * Terminal rendering of `compare`: which two traces, the run facts side by side with
 * their deltas, then the error classes and the failing tools. Sections appear in the
 * order a reader asks the questions: did the run end differently, did it fail more,
 * which class, which tool. Columns are padded to the widest entry in this report,
 * never to the terminal, so a narrow window never reflows the tables.
 */
export function renderCompareText(report: CompareWithModel): string {
  const lines: string[] = labelRows([
    ["compare", `${report.files.a} vs ${report.files.b}`],
    ["schema", report.schema],
  ])
    .trimEnd()
    .split("\n");

  lines.push("");
  lines.push(
    ...renderTable([
      {
        header: "field",
        align: "left",
        cells: ["run_id", "status", "events", "failures", "errors", "refusals", "fatal"],
      },
      {
        header: "a",
        align: "left",
        cells: [
          report.runs.a.run_id ?? UNKNOWN,
          report.runs.a.status,
          String(report.runs.a.events),
          String(report.runs.a.failures),
          String(report.runs.a.errors),
          String(report.runs.a.refusals),
          String(report.runs.a.fatal),
        ],
      },
      {
        header: "b",
        align: "left",
        cells: [
          report.runs.b.run_id ?? UNKNOWN,
          report.runs.b.status,
          String(report.runs.b.events),
          String(report.runs.b.failures),
          String(report.runs.b.errors),
          String(report.runs.b.refusals),
          String(report.runs.b.fatal),
        ],
      },
      {
        header: "delta",
        align: "right",
        cells: [
          // The run identity is not a quantity, so it carries no delta; the status
          // says whether it moved rather than by how much.
          "-",
          report.status_changed ? "changed" : "same",
          signed(report.runs.b.events - report.runs.a.events),
          signed(report.runs.b.failures - report.runs.a.failures),
          signed(report.runs.b.errors - report.runs.a.errors),
          signed(report.runs.b.refusals - report.runs.a.refusals),
          signed(report.runs.b.fatal - report.runs.a.fatal),
        ],
      },
    ])
      .trimEnd()
      .split("\n"),
  );

  if (report.runs.a.failures === 0 && report.runs.b.failures === 0) {
    lines.push("", "(no failures in either trace)");
  } else {
    lines.push("", "error classes");
    if (report.classes.length === 0) {
      lines.push("  (no error classes)");
    } else {
      lines.push(
        ...renderTable([
          { header: "type", align: "left", cells: report.classes.map((row) => row.type) },
          { header: "a", align: "right", cells: report.classes.map((row) => (row.a === null ? "-" : String(row.a.count))) },
          { header: "b", align: "right", cells: report.classes.map((row) => (row.b === null ? "-" : String(row.b.count))) },
          { header: "delta", align: "right", cells: report.classes.map((row) => signed(row.delta)) },
          { header: "verdict", align: "left", cells: report.classes.map(classVerdictCell) },
        ])
          .trimEnd()
          .split("\n")
          .map((row) => `  ${row}`),
      );
    }

    lines.push("", "tool failures");
    if (report.tools.length === 0) {
      lines.push("  (no tool failures)");
    } else {
      lines.push(
        ...renderTable([
          { header: "tool", align: "left", cells: report.tools.map((row) => row.tool) },
          { header: "calls a", align: "right", cells: report.tools.map((row) => String(row.calls_a)) },
          { header: "calls b", align: "right", cells: report.tools.map((row) => String(row.calls_b)) },
          { header: "failed a", align: "right", cells: report.tools.map((row) => String(row.failed_a)) },
          { header: "failed b", align: "right", cells: report.tools.map((row) => String(row.failed_b)) },
          { header: "refusals a", align: "right", cells: report.tools.map((row) => String(row.refusals_a)) },
          { header: "refusals b", align: "right", cells: report.tools.map((row) => String(row.refusals_b)) },
          { header: "delta", align: "right", cells: report.tools.map((row) => signed(row.failed_delta)) },
          { header: "verdict", align: "left", cells: report.tools.map(toolVerdictCell) },
        ])
          .trimEnd()
          .split("\n")
          .map((row) => `  ${row}`),
      );
    }
  }

  // The model half sits between the tables and the verdict, so the last line of the
  // report is still the deterministic answer to the question the command was asked.
  lines.push(...findingsLines(report.findings));
  lines.push(...unverifiedLines(report.unverified));
  lines.push(...modelSectionLines(report.model, report.model.skipped));

  lines.push(
    "",
    report.identical
      ? "ok: identical failure profiles"
      : `compare: ${report.differences} difference${plural(report.differences)} in the failure profile`,
  );

  return `${lines.join("\n")}\n`;
}

/** Machine rendering of `compare`. Keys keep the literal order of the interface. */
export function renderCompareJson(report: CompareWithModel): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * The evidence cell of one case: the line and event id of each occurrence it carries,
 * in file order. The terminal answer to "what will be asserted" is this and the counts
 * beside it; the messages, the payload flags and the related event ids stay in the JSON
 * and in the written file, where a reader reconciling the case against `errors` needs
 * them and a terminal reader does not. `show` prints any one of them in full.
 */
function evidenceCell(entry: EvalCase): string {
  return entry.occurrences.map((occurrence) => `${occurrence.line}:${occurrence.event_id}`).join(", ") || NONE;
}

/**
 * Terminal rendering of the deterministic half of `eval-gen`: the header, then one row
 * per case. The header leads with the run status and the scenario, because a case file
 * that says nothing about how the run ended or what it was asked to do cannot be rerun
 * against anything.
 *
 * Kept apart from the with-model renderer below because these exact bytes are what
 * `--out` writes: a case file has to be the same bytes for the same trace whatever a
 * model said about it, so the deterministic rendering is the one the file gets.
 */
export function renderEvalGenText(report: EvalGenReport): string {
  return `${evalGenTextLines(report).join("\n")}\n`;
}

/** The deterministic lines, shared by the two eval-gen renderers so they cannot drift. */
function evalGenTextLines(report: EvalGenReport): string[] {
  const lines: string[] = labelRows([
    ["file", report.file],
    ["schema", report.schema],
    ["run_id", report.run_id ?? UNKNOWN],
    ["status", report.status],
    ["input", report.input_summary ?? NONE],
    ["events", String(report.events)],
    ["failures", String(report.failures)],
    ["errors", String(report.errors)],
    ["refusals", String(report.refusals)],
    ["cases", String(report.cases.length)],
  ])
    .trimEnd()
    .split("\n");

  lines.push("");
  if (report.cases.length === 0) {
    lines.push("(no cases)");
  } else {
    lines.push(
      ...renderTable([
        { header: "case", align: "left", cells: report.cases.map((entry) => entry.case_id) },
        { header: "error_type", align: "left", cells: report.cases.map((entry) => entry.error_type) },
        { header: "count", align: "right", cells: report.cases.map((entry) => String(entry.count)) },
        { header: "fatal", align: "right", cells: report.cases.map((entry) => String(entry.fatal)) },
        { header: "tools", align: "left", cells: report.cases.map((entry) => entry.tools.join(", ") || "-") },
        { header: "sources", align: "left", cells: report.cases.map((entry) => distributionCell(entry.sources)) },
        { header: "first", align: "right", cells: report.cases.map((entry) => numberCell(entry.first_line)) },
        { header: "last", align: "right", cells: report.cases.map((entry) => numberCell(entry.last_line)) },
        { header: "evidence", align: "left", cells: report.cases.map((entry) => evidenceCell(entry)) },
      ])
        .trimEnd()
        .split("\n"),
    );
  }

  lines.push(
    "",
    ...labelRows([
      ["skipped refusals", report.skipped_refusals.length === 0 ? NONE : report.skipped_refusals.join(", ")],
    ])
      .trimEnd()
      .split("\n"),
  );

  return lines;
}

/**
 * Terminal rendering of `eval-gen --model`: the deterministic report, then the model's
 * findings, then what neither establishes.
 *
 * The order is the one `explain` and `compare` use, so a reader who has seen either
 * knows which block is whose. The model half is appended rather than interleaved: the
 * cases are the answer to the question the command was asked, and they come first.
 */
export function renderEvalGenModelText(report: EvalGenWithModel): string {
  const lines: string[] = [
    ...evalGenTextLines(report),
    ...findingsLines(report.findings),
    ...unverifiedLines(report.unverified),
    ...modelSectionLines(report.model, report.model.skipped),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Machine rendering of the deterministic `eval-gen` report. These are the bytes `--out`
 * writes, so they carry no model half: a case file has to be reproducible from the trace
 * alone. Keys keep the literal order of the interface.
 */
export function renderEvalGenJson(report: EvalGenReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Machine rendering of `eval-gen --model`: the deterministic keys, then `findings`,
 * `unverified` and `model`, always in that order.
 */
export function renderEvalGenModelJson(report: EvalGenWithModel): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Terminal rendering of `fix-suggest`: the header, then one block per suggestion, then
 * what the report does not establish.
 *
 * The block shape is the one `findings` uses, so a reader who has seen a model finding
 * already knows which line is the direction and which is its limit. Padding comes from
 * the labels and never from the terminal, so the same input always produces the same
 * bytes. The evidence line carries line-and-id pairs only; the message each event
 * carried stays in the JSON, where a reader reconciling a suggestion against
 * `trace errors` needs it.
 */
export function renderFixSuggestText(report: FixSuggestReport): string {
  const lines: string[] = [...fixSuggestTextLines(report), ...unverifiedLines(report.unverified)];
  return `${lines.join("\n")}\n`;
}

/**
 * The deterministic lines, shared by the two fix-suggest renderers so they cannot drift.
 *
 * The header and the suggestion blocks are the answer to the question the command was
 * asked, so they are rendered by one function whichever half is being printed.
 */
function fixSuggestTextLines(report: FixSuggestReport): string[] {
  const lines: string[] = labelRows([
    ["file", report.file],
    ["schema", report.schema],
    ["run_id", report.run_id ?? UNKNOWN],
    ["status", report.status],
    ["input", report.input_summary ?? NONE],
    ["events", String(report.events)],
    ["failures", String(report.failures)],
    ["errors", String(report.errors)],
    ["refusals", String(report.refusals)],
    ["suggestions", String(report.suggestions.length)],
  ])
    .trimEnd()
    .split("\n");

  lines.push("");
  if (report.suggestions.length === 0) {
    lines.push("(no suggestions)");
  } else {
    report.suggestions.forEach((suggestion, index) => {
      // A blank line between blocks, never after the last one: the blocks below already
      // open with their own.
      if (index > 0) {
        lines.push("");
      }
      lines.push(...fixSuggestionLines(suggestion));
    });
  }
  return lines;
}

/**
 * Terminal rendering of `fix-suggest --model`: the deterministic report, then the model's
 * findings, then what neither establishes, then the model section.
 *
 * The order is the one `explain`, `compare` and `eval-gen` use, so a reader who has seen
 * any of them knows which block is whose. The model half is appended rather than
 * interleaved: the directions are the answer to the question the command was asked, and
 * they come first.
 */
export function renderFixSuggestModelText(report: FixSuggestWithModel): string {
  const lines: string[] = [
    ...fixSuggestTextLines(report),
    ...findingsLines(report.findings),
    ...unverifiedLines(report.unverified),
    ...modelSectionLines(report.model, report.model.skipped),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Machine rendering of `fix-suggest --model`: the deterministic keys, then `findings`,
 * `unverified` and `model`, always in that order.
 */
export function renderFixSuggestModelJson(report: FixSuggestWithModel): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** One suggestion as five lines: the heading, then what it says and what it rests on. */
function fixSuggestionLines(suggestion: FixSuggestion): string[] {
  const target = suggestion.error_type ?? suggestion.tool ?? "the run";
  const fatal = suggestion.fatal === 0 ? "" : ` (${suggestion.fatal} fatal)`;
  return [
    `  ${suggestion.suggestion_id}  ${suggestion.rule}  ${target} x${suggestion.count}${fatal}`,
    `      title  ${suggestion.title}`,
    `      action ${suggestion.action}`,
    `      basis  ${suggestion.basis}`,
    `      limit  ${suggestion.does_not_establish}`,
    `      evidence  ${suggestion.evidence.map((entry) => `${entry.line}:${entry.event_id}`).join(", ") || NONE}`,
  ];
}

/** Machine rendering of `fix-suggest`. Keys keep the literal order of the interface. */
export function renderFixSuggestJson(report: FixSuggestReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
