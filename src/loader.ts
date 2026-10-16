import { readFileSync } from "node:fs";

/**
 * Result of reading a trace file. Failures are returned, never thrown, so the CLI can
 * map every cause to a documented exit code and keep the file path and line number in
 * the message the user reads.
 */
export type LoadResult = LoadSuccess | LoadFailure;

export interface LoadedEvent {
  /** 1-based line number in the file, kept so every later error stays traceable. */
  line: number;
  /** Parsed JSON value of that line. The schema decides whether it is a valid event. */
  event: unknown;
}

export interface LoadSuccess {
  ok: true;
  path: string;
  events: LoadedEvent[];
}

export type LoadFailureKind = "unreadable" | "empty" | "bad-utf8" | "bom" | "bad-json";

export interface LoadFailure {
  ok: false;
  kind: LoadFailureKind;
  path: string;
  /** Line number when the failure is tied to one line, otherwise null. */
  line: number | null;
  message: string;
}

const BYTE_ORDER_MARK = "\uFEFF";

function unreadable(path: string, error: unknown): LoadFailure {
  const code = (error as NodeJS.ErrnoException).code;
  const detail = typeof code === "string" ? code : String(error);
  return {
    ok: false,
    kind: "unreadable",
    path,
    line: null,
    message: `cannot read ${path} (${detail})`,
  };
}

/**
 * Reads a JSONL trace file. Lines are split on LF; a trailing CR from CRLF endings is
 * left in place because JSON.parse ignores surrounding whitespace. Blank lines are
 * skipped and never produce events, so line numbers keep matching the file on disk.
 */
export function loadTraceFile(path: string): LoadResult {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return unreadable(path, error);
  }

  let text: string;
  try {
    // ignoreBOM keeps a leading U+FEFF in the decoded text: the default decoder drops
    // it silently, which would turn "wrong encoding" into six confusing schema errors.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      kind: "bad-utf8",
      path,
      line: null,
      message: `${path} is not valid UTF-8`,
    };
  }

  if (text.startsWith(BYTE_ORDER_MARK)) {
    return {
      ok: false,
      kind: "bom",
      path,
      line: 1,
      message: `${path} starts with a UTF-8 byte order mark; re-save it as UTF-8 without BOM`,
    };
  }

  const events: LoadedEvent[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw === undefined || raw.trim().length === 0) {
      continue;
    }
    const line = index + 1;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        kind: "bad-json",
        path,
        line,
        message: `${path}: line ${line} is not valid JSON (${reason})`,
      };
    }
    events.push({ line, event });
  }

  if (events.length === 0) {
    return {
      ok: false,
      kind: "empty",
      path,
      line: null,
      message: `${path} contains no trace events`,
    };
  }

  return { ok: true, path, events };
}
