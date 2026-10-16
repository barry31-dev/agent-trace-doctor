import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runValidate } from "../src/cli.js";
import { loadValidator } from "../src/schema.js";
import type { ReportError, ValidationReport } from "../src/validate.js";
import { EXAMPLE_FILES, projectRoot } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "agent-trace-doctor-validate-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface TraceEvent {
  schema_version: string;
  event_id: string;
  timestamp: string;
  type: string;
  run_id: string;
  payload: Record<string, unknown>;
}

function event(index: number, type: string, payload: Record<string, unknown>, overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    schema_version: "1",
    event_id: `evt_00000${index}`,
    timestamp: `2026-10-14T10:00:0${index}.000Z`,
    type,
    run_id: "run_01",
    payload,
    ...overrides,
  };
}

function writeTrace(name: string, events: unknown[]): string {
  const path = join(scratch, name);
  writeFileSync(path, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  return path;
}

function validate(name: string, events: unknown[]): ValidationReport {
  const outcome = runValidate([writeTrace(name, events), "--json"]);
  return JSON.parse(outcome.stdout) as ValidationReport;
}

function onlyError(report: ValidationReport): ReportError {
  if (report.errors.length !== 1) {
    throw new Error(`expected exactly one error, got ${JSON.stringify(report.errors)}`);
  }
  return report.errors[0] as ReportError;
}

const STARTED = { input_summary: "do the thing" };

describe("validate: schema rules", () => {
  it("accepts the three bundled examples", () => {
    for (const relativePath of EXAMPLE_FILES) {
      const outcome = runValidate([join(projectRoot, relativePath), "--json"]);
      const report = JSON.parse(outcome.stdout) as ValidationReport;
      expect(report.valid).toBe(true);
      expect(report.errors).toEqual([]);
      expect(report.events).toBeGreaterThan(0);
      expect(report.schema).toBe("bundled");
      expect(outcome.exitCode).toBe(0);
    }
  });

  it("reports a missing required payload member with its pointer", () => {
    const report = validate("missing-member.jsonl", [
      event(1, "tool.call.started", { tool_call_id: "call_001" }),
    ]);
    const error = onlyError(report);
    expect(error.check).toBe("schema");
    expect(error.keyword).toBe("required");
    expect(error.path).toBe("/payload/tool");
    expect(error.line).toBe(1);
    expect(error.event_id).toBe("evt_000001");
    expect(report.valid).toBe(false);
  });

  it("reports a wrong payload type", () => {
    const report = validate("wrong-type.jsonl", [
      event(1, "model.request.started", { model: "stub-model-1", messages: "two" }),
    ]);
    const error = onlyError(report);
    expect(error.keyword).toBe("type");
    expect(error.path).toBe("/payload/messages");
  });

  it("reports a value outside an enum", () => {
    const report = validate("bad-enum.jsonl", [
      event(1, "permission.resolved", { decision: "maybe" }),
    ]);
    const error = onlyError(report);
    expect(error.keyword).toBe("enum");
    expect(error.path).toBe("/payload/decision");
  });

  it("reports an unknown top-level field", () => {
    const report = validate("unknown-top-level.jsonl", [
      { ...event(1, "run.started", STARTED), surprise: 1 },
    ]);
    const error = onlyError(report);
    expect(error.keyword).toBe("additionalProperties");
    expect(error.path).toBe("/surprise");
  });

  it("reports a malformed event id", () => {
    const report = validate("bad-event-id.jsonl", [
      event(1, "run.started", STARTED, { event_id: "evt_1" }),
    ]);
    const error = onlyError(report);
    expect(error.path).toBe("/event_id");
    expect(error.keyword).toBe("pattern");
  });

  it("reports a line that is not an event object at all", () => {
    const report = validate("not-an-object.jsonl", ["just a string"]);
    const error = onlyError(report);
    expect(error.check).toBe("schema");
    expect(error.keyword).toBe("type");
  });
});

describe("validate: cross-line invariants", () => {
  it("accepts a file whose events all belong to one run", () => {
    const report = validate("one-run.jsonl", [
      event(1, "run.started", STARTED),
      event(2, "run.finished", { status: "completed" }),
    ]);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.events).toBe(2);
  });

  it("rejects a repeated event id and names the first line", () => {
    const report = validate("duplicate-id.jsonl", [
      event(1, "run.started", STARTED),
      event(2, "run.finished", { status: "completed" }),
      event(3, "run.finished", { status: "completed" }, { event_id: "evt_000001" }),
    ]);
    const error = onlyError(report);
    expect(error.check).toBe("duplicate_event_id");
    expect(error.line).toBe(3);
    expect(error.message).toContain("line 1");
  });

  it("rejects a timestamp that goes backwards", () => {
    const report = validate("timestamp-back.jsonl", [
      event(1, "run.started", STARTED),
      event(2, "run.finished", { status: "completed" }, { timestamp: "2026-10-14T09:59:59.000Z" }),
    ]);
    const error = onlyError(report);
    expect(error.check).toBe("timestamp_order");
    expect(error.path).toBe("/timestamp");
    expect(error.message).toContain("line 1");
  });

  it("rejects a second run id and names the first one", () => {
    const report = validate("two-runs.jsonl", [
      event(1, "run.started", STARTED),
      event(2, "run.finished", { status: "completed" }, { run_id: "run_02" }),
    ]);
    const error = onlyError(report);
    expect(error.check).toBe("single_run_id");
    expect(error.line).toBe(2);
    expect(error.message).toContain("run_02");
    expect(error.message).toContain("run_01");
  });
});

describe("validate: report stability", () => {
  it("sorts errors by line", () => {
    const report = validate("sorted.jsonl", [
      event(1, "run.started", STARTED),
      event(2, "permission.resolved", { decision: "maybe" }),
      event(3, "tool.call.started", { tool_call_id: "call_003" }),
    ]);
    expect(report.errors.map((error) => error.line)).toEqual([2, 3]);
  });

  it("gives every error the same keys in the same order", () => {
    const report = validate("same-keys.jsonl", [
      event(1, "run.started", STARTED),
      event(2, "permission.resolved", { decision: "maybe" }),
      event(3, "run.finished", { status: "completed" }, { event_id: "evt_000001" }),
    ]);
    const shapes = report.errors.map((error) => Object.keys(error));
    for (const shape of shapes) {
      expect(shape).toEqual(["line", "event_id", "check", "path", "keyword", "message"]);
    }
  });

  it("produces identical bytes for identical input", () => {
    const events = [
      event(1, "run.started", STARTED),
      event(2, "permission.resolved", { decision: "maybe" }),
    ];
    const path = writeTrace("stable.jsonl", events);
    const first = runValidate([path, "--json"]);
    const second = runValidate([path, "--json"]);
    expect(first.stdout).toBe(second.stdout);
  });
});

describe("validate: schema selection", () => {
  it("honours a custom schema file", () => {
    const schemaPath = join(scratch, "custom.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      }),
      "utf8",
    );
    const outcome = runValidate([writeTrace("custom-schema-2.jsonl", [event(1, "run.started", STARTED)]), "--schema", schemaPath, "--json"]);
    const custom = JSON.parse(outcome.stdout) as ValidationReport;
    expect(custom.schema).toBe(schemaPath);
    expect(custom.valid).toBe(false);
    expect(onlyError(custom).path).toBe("/note");
  });

  it("refuses a schema in another dialect instead of mis-reading it", () => {
    const schemaPath = join(scratch, "draft7.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", type: "object" }),
      "utf8",
    );
    const outcome = runValidate([writeTrace("draft7.jsonl", [event(1, "run.started", STARTED)]), "--schema", schemaPath]);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain("dialect");
  });

  it("reports a schema file that cannot be read", () => {
    const outcome = runValidate([writeTrace("no-schema.jsonl", [event(1, "run.started", STARTED)]), "--schema", join(scratch, "missing.schema.json")]);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain("cannot read schema");
  });

  it("reports a schema that will not compile under strict mode", () => {
    const schemaPath = join(scratch, "sloppy.schema.json");
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["note"],
      }),
      "utf8",
    );
    const outcome = runValidate([writeTrace("sloppy.jsonl", [event(1, "run.started", STARTED)]), "--schema", schemaPath, "--json"]);
    expect(outcome.exitCode).toBe(2);
    const report = JSON.parse(outcome.stdout) as ValidationReport;
    expect(onlyError(report).message).toContain("cannot be compiled");
  });

  it("keeps the bundled schema loadable", () => {
    const result = loadValidator(null);
    expect(result.ok).toBe(true);
  });
});
