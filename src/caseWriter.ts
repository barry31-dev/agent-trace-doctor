import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The one place this project writes a file.
 *
 * Everything else in the tool reads a trace and prints a report; `eval-gen --out` is
 * the first command that leaves something behind, so the rules for it live here in one
 * module rather than being spread through the CLI: the name is derived from the run id
 * but cannot escape the directory it was given, an existing file is never replaced
 * unless that was asked for in as many words, and every failure comes back as a
 * message the CLI can print instead of an exception that would take the exit code with
 * it.
 */

export type CaseWriteResult = { ok: true; path: string; bytes: number } | { ok: false; message: string };

/** Long enough for any real run id, short enough for every file system this runs on. */
const MAX_NAME_LENGTH = 64;

/** Used when the run id cannot produce a usable file name at all. */
const FALLBACK_NAME = "trace";

/**
 * The file name one run's cases are written to. A `run_id` is recorder data, not a path
 * component: it may contain a slash, a leading dash or nothing usable at all, and the
 * name has to survive all of that without leaving the directory it was given. Every
 * character outside a conservative set becomes an underscore, and a result that is
 * empty, a dot, a dot-dot or an option-looking dash falls back to a fixed name.
 */
export function caseFileName(runId: string | null): string {
  const source = runId ?? "";
  const sanitized = source.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, MAX_NAME_LENGTH);
  if (sanitized.length === 0 || sanitized === "." || sanitized === ".." || sanitized.startsWith("-")) {
    return FALLBACK_NAME;
  }
  return sanitized;
}

/**
 * Writes one run's cases as JSON. The bytes are exactly what `--json` prints, so a
 * caller can compare the two without wondering whether the file got a different
 * rendering. `force` is the only thing that lets an existing file be replaced: a
 * generated case file is a record of a run that already happened, and silently
 * overwriting it would lose the only evidence the earlier run left.
 */
export function writeCaseFile(directory: string, runId: string | null, json: string, force: boolean): CaseWriteResult {
  const path = join(directory, `${caseFileName(runId)}.json`);
  if (!force && existsSync(path)) {
    return { ok: false, message: `${path} already exists; pass --force to replace it` };
  }
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, json, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const detail = typeof code === "string" ? code : String(error);
    return { ok: false, message: `cannot write ${path} (${detail})` };
  }
  return { ok: true, path, bytes: Buffer.byteLength(json, "utf8") };
}
