import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

// Test-only scaffolding. The product loader/validator ships in a later slice;
// these helpers exist so the schema and the examples can be proven consistent now.

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const EXAMPLE_FILES: string[] = [
  "examples/success.jsonl",
  "examples/failed.jsonl",
  "examples/cancelled.jsonl",
];

export type TraceEvent = Record<string, unknown>;

export function readText(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

export function readEvents(relativePath: string): TraceEvent[] {
  return readText(relativePath)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceEvent);
}

export function loadSchema(): Record<string, unknown> {
  return JSON.parse(readText("schemas/trace.schema.json")) as Record<string, unknown>;
}

export function declaredEventTypes(): string[] {
  const schema = loadSchema();
  const properties = schema.properties as Record<string, unknown>;
  const type = properties.type as Record<string, unknown>;
  return (type.enum as unknown[]).map((value) => String(value));
}

export interface Validator {
  validate(event: unknown): boolean;
  errors(): unknown[];
}

export function createValidator(): Validator {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema());
  return {
    validate: (event: unknown) => validate(event) === true,
    errors: () => (validate.errors ?? []) as unknown[],
  };
}

export function formatErrors(errors: unknown[]): string {
  return JSON.stringify(errors, null, 2);
}

export function payloadOf(event: TraceEvent): Record<string, unknown> {
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) {
    throw new Error("event has no payload object");
  }
  return payload as Record<string, unknown>;
}
