import { describe, expect, it } from "vitest";
import {
  EXAMPLE_FILES,
  createValidator,
  declaredEventTypes,
  formatErrors,
  payloadOf,
  readEvents,
} from "./helpers.js";

const ALL_EVENT_TYPES = [
  "run.started",
  "run.finished",
  "run.failed",
  "run.cancelled",
  "model.request.started",
  "model.response.completed",
  "model.response.failed",
  "tool.call.started",
  "tool.call.completed",
  "tool.call.failed",
  "permission.requested",
  "permission.resolved",
  "context.compacted",
  "error.recorded",
];

describe("trace schema", () => {
  it("compiles under JSON Schema draft 2020-12 with strict mode", () => {
    const validator = createValidator();
    expect(typeof validator.validate).toBe("function");
  });

  it("declares exactly the fourteen documented event types", () => {
    expect(declaredEventTypes().sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });
});

describe("synthetic examples", () => {
  it.each(EXAMPLE_FILES)("%s validates against the schema on every line", (file: string) => {
    const validator = createValidator();
    const events = readEvents(file);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (!validator.validate(event)) {
        throw new Error(`${file}: ${JSON.stringify(event)}\n${formatErrors(validator.errors())}`);
      }
    }
  });

  it.each(EXAMPLE_FILES)("%s uses sequential unique event ids", (file: string) => {
    const events = readEvents(file);
    const ids = events.map((event, index) => {
      const expected = `evt_${String(index + 1).padStart(6, "0")}`;
      expect(event.event_id).toBe(expected);
      return event.event_id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(EXAMPLE_FILES)("%s has non-decreasing timestamps and one run_id", (file: string) => {
    const events = readEvents(file);
    const runIds = new Set(events.map((event) => event.run_id));
    expect(runIds.size).toBe(1);
    const stamps = events.map((event) => Date.parse(String(event.timestamp)));
    for (let index = 1; index < stamps.length; index += 1) {
      const previous = stamps[index - 1];
      const current = stamps[index];
      if (previous === undefined || current === undefined) {
        throw new Error("unparsable timestamp");
      }
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it("the three examples together cover all fourteen event types", () => {
    const seen = new Set<string>();
    for (const file of EXAMPLE_FILES) {
      for (const event of readEvents(file)) {
        seen.add(String(event.type));
      }
    }
    expect([...seen].sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it("success.jsonl ends with a completed run and no failure events", () => {
    const events = readEvents("examples/success.jsonl");
    const types = events.map((event) => String(event.type));
    expect(types).toContain("run.finished");
    expect(types).not.toContain("run.failed");
    expect(types).not.toContain("run.cancelled");
    expect(types).not.toContain("error.recorded");
    expect(types).not.toContain("tool.call.failed");
    expect(types).not.toContain("model.response.failed");
    expect(payloadOf(events[events.length - 1]!).status).toBe("completed");
  });

  it("failed.jsonl ends with a failed run carrying a structured error", () => {
    const events = readEvents("examples/failed.jsonl");
    const last = events[events.length - 1]!;
    expect(last.type).toBe("run.failed");
    const payload = payloadOf(last);
    expect(payload.status).toBe("failed");
    const error = payload.error as Record<string, unknown>;
    expect(typeof error.type).toBe("string");
    expect(typeof error.message).toBe("string");
  });

  it("failed.jsonl marks the guardrail refusal distinctly from real tool failures", () => {
    const events = readEvents("examples/failed.jsonl");
    const failed = events.filter((event) => event.type === "tool.call.failed");
    const refusals = failed.filter((event) => payloadOf(event).guardrail_refusal === true);
    const real = failed.filter((event) => payloadOf(event).guardrail_refusal !== true);
    expect(refusals.length).toBe(1);
    expect(real.length).toBe(2);
    for (const event of real) {
      expect(payloadOf(event).guard).toBeUndefined();
    }
    expect(payloadOf(refusals[0]!).guard).toBe("loop_block");
  });

  it("cancelled.jsonl records a denied permission and no error events", () => {
    const events = readEvents("examples/cancelled.jsonl");
    const types = events.map((event) => String(event.type));
    expect(types).toContain("permission.resolved");
    expect(types).toContain("run.cancelled");
    expect(types).not.toContain("error.recorded");
    expect(types).not.toContain("tool.call.failed");
    const resolved = events.find((event) => event.type === "permission.resolved")!;
    expect(payloadOf(resolved).decision).toBe("denied");
    const cancelled = events.find((event) => event.type === "run.cancelled")!;
    expect(payloadOf(cancelled).status).toBe("cancelled");
  });
});
