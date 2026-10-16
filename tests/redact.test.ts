import { describe, expect, it } from "vitest";
import { REDACTED_PLACEHOLDER, isSecretKey, redactPayload } from "../src/model/redact.js";
import { readEvents } from "./helpers.js";

/**
 * The request boundary for credential-looking values.
 *
 * These tests pin two different things. The first is the rule itself: which keys are
 * withheld, which are not, and what happens to the values that survive. The second is
 * the limit of that rule, because a name-based rule has one: a credential under a key
 * whose name says nothing is sent, and a test that does not say so would let a reader
 * believe otherwise.
 */
describe("payload redaction", () => {
  it("withholds a value whose key names a credential", () => {
    const result = redactPayload({ api_key: "sk-live-123", tool: "read_file" });
    expect(result.payload).toEqual({ api_key: REDACTED_PLACEHOLDER, tool: "read_file" });
    expect(result.redacted).toBe(1);
  });

  it("keeps the keys and replaces only the values, so the shape survives", () => {
    const result = redactPayload({ authorization: "Bearer abc", retries: 2, note: null });
    expect(Object.keys(result.payload)).toEqual(["authorization", "retries", "note"]);
    expect(result.payload).toEqual({ authorization: REDACTED_PLACEHOLDER, retries: 2, note: null });
  });

  it("withholds a non-string credential value rather than guessing it is harmless", () => {
    const result = redactPayload({ api_key: 42, password: { nested: "x" } });
    expect(result.payload).toEqual({ api_key: REDACTED_PLACEHOLDER, password: REDACTED_PLACEHOLDER });
    expect(result.redacted).toBe(2);
  });

  it("matches a prefixed name, so openai_api_key is caught and input_tokens is not", () => {
    expect(isSecretKey("openai_api_key")).toBe(true);
    expect(isSecretKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretKey("session_token")).toBe(true);
    expect(isSecretKey("input_tokens")).toBe(false);
    expect(isSecretKey("cache_read_tokens")).toBe(false);
    expect(isSecretKey("before_tokens")).toBe(false);
    expect(isSecretKey("tokens")).toBe(false);
    expect(isSecretKey("max_tokens")).toBe(false);
  });

  it("folds spacing and dashes, so API Key, api-key and api_key are one name", () => {
    expect(isSecretKey("API Key")).toBe(true);
    expect(isSecretKey("api-key")).toBe(true);
    expect(isSecretKey("  Authorization  ")).toBe(true);
    expect(isSecretKey("private key")).toBe(true);
  });

  it("walks nested objects and arrays, and counts each value it replaces", () => {
    const result = redactPayload({
      request: {
        headers: { authorization: "Bearer x", accept: "application/json" },
        targets: [{ token: "t1" }, { token: "t2" }, { path: "/tmp/a" }],
      },
      run_id: "run_01",
    });
    expect(result.redacted).toBe(3);
    expect(result.payload).toEqual({
      request: {
        headers: { authorization: REDACTED_PLACEHOLDER, accept: "application/json" },
        targets: [
          { token: REDACTED_PLACEHOLDER },
          { token: REDACTED_PLACEHOLDER },
          { path: "/tmp/a" },
        ],
      },
      run_id: "run_01",
    });
  });

  it("withholds a whole container held under a credential name, array included", () => {
    const result = redactPayload({ credentials: ["a", "b"], cookie: "sid=1" });
    expect(result.payload).toEqual({ credentials: REDACTED_PLACEHOLDER, cookie: REDACTED_PLACEHOLDER });
    expect(result.redacted).toBe(2);
  });

  it("sends a value that only looks like a credential under a name that does not say so", () => {
    // The documented limit of the rule: names, not value shapes. A test that asserted
    // otherwise would be claiming a boundary nobody implemented.
    const result = redactPayload({ message: "failed with key sk-live-abcdef", detail: "Bearer deadbeef" });
    expect(result.redacted).toBe(0);
    expect(result.payload).toEqual({ message: "failed with key sk-live-abcdef", detail: "Bearer deadbeef" });
  });

  it("leaves an empty payload empty and counts nothing", () => {
    const result = redactPayload({});
    expect(result.payload).toEqual({});
    expect(result.redacted).toBe(0);
  });

  it("is deterministic, so the same payload always produces the same bytes", () => {
    const payload = { api_key: "sk-1", nested: { refresh_token: "rt", keep: "yes" } };
    const first = JSON.stringify(redactPayload(payload));
    const second = JSON.stringify(redactPayload(payload));
    expect(first).toBe(second);
    expect(redactPayload(payload).redacted).toBe(2);
  });

  it("withholds a subtree nested past the walk depth instead of overflowing the stack", () => {
    // JSON.parse accepts this; a recursive walk without the cap does not. Measured on
    // this repository's Node: 100,000 levels parse, and walking them overflows.
    const deep = JSON.parse(`[${"[".repeat(50000)}]${"]".repeat(50000)}`) as unknown;
    const result = redactPayload({ deep });
    expect(result.redacted).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.payload).length).toBeLessThan(200);
  });

  it("withholds nothing from any bundled example, so the rule does not touch known fields", () => {
    for (const relativePath of ["examples/success.jsonl", "examples/failed.jsonl", "examples/cancelled.jsonl", "examples/spike-run.jsonl"]) {
      for (const event of readEvents(relativePath)) {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        expect(redactPayload(payload).redacted).toBe(0);
      }
    }
  });
});
