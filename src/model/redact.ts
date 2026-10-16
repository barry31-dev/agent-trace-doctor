/**
 * Withholding credential-looking values from a model request.
 *
 * A trace payload is data a run recorded, and the schema deliberately allows fields the
 * tool does not know about so a recorder can extend without a schema bump. One of those
 * unknown fields can be a credential: a tool that logged its own configuration, a
 * request that echoed an authorization header. The design draft's request boundary says
 * the API key is not sent; this module is what makes that true of the trace as well,
 * because a payload is otherwise quoted verbatim into the request.
 *
 * The rule is names, not value shapes. A value is withheld when the key holding it says
 * it is a credential, and nothing is inferred from what the value looks like: a string
 * that resembles a key under an unrelated name is still sent. That keeps the rule
 * deterministic and reviewable, and it keeps the boundary exactly as wide as the list
 * below -- no wider, which is the part that would be a claim about safety nobody
 * measured.
 *
 * This is the request boundary and only the request boundary. The local report is
 * unchanged: the engineer who owns the file is the one person entitled to read it, and
 * `show` still prints the value in full. Hiding it locally would take away the only
 * place it can be inspected.
 */

/** Stands in for a withheld value, so the shape of the payload survives. */
export const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * How deep a payload is walked.
 *
 * `JSON.parse` accepts nesting far deeper than a recursive walk survives -- measured on
 * this repository's Node: a 100,000-deep array parses, and walking one overflows the
 * stack at 20,000. A trace that parsed would then take the CLI down on a path that used
 * to work. Past this depth the subtree is withheld instead of walked, which costs a
 * value nobody would have read and keeps the failure impossible.
 */
const MAX_WALK_DEPTH = 32;

/**
 * Key names whose value is withheld.
 *
 * Matched on the normalized key, exactly or as a `_`-prefixed suffix, so
 * `openai_api_key` is caught and `input_tokens` is not. The singular `token` is on the
 * list because a payload field named `token` is a credential; every token *count* the
 * schema knows about is plural or prefixed (`input_tokens`, `cache_read_tokens`,
 * `before_tokens`), so none of them is caught.
 */
const SECRET_NAMES: readonly string[] = [
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "auth_token",
  "session_token",
  "id_token",
  "token",
  "authorization",
  "auth",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "client_secret",
  "credential",
  "credentials",
  "private_key",
  "privatekey",
  "bearer",
  "cookie",
  "set_cookie",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Folds spacing and dashes to `_` so `API Key`, `api-key` and `api_key` are one name. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Whether this key's value is withheld. */
export function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SECRET_NAMES.some((name) => normalized === name || normalized.endsWith(`_${name}`));
}

/** What one pass over a payload produced. */
export interface RedactResult {
  /** The payload with withheld values replaced. Always an object, as the input was. */
  payload: Record<string, unknown>;
  /** How many values were replaced. Zero means nothing looked like a credential. */
  redacted: number;
}

/** Replaces every credential-looking value in `payload`, counting what it replaced. */
export function redactPayload(payload: Record<string, unknown>): RedactResult {
  const state = { redacted: 0 };
  return { payload: redactRecord(payload, 0, state), redacted: state.redacted };
}

function withhold(state: { redacted: number }): string {
  state.redacted += 1;
  return REDACTED_PLACEHOLDER;
}

function redactRecord(record: Record<string, unknown>, depth: number, state: { redacted: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSecretKey(key) ? withhold(state) : redactValue(value, depth, state);
  }
  return out;
}

function redactArray(items: unknown[], depth: number, state: { redacted: number }): unknown[] {
  return items.map((item) => redactValue(item, depth, state));
}

/**
 * Walks one value. Array indices carry no key, so a secret inside an array is only
 * caught by the key that holds the array -- an array of credentials under a name that
 * does not say so is sent, which is the documented limit of a name-based rule.
 */
function redactValue(value: unknown, depth: number, state: { redacted: number }): unknown {
  if (depth >= MAX_WALK_DEPTH) {
    return withhold(state);
  }
  if (Array.isArray(value)) {
    return redactArray(value, depth + 1, state);
  }
  const record = asRecord(value);
  return record === null ? value : redactRecord(record, depth + 1, state);
}
