/**
 * Checks what the model sent back.
 *
 * The contract in `contract.ts` is enforced here with the same validator the trace
 * uses, and one rule is added on top of it: every finding must cite at least one
 * event id that exists in the trace. A finding that cites an id which is not in the
 * file is fabricated evidence, which is the one model failure that would otherwise
 * read as a perfectly ordinary report, so the whole answer is rejected rather than
 * the offending finding being quietly dropped.
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { ANSWER_CONTRACT } from "./contract.js";
import type { FindingConfidence, FindingSeverity, ModelFinding } from "./types.js";

export type AnswerResult =
  | { ok: true; findings: ModelFinding[]; unverified: string[] }
  | { ok: false; kind: "bad_shape" | "unknown_evidence"; message: string };

/** How many contract violations are listed before the message stops enumerating. */
const MAX_LISTED_PROBLEMS = 5;

function compileContract(): ValidateFunction {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(ANSWER_CONTRACT);
}

function describeProblem(error: ErrorObject): string {
  const where = error.instancePath.length === 0 ? "(root)" : error.instancePath;
  return `${where} ${error.message ?? "is not valid"}`;
}

function problemsOf(validate: ValidateFunction): string {
  const described = (validate.errors ?? []).map(describeProblem);
  const shown = described.slice(0, MAX_LISTED_PROBLEMS).join("; ");
  const hidden = described.length - Math.min(described.length, MAX_LISTED_PROBLEMS);
  return hidden > 0 ? `${shown}; and ${hidden} more` : shown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parses and checks one model answer.
 *
 * `knownEventIds` is every event id the caller accepts as evidence, so a finding may
 * cite an event that exists but was not quoted in the request. It is a set of whatever
 * the caller's evidence convention is: plain event ids for `explain`, side-qualified
 * `a:ID` / `b:ID` references for `compare`. `evidenceLabel` names that set in the
 * rejection message, because "not in this trace" is the wrong thing to say about a
 * trace the model was never shown.
 */
export function parseModelAnswer(
  content: string,
  knownEventIds: ReadonlySet<string>,
  evidenceLabel = "this trace",
): AnswerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "bad_shape", message: `the model answer is not JSON (${reason})` };
  }

  const validate = compileContract();
  if (validate(parsed) !== true) {
    return { ok: false, kind: "bad_shape", message: `the model answer does not match the required shape: ${problemsOf(validate)}` };
  }

  const record = asRecord(parsed);
  if (record === null) {
    return { ok: false, kind: "bad_shape", message: "the model answer is not a JSON object" };
  }

  const rawFindings = Array.isArray(record.findings) ? record.findings : [];
  const findings: ModelFinding[] = [];
  for (let index = 0; index < rawFindings.length; index += 1) {
    const finding = asRecord(rawFindings[index]);
    if (finding === null) {
      return { ok: false, kind: "bad_shape", message: `findings[${index}] is not an object` };
    }
    const evidence = Array.isArray(finding.evidence) ? finding.evidence.filter((id): id is string => typeof id === "string") : [];
    const unknown = evidence.filter((id) => !knownEventIds.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        kind: "unknown_evidence",
        message: `findings[${index}] cites evidence that is not in ${evidenceLabel}: ${unknown.join(", ")}`,
      };
    }
    findings.push({
      id: `find_${index + 1}`,
      severity: text(finding.severity) as FindingSeverity,
      evidence,
      claim: text(finding.claim),
      confidence: text(finding.confidence) as FindingConfidence,
      suggestion: text(finding.suggestion),
    });
  }

  const unverified = Array.isArray(record.unverified) ? record.unverified.map(text).filter((item) => item.length > 0) : [];
  return { ok: true, findings, unverified };
}
