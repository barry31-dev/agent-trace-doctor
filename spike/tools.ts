/**
 * The tool set of the mini agent spike.
 *
 * Three properties are worth reading before changing anything here.
 *
 * First, every tool is confined to one work directory. A path that resolves outside
 * it is refused as `path_escape` before any system call happens, which is the same
 * "reject at the boundary" shape the schema's `guard` enum describes.
 *
 * Second, each tool declares its own effect disposition once, on the definition.
 * The agent loop copies that declaration onto the completed event and nowhere else,
 * so there is exactly one place to audit when the question is "did this call change
 * anything".
 *
 * Third, tool schemas are hashed, never inlined. The hash is over the canonical JSON
 * of the `parameters` object, so a recorder can notice that a tool's contract moved
 * without carrying the contract itself in every trace.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { EffectDisposition } from "./recorder.js";

/**
 * The `guard` values a tool can report. This mirrors the schema enum exactly: a
 * value here that the schema does not know would produce a trace the validator
 * rejects, which is the failure mode worth keeping impossible.
 */
export type GuardClass =
  | "nt_namespace"
  | "device_path"
  | "special_file"
  | "denylist"
  | "binary_ext"
  | "dedup_stub"
  | "loop_block"
  | "path_escape";

/** Arguments a tool received, as the model produced them. */
export type ToolArgs = Record<string, unknown>;

export interface ToolEnvironment {
  /** Absolute path every tool is confined to. */
  workdir: string;
}

/** A tool that refused to run, or ran and failed. */
export interface ToolFailure {
  ok: false;
  /** Stable error class, recorded as `error.type`. */
  error: string;
  message: string;
  /** Set when the refusal happened before the tool did its work. */
  guard?: GuardClass;
}

export interface ToolSuccess {
  ok: true;
  /** Short text handed back to the model. Kept small on purpose. */
  summary: string;
  /** Size of the full result body in bytes, before any summarising. */
  resultBytes: number;
  /** True when `summary` is shorter than the full body. */
  truncated: boolean;
}

export type ToolOutcome = ToolSuccess | ToolFailure;

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Hashed, not inlined into the trace. */
  parameters: ToolArgs;
  /**
   * Whether a completed call leaves a side effect. `none` for read-only tools,
   * `applied` for tools whose successful completion means the change is in place,
   * `unknown` when the tool cannot tell (a partial write, an unclear commit).
   */
  effect: EffectDisposition;
  /**
   * Whether this tool was offered to the model for the run. A tool can exist and be
   * withheld: recording that is the only way a trace can explain why a tool was
   * never called.
   */
  available: boolean;
  /** Upper bound on the result body. Results above it are truncated explicitly. */
  maxResultBytes: number;
  run(args: ToolArgs, env: ToolEnvironment): ToolOutcome;
}

/**
 * Failure thrown inside a tool when its arguments do not fit its contract. `guard`
 * is set when the refusal was a boundary refusal rather than a plain bad argument,
 * so the trace can count the two apart.
 */
export class ToolContractError extends Error {
  readonly guard?: GuardClass;

  constructor(message: string, guard?: GuardClass) {
    super(message);
    this.name = "ToolContractError";
    this.guard = guard;
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ToolContractError(`${field} must be a string`);
  }
  return value;
}

function optionalText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optionalCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Resolves a caller-supplied path inside the work directory and refuses anything
 * that escapes it. The check runs on the resolved absolute path, so `..`, an
 * absolute path and a symlink pointing out are all caught by the same test.
 */
export function resolveInsideWorkdir(workdir: string, relative: string): string {
  const candidate = isAbsolute(relative) ? relative : join(workdir, relative);
  const target = resolve(candidate);
  if (target !== workdir && !target.startsWith(workdir + sep)) {
    throw new ToolContractError(`path escapes the work directory: ${relative}`, "path_escape");
  }
  return target;
}

function summarise(body: string, limit: number): { summary: string; truncated: boolean } {
  if (body.length <= limit) {
    return { summary: body, truncated: false };
  }
  return { summary: `${body.slice(0, limit)}... [truncated]`, truncated: true };
}

const LIST_DIR_PARAMETERS: ToolArgs = {
  type: "object",
  properties: {
    path: { type: "string", description: "Directory to list, relative to the work directory." },
  },
  required: ["path"],
  additionalProperties: false,
};

const READ_FILE_PARAMETERS: ToolArgs = {
  type: "object",
  properties: {
    path: { type: "string", description: "File to read, relative to the work directory." },
    max_bytes: { type: "integer", minimum: 0, description: "Cap on bytes returned." },
  },
  required: ["path"],
  additionalProperties: false,
};

const WRITE_FILE_PARAMETERS: ToolArgs = {
  type: "object",
  properties: {
    path: { type: "string", description: "File to write, relative to the work directory." },
    content: { type: "string", description: "Full replacement content." },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

const FETCH_URL_PARAMETERS: ToolArgs = {
  type: "object",
  properties: {
    url: { type: "string", description: "Absolute http(s) URL to fetch." },
  },
  required: ["url"],
  additionalProperties: false,
};

/**
 * Canonical JSON of a schema object: object keys sorted at every depth, so the hash
 * depends on the contract and not on the order the keys happen to be written in.
 *
 * `JSON.stringify(value, Object.keys(value).sort())` is not a canonicaliser. Its
 * second argument is a key allowlist applied recursively at every level, so it
 * silently drops the nested `description` fields and any key not present at the top
 * level. The first version of this function did exactly that, and two tools with
 * clearly different parameter schemas hashed identically, which defeats the whole
 * point of recording a hash.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function schemaHash(parameters: ToolArgs): string {
  return createHash("sha256").update(canonicalJson(parameters), "utf8").digest("hex").slice(0, 16);
}

/**
 * The tool set offered by the spike.
 *
 * `fetch_url` is registered but unavailable on purpose. The spike has no network
 * path by design, and a trace that cannot say "this tool existed and was withheld"
 * leaves a reader guessing why it was never called. Leaving it out of the registry
 * entirely would be the easier choice and would also leave the `available` flag
 * untested.
 */
export function createToolSet(): ToolDefinition[] {
  return [
    {
      name: "list_dir",
      description: "List the entries of a directory inside the work directory.",
      parameters: LIST_DIR_PARAMETERS,
      effect: "none",
      available: true,
      maxResultBytes: 2048,
      run(args, env) {
        const relative = optionalText(args.path, ".");
        const target = resolveInsideWorkdir(env.workdir, relative);
        let names: string[];
        try {
          names = readdirSync(target);
        } catch (error) {
          return { ok: false, error: "dir_not_readable", message: String(error) };
        }
        names.sort();
        const body = names.join("\n");
        return {
          ok: true,
          summary: body,
          resultBytes: Buffer.byteLength(body, "utf8"),
          truncated: false,
        };
      },
    },
    {
      name: "read_file",
      description: "Read a text file inside the work directory.",
      parameters: READ_FILE_PARAMETERS,
      effect: "none",
      available: true,
      maxResultBytes: 4096,
      run(args, env) {
        const relative = text(args.path, "path");
        const cap = optionalCount(args.max_bytes, 4096);
        const target = resolveInsideWorkdir(env.workdir, relative);
        let body: string;
        try {
          body = readFileSync(target, "utf8");
        } catch (error) {
          return { ok: false, error: "file_not_readable", message: String(error) };
        }
        const clipped = body.length > cap ? body.slice(0, cap) : body;
        const trimmed = summarise(clipped, 4096);
        // Two different caps can shorten what the model sees: the caller's max_bytes
        // and the tool's own result cap. Either way the marker has to be there,
        // because the schema promises truncation is never silent.
        const clippedByCaller = body.length > cap;
        const summary = clippedByCaller && !trimmed.truncated ? `${trimmed.summary}... [truncated]` : trimmed.summary;
        return {
          ok: true,
          summary,
          resultBytes: Buffer.byteLength(body, "utf8"),
          truncated: trimmed.truncated || clippedByCaller,
        };
      },
    },
    {
      name: "write_file",
      description: "Write a text file inside the work directory. Requires permission.",
      parameters: WRITE_FILE_PARAMETERS,
      effect: "applied",
      available: true,
      maxResultBytes: 256,
      run(args, env) {
        const relative = text(args.path, "path");
        const content = text(args.content, "content");
        const target = resolveInsideWorkdir(env.workdir, relative);
        try {
          mkdirSync(resolve(target, ".."), { recursive: true });
          writeFileSync(target, content, "utf8");
        } catch (error) {
          return { ok: false, error: "file_not_writable", message: String(error) };
        }
        const body = `wrote ${relative} (${Buffer.byteLength(content, "utf8")} bytes)`;
        return {
          ok: true,
          summary: body,
          resultBytes: Buffer.byteLength(body, "utf8"),
          truncated: false,
        };
      },
    },
    {
      name: "fetch_url",
      description: "Fetch a URL. Unavailable in the spike: there is no network path.",
      parameters: FETCH_URL_PARAMETERS,
      effect: "unknown",
      available: false,
      maxResultBytes: 0,
      run() {
        return {
          ok: false,
          error: "tool_unavailable",
          message: "the spike has no network path, so this tool is never offered to the model",
        };
      },
    },
  ];
}

/** The tool set summary recorded at run start, in registration order. */
export function toolSummaries(tools: ToolDefinition[]): Array<{ name: string; schema_hash: string; available: boolean }> {
  return tools.map((tool) => ({
    name: tool.name,
    schema_hash: schemaHash(tool.parameters),
    available: tool.available,
  }));
}

/** Whether a tool needs a permission decision before it may run. */
export function requiresPermission(tool: ToolDefinition): boolean {
  return tool.effect !== "none";
}

/** Re-exported so tests can assert on the same helper the agent loop uses. */
export function pathExistsInsideWorkdir(workdir: string, relative: string): boolean {
  try {
    const target = resolveInsideWorkdir(workdir, relative);
    statSync(target);
    return true;
  } catch {
    return false;
  }
}
