import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";
import type { ValidateFunction } from "ajv";

/** Dialect the bundled schema is written in. A custom schema in another dialect is refused. */
const SUPPORTED_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** Label used in reports when no --schema file is given. */
export const BUNDLED_SCHEMA_LABEL = "bundled";

/** Where the bundled schema lives, relative to the project root. */
const BUNDLED_SCHEMA_RELATIVE = join("schemas", "trace.schema.json");

/**
 * Finds the bundled schema by walking up from this module.
 *
 * A fixed relative URL would work for exactly one build layout: the sources sit one
 * level below the project root, and the compiled output can sit one or two levels
 * below it depending on how `rootDir` is set. Walking up means the same code finds
 * the schema when run from `src/` through a loader, from `dist/`, or from
 * `dist/src/`, and it fails with a clear message instead of a confusing ENOENT when
 * the project has been pruned down to the compiled files.
 */
function bundledSchemaPath(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(directory, BUNDLED_SCHEMA_RELATIVE);
    try {
      readFileSync(candidate);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`bundled schema ${BUNDLED_SCHEMA_RELATIVE} not found above ${dirname(fileURLToPath(import.meta.url))}`);
    }
    directory = parent;
  }
}

export type SchemaResult =
  | { ok: true; label: string; validate: ValidateFunction }
  | { ok: false; message: string };

function pointerSegment(segment: string): string {
  return `/${segment.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

/**
 * ajv reports `required` and `additionalProperties` against the object that owns the
 * problem, with the offending member only in `params`. Joining it in turns
 * `/payload` + `tool` into `/payload/tool`, the pointer a user can act on.
 *
 * Lives here because two validators need it: the trace validator and the model answer
 * validator. A second copy would be a second thing to keep in sync.
 */
export function ajvErrorPath(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  const member = params.missingProperty ?? params.additionalProperty;
  if (typeof member === "string" && member.length > 0) {
    return `${error.instancePath}${pointerSegment(member)}`;
  }
  return error.instancePath;
}

function compile(text: string, label: string): SchemaResult {
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `schema ${label} is not valid JSON (${reason})` };
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { ok: false, message: `schema ${label} is not a JSON object` };
  }
  const dialect = (schema as { $schema?: unknown }).$schema;
  if (dialect !== undefined && dialect !== SUPPORTED_DIALECT) {
    return {
      ok: false,
      message: `schema ${label} declares dialect ${String(dialect)}; only ${SUPPORTED_DIALECT} is supported`,
    };
  }
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  try {
    const validate = ajv.compile(schema as object);
    return { ok: true, label, validate };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `schema ${label} cannot be compiled (${reason})` };
  }
}

/**
 * Compiles the validator used by `validate`. With no argument the bundled schema ships
 * with the tool; with a path the caller's schema is used, which is how CI pins a
 * specific trace contract.
 */
export function loadValidator(schemaPath: string | null): SchemaResult {
  if (schemaPath === null) {
    let text: string;
    try {
      text = readFileSync(bundledSchemaPath(), "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `bundled schema could not be read (${reason})` };
    }
    return compile(text, BUNDLED_SCHEMA_LABEL);
  }
  let text: string;
  try {
    text = readFileSync(schemaPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const detail = typeof code === "string" ? code : String(error);
    return { ok: false, message: `cannot read schema ${schemaPath} (${detail})` };
  }
  return compile(text, schemaPath);
}
