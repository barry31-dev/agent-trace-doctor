import { describe, expect, it } from "vitest";
import { createValidator, formatErrors, type TraceEvent } from "./helpers.js";

// Every case starts from one known-valid event and mutates a single thing.
// The point of this file is to prove the schema is load-bearing: a contract
// that accepts everything would let the examples above pass vacuously.

function validEvent(): TraceEvent {
  return {
    schema_version: "1",
    event_id: "evt_000001",
    timestamp: "2026-10-14T10:00:00.000Z",
    type: "tool.call.completed",
    run_id: "run_neg",
    payload: {
      tool: "read_file",
      status: "completed",
      duration_ms: 10,
    },
  };
}

function expectRejected(event: TraceEvent, label: string): void {
  const validator = createValidator();
  // The unmutated base must pass, otherwise the case proves nothing.
  expect(validator.validate(validEvent()), `${label}: base event should be valid`).toBe(true);
  if (validator.validate(event)) {
    throw new Error(`${label}: schema accepted an invalid event\n${JSON.stringify(event)}`);
  }
  expect(validator.errors().length).toBeGreaterThan(0);
}

function mutateTop(mutate: (event: TraceEvent) => void, label: string): void {
  const event = validEvent();
  mutate(event);
  expectRejected(event, label);
}

function mutatePayload(mutate: (payload: Record<string, unknown>) => void, label: string): void {
  const event = validEvent();
  mutate(event.payload as Record<string, unknown>);
  expectRejected(event, label);
}

function typedEvent(type: string, payload: Record<string, unknown>): TraceEvent {
  return { ...validEvent(), type, payload };
}

describe("schema rejects malformed base fields", () => {
  it("missing schema_version", () => mutateTop((e) => { delete e.schema_version; }, "missing schema_version"));
  it("missing event_id", () => mutateTop((e) => { delete e.event_id; }, "missing event_id"));
  it("missing timestamp", () => mutateTop((e) => { delete e.timestamp; }, "missing timestamp"));
  it("missing type", () => mutateTop((e) => { delete e.type; }, "missing type"));
  it("missing run_id", () => mutateTop((e) => { delete e.run_id; }, "missing run_id"));
  it("unsupported schema_version", () => mutateTop((e) => { e.schema_version = "2"; }, "schema_version 2"));
  it("numeric schema_version", () => mutateTop((e) => { e.schema_version = 1; }, "numeric schema_version"));
  it("numeric event_id", () => mutateTop((e) => { e.event_id = 42; }, "numeric event_id"));
  it("malformed event_id", () => mutateTop((e) => { e.event_id = "evt_1"; }, "short event_id"));
  it("event_id with wrong prefix", () => mutateTop((e) => { e.event_id = "event_000001"; }, "wrong event_id prefix"));
  it("unparsable timestamp", () => mutateTop((e) => { e.timestamp = "not-a-time"; }, "bad timestamp"));
  it("unknown event type", () => mutateTop((e) => { e.type = "tool.call.exploded"; }, "unknown type"));
  it("empty run_id", () => mutateTop((e) => { e.run_id = ""; }, "empty run_id"));
  it("unknown top-level field", () => mutateTop((e) => { e.eventid = "evt_000001"; }, "unknown top-level field"));
  it("payload that is not an object", () => mutateTop((e) => { e.payload = "completed"; }, "string payload"));
});

describe("schema rejects malformed payloads", () => {
  it("run.started without payload", () => {
    const event = validEvent();
    event.type = "run.started";
    delete event.payload;
    expectRejected(event, "run.started missing payload");
  });
  it("run.started without input_summary", () =>
    expectRejected(typedEvent("run.started", {}), "run.started missing input_summary"));
  it("run.finished with wrong status const", () =>
    expectRejected(typedEvent("run.finished", { status: "failed" }), "run.finished status failed"));
  it("run.failed without error", () =>
    expectRejected(typedEvent("run.failed", { status: "failed" }), "run.failed missing error"));
  it("run.cancelled with wrong status const", () =>
    expectRejected(typedEvent("run.cancelled", { status: "completed" }), "run.cancelled status completed"));
  it("permission.resolved with unknown decision", () =>
    expectRejected(typedEvent("permission.resolved", { decision: "maybe" }), "decision maybe"));
  it("tool.call.completed without duration_ms", () =>
    mutatePayload((p) => { delete p.duration_ms; }, "tool.call.completed missing duration_ms"));
  it("tool.call.completed with string duration_ms", () =>
    mutatePayload((p) => { p.duration_ms = "10"; }, "string duration_ms"));
  it("tool.call.completed with wrong status const", () =>
    mutatePayload((p) => { p.status = "failed"; }, "completed event with status failed"));
  it("tool.call.failed without error", () =>
    expectRejected(
      typedEvent("tool.call.failed", { tool: "read_file", status: "failed", duration_ms: 5 }),
      "tool.call.failed missing error",
    ));
  it("tool.call.failed with unknown guard", () =>
    expectRejected(
      typedEvent("tool.call.failed", {
        tool: "read_file",
        status: "failed",
        duration_ms: 5,
        error: { type: "x", message: "y" },
        guard: "vibes",
      }),
      "unknown guard",
    ));
  it("model.response.completed with negative tokens", () =>
    expectRejected(
      typedEvent("model.response.completed", {
        model: "m",
        duration_ms: 1,
        usage: { input_tokens: -5, output_tokens: 0 },
      }),
      "negative input_tokens",
    ));
  it("model.response.completed with string token counts", () =>
    expectRejected(
      typedEvent("model.response.completed", {
        model: "m",
        duration_ms: 1,
        usage: { input_tokens: "many", output_tokens: 0 },
      }),
      "string input_tokens",
    ));
  it("model.response.completed without usage", () =>
    expectRejected(typedEvent("model.response.completed", { model: "m", duration_ms: 1 }), "missing usage"));
  it("error object missing message", () =>
    expectRejected(
      typedEvent("error.recorded", { error: { type: "tool_error" } }),
      "error missing message",
    ));
  it("context.compacted without strategy", () =>
    expectRejected(typedEvent("context.compacted", { before_tokens: 10 }), "context.compacted missing strategy"));
});

describe("schema allows forward extension inside payload", () => {
  it("unknown payload fields are accepted", () => {
    const validator = createValidator();
    const event = typedEvent("tool.call.completed", {
      tool: "read_file",
      status: "completed",
      duration_ms: 10,
      recorder_specific_field: { anything: true },
    });
    if (!validator.validate(event)) {
      throw new Error(`payload extension rejected: ${formatErrors(validator.errors())}`);
    }
    expect(validator.validate(event)).toBe(true);
  });
});

// The fields the mini agent spike added. Each one is optional, so the rejection
// cases are about type and enum, not about presence.
describe("schema checks the spike fields", () => {
  it("effect_disposition must be one of the three classes", () => {
    for (const effect of ["none", "applied", "unknown"]) {
      const validator = createValidator();
      const event = typedEvent("tool.call.completed", {
        tool: "read_file",
        status: "completed",
        duration_ms: 10,
        effect_disposition: effect,
      });
      if (!validator.validate(event)) {
        throw new Error(`effect_disposition ${effect} rejected: ${formatErrors(validator.errors())}`);
      }
    }
    expectRejected(
      typedEvent("tool.call.completed", {
        tool: "read_file",
        status: "completed",
        duration_ms: 10,
        effect_disposition: "maybe",
      }),
      "effect_disposition outside the enum",
    );
  });

  it("capture must be one of the three locations", () => {
    for (const capture of ["inline", "inline_from_stream", "db_ref"]) {
      const validator = createValidator();
      const event = typedEvent("model.response.completed", {
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
        duration_ms: 1,
        capture,
      });
      if (!validator.validate(event)) {
        throw new Error(`capture ${capture} rejected: ${formatErrors(validator.errors())}`);
      }
    }
    expectRejected(
      typedEvent("model.response.completed", {
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
        duration_ms: 1,
        capture: "somewhere",
      }),
      "capture outside the enum",
    );
  });

  it("model role must be a known slot", () => {
    for (const role of ["main", "reference", "aggregator"]) {
      const validator = createValidator();
      const event = typedEvent("model.request.started", { model: "m", role });
      if (!validator.validate(event)) {
        throw new Error(`role ${role} rejected: ${formatErrors(validator.errors())}`);
      }
    }
    expectRejected(typedEvent("model.request.started", { model: "m", role: "boss" }), "role outside the enum");
  });

  it("the new booleans and strings keep their types", () => {
    expectRejected(
      typedEvent("model.response.completed", {
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
        duration_ms: 1,
        streamed: "yes",
      }),
      "streamed as a string",
    );
    expectRejected(
      typedEvent("model.response.completed", {
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
        duration_ms: 1,
        output_summary: 42,
      }),
      "output_summary as a number",
    );
    expectRejected(typedEvent("model.request.started", { model: "m", slot_label: 7 }), "slot_label as a number");
  });

  it("guard accepts path_escape and refuses anything else new", () => {
    const validator = createValidator();
    const event = typedEvent("tool.call.failed", {
      tool: "read_file",
      status: "failed",
      error: { type: "argument_contract", message: "escaped" },
      duration_ms: 1,
      guard: "path_escape",
    });
    if (!validator.validate(event)) {
      throw new Error(`guard path_escape rejected: ${formatErrors(validator.errors())}`);
    }
    expectRejected(
      typedEvent("tool.call.failed", {
        tool: "read_file",
        status: "failed",
        error: { type: "argument_contract", message: "escaped" },
        duration_ms: 1,
        guard: "sandbox",
      }),
      "guard outside the enum",
    );
  });

  it("the run-start tool summary keeps its shape", () => {
    const validator = createValidator();
    const event = typedEvent("run.started", {
      input_summary: "do a thing",
      config_summary: {
        model: "m",
        max_steps: 5,
        tools: [{ name: "read_file", schema_hash: "abc123", available: true }],
      },
    });
    if (!validator.validate(event)) {
      throw new Error(`tool summary rejected: ${formatErrors(validator.errors())}`);
    }

    expectRejected(
      typedEvent("run.started", {
        input_summary: "do a thing",
        config_summary: { tools: [{ schema_hash: "abc", available: true }] },
      }),
      "tool summary without a name",
    );
    expectRejected(
      typedEvent("run.started", {
        input_summary: "do a thing",
        config_summary: { tools: [{ name: "read_file", available: "yes" }] },
      }),
      "tool summary with a non-boolean available",
    );
    // config_summary stays open: a recorder that writes other keys is not rejected.
    const open = typedEvent("run.started", {
      input_summary: "do a thing",
      config_summary: { model: "m", something_else: { nested: true } },
    });
    expect(createValidator().validate(open)).toBe(true);
  });
});
