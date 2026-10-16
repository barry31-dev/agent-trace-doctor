/**
 * Types of the model layer.
 *
 * The layer is optional and off by default: nothing in `src/` reaches the network
 * unless the caller asks for it. These types describe what leaves the machine and
 * what may come back, and nothing else in the product imports them, so the boundary
 * stays in one place.
 */

/** Severity a finding may carry. The model may not invent another one. */
export type FindingSeverity = "info" | "warning" | "error";

/** How sure the model says it is. Recorded verbatim, never promoted to a fact. */
export type FindingConfidence = "low" | "medium" | "high";

/** One conclusion the model drew, tied to events of the trace it was shown. */
export interface ModelFinding {
  /** Assigned here, not by the model, so the numbering is stable. */
  id: string;
  severity: FindingSeverity;
  /** Event ids from this trace that carry the evidence. Never empty. */
  evidence: string[];
  claim: string;
  confidence: FindingConfidence;
  suggestion: string;
}

/** Transport facts shared by both outcomes of one attempt. */
export interface ModelAttempt {
  provider: string;
  model: string;
  /** Requests actually made. Zero when the call never left the machine. */
  requests: number;
  /** Events quoted in the request. Zero when no request was made. */
  sent_events: number;
  /** Bytes of request body that left the machine. Zero when none was sent. */
  request_bytes: number;
  /**
   * Credential-looking payload values withheld from the quoted events. Zero when
   * nothing looked like a credential, and zero again when no request was made, so the
   * number describes what left the machine rather than what the trace holds.
   */
  redacted_fields: number;
}

export interface ModelSuccess extends ModelAttempt {
  ok: true;
  findings: ModelFinding[];
  /** Gaps the model itself declared. Kept apart from the deterministic ones. */
  unverified: string[];
}

/** Why a model call did not produce a usable answer. */
export type ModelFailureKind =
  | "no_api_key"
  | "network_error"
  | "timeout"
  | "http_error"
  | "empty_answer"
  | "bad_shape"
  | "unknown_evidence";

export interface ModelFailure extends ModelAttempt {
  ok: false;
  kind: ModelFailureKind;
  message: string;
}

export type ModelResult = ModelSuccess | ModelFailure;

/**
 * One evidence-bound observation, in the shape sent to the model. `kind` is a string
 * here rather than the union `explain.ts` uses: the wire shape does not need to know
 * which kinds exist, and a new kind must not become a model-layer change.
 */
export interface ModelObservation {
  id: string;
  kind: string;
  event_id: string | null;
  line: number | null;
  statement: string;
}

/** One quoted event, in the shape sent to the model. */
export interface ModelEventExcerpt {
  event_id: string | null;
  line: number;
  type: string;
  payload: Record<string, unknown>;
}

/** Which of the two compared traces something came from. */
export type CompareSide = "a" | "b";

/**
 * One quoted event of a compare request.
 *
 * `side` is required rather than optional: both traces may carry the same event id,
 * and a quoted event that does not say which file it came from cannot be cited
 * unambiguously.
 */
export interface CompareEventExcerpt {
  side: CompareSide;
  event_id: string | null;
  line: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * One observation about a pair of traces, anchored to the file it was read from.
 *
 * `side` is `null` only for a fact about the pair that no single file carries. The
 * status change is deliberately not one of those: it is reported as one observation
 * per side, each anchored to that side's terminal event, so both are citable.
 */
export interface CompareObservation extends ModelObservation {
  side: CompareSide | null;
}

/** Everything one compare request carries, and nothing more. */
export interface CompareRequest {
  task: string;
  output_contract: Record<string, unknown>;
  observations: CompareObservation[];
  events: CompareEventExcerpt[];
  /** The two trace files' own paths, present only when the caller opted in. */
  file_a: string | null;
  file_b: string | null;
  /**
   * Credential-looking values the quoted events had withheld. Recorded in the attempt
   * so the report can say what did not leave the machine; deliberately absent from the
   * wire payload, which lists its fields explicitly, because a count about the request
   * is not part of the request.
   */
  redacted_fields: number;
}

/** Everything one explain request carries, and nothing more. */
export interface ExplainRequest {
  task: string;
  output_contract: Record<string, unknown>;
  observations: ModelObservation[];
  events: ModelEventExcerpt[];
  /** The trace file's own path, present only when the caller opted in. */
  file: string | null;
  /**
   * Credential-looking values the quoted events had withheld. See `CompareRequest`.
   */
  redacted_fields: number;
}

/**
 * Everything one eval-gen request carries, and nothing more.
 *
 * The same observation-plus-events shape `explain` uses, because the cases were
 * derived from the same trace and cite the same kind of evidence: plain event ids.
 * There is no side to qualify here, which is why this request does not grow one.
 */
export interface EvalGenRequest {
  task: string;
  output_contract: Record<string, unknown>;
  observations: ModelObservation[];
  events: ModelEventExcerpt[];
  /** The trace file's own path, present only when the caller opted in. */
  file: string | null;
  /**
   * Credential-looking values the quoted events had withheld. See `CompareRequest`.
   */
  redacted_fields: number;
}

/**
 * Everything one fix-suggest request carries, and nothing more.
 *
 * The same observation-plus-events shape again, because the suggestions were derived
 * from the same trace and cite the same kind of evidence: plain event ids. There is no
 * side to qualify here either.
 */
export interface FixSuggestRequest {
  task: string;
  output_contract: Record<string, unknown>;
  observations: ModelObservation[];
  events: ModelEventExcerpt[];
  /** The trace file's own path, present only when the caller opted in. */
  file: string | null;
  /**
   * Credential-looking values the quoted events had withheld. See `CompareRequest`.
   */
  redacted_fields: number;
}

/**
 * One model backend.
 *
 * `knownEventIds` is every event id in the trace, not just the quoted ones: a finding
 * that cites an event which exists but was not quoted is still valid evidence, and
 * one that cites an event which does not exist is fabricated.
 */
export interface ModelClient {
  readonly provider: string;
  complete(request: ExplainRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult>;
  completeCompare(request: CompareRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult>;
  completeEvalGen(request: EvalGenRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult>;
  completeFixSuggest(request: FixSuggestRequest, knownEventIds: ReadonlySet<string>): Promise<ModelResult>;
}
