import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadTraceFile } from "../src/loader.js";
import { EXAMPLE_FILES, projectRoot } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "agent-trace-doctor-loader-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const EVENT_LINE =
  '{"schema_version":"1","event_id":"evt_000001","timestamp":"2026-10-14T10:00:00.000Z","type":"run.started","run_id":"run_01","payload":{"input_summary":"x"}}';

function scratchText(name: string, content: string): string {
  const path = join(scratch, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function scratchBytes(name: string, bytes: number[]): string {
  const path = join(scratch, name);
  writeFileSync(path, Buffer.from(bytes));
  return path;
}

function expectFailure(path: string, kind: string): void {
  const result = loadTraceFile(path);
  if (result.ok) {
    throw new Error(`expected ${kind} failure for ${path}`);
  }
  expect(result.kind).toBe(kind);
}

describe("trace loader", () => {
  it("reads every bundled example with 1-based line numbers", () => {
    const expectedCounts: Record<string, number> = {
      "examples/success.jsonl": 19,
      "examples/failed.jsonl": 26,
      "examples/cancelled.jsonl": 8,
    };
    for (const relativePath of EXAMPLE_FILES) {
      const result = loadTraceFile(join(projectRoot, relativePath));
      if (!result.ok) {
        throw new Error(`expected ${relativePath} to load`);
      }
      expect(result.events.length).toBe(expectedCounts[relativePath]);
      expect(result.events.map((loaded) => loaded.line)).toEqual(
        result.events.map((_, index) => index + 1),
      );
    }
  });

  it("skips blank lines without shifting line numbers", () => {
    const path = scratchText("blank-lines.jsonl", `${EVENT_LINE}\n\n   \n${EVENT_LINE}\n`);
    const result = loadTraceFile(path);
    if (!result.ok) {
      throw new Error("expected blank lines to be skipped, not to fail");
    }
    expect(result.events.map((loaded) => loaded.line)).toEqual([1, 4]);
  });

  it("accepts CRLF line endings", () => {
    const path = scratchText("crlf.jsonl", `${EVENT_LINE}\r\n${EVENT_LINE}\r\n`);
    const result = loadTraceFile(path);
    if (!result.ok) {
      throw new Error("expected CRLF input to load");
    }
    expect(result.events.length).toBe(2);
  });

  it("keeps a JSON line that is not an object for the schema to reject", () => {
    const path = scratchText("array-line.jsonl", "[1,2,3]\n");
    const result = loadTraceFile(path);
    if (!result.ok) {
      throw new Error("expected the loader to hand the value to the schema");
    }
    expect(result.events[0]?.event).toEqual([1, 2, 3]);
  });

  it("reports an empty file", () => {
    expectFailure(scratchText("empty.jsonl", ""), "empty");
  });

  it("reports a file that holds only blank lines", () => {
    expectFailure(scratchText("only-blank.jsonl", "\n\n   \n"), "empty");
  });

  it("reports a missing file with the path and the errno", () => {
    const path = join(scratch, "does-not-exist.jsonl");
    const result = loadTraceFile(path);
    if (result.ok) {
      throw new Error("expected a missing file to fail");
    }
    expect(result.kind).toBe("unreadable");
    expect(result.message).toContain(path);
    expect(result.message).toContain("ENOENT");
  });

  it("reports a directory as unreadable", () => {
    const path = join(scratch, "a-directory");
    mkdtempSync(path);
    const result = loadTraceFile(path);
    if (result.ok) {
      throw new Error("expected a directory to fail");
    }
    expect(result.kind).toBe("unreadable");
  });

  it("reports invalid UTF-8", () => {
    const path = scratchBytes("bad-utf8.jsonl", [0x7b, 0xff, 0x7d, 0x0a]);
    const result = loadTraceFile(path);
    if (result.ok) {
      throw new Error("expected invalid UTF-8 to fail");
    }
    expect(result.kind).toBe("bad-utf8");
    expect(result.message).toContain(path);
  });

  it("reports a UTF-8 byte order mark instead of guessing", () => {
    const path = scratchBytes("bom.jsonl", [0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a]);
    const result = loadTraceFile(path);
    if (result.ok) {
      throw new Error("expected a BOM to fail");
    }
    expect(result.kind).toBe("bom");
    expect(result.line).toBe(1);
  });

  it("reports the line number of a line that is not JSON", () => {
    const path = scratchText("bad-json.jsonl", `${EVENT_LINE}\nnot json\n`);
    const result = loadTraceFile(path);
    if (result.ok) {
      throw new Error("expected a non-JSON line to fail");
    }
    expect(result.kind).toBe("bad-json");
    expect(result.line).toBe(2);
    expect(result.message).toContain("line 2");
  });

  it("reports a permission failure as unreadable", () => {
    const path = scratchText("no-permission.jsonl", `${EVENT_LINE}\n`);
    chmodSync(path, 0o000);
    try {
      const result = loadTraceFile(path);
      if (result.ok) {
        // A process that ignores file modes (root, some sandboxes) cannot observe this.
        return;
      }
      expect(result.kind).toBe("unreadable");
      expect(result.message).toContain(path);
    } finally {
      chmodSync(path, 0o600);
    }
    expect(statSync(path).isFile()).toBe(true);
  });
});
