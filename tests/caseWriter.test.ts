import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { caseFileName, writeCaseFile } from "../src/caseWriter.js";

const scratch = mkdtempSync(join(tmpdir(), "agent-trace-doctor-cases-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const JSON_BODY = '{"command":"eval-gen","cases":[]}\n';

describe("caseWriter: the file name", () => {
  it("uses the run id when it is a usable name", () => {
    expect(caseFileName("run_02")).toBe("run_02");
    expect(caseFileName("run-spike.05")).toBe("run-spike.05");
  });

  it("falls back to a fixed name when there is no run id at all", () => {
    expect(caseFileName(null)).toBe("trace");
    expect(caseFileName("")).toBe("trace");
  });

  it("cannot be walked out of the directory it is given", () => {
    // A run id is recorder data. Every separator and every character outside the
    // conservative set has to go, or a run id could name a path outside --out.
    expect(caseFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(caseFileName("/absolute/path")).toBe("_absolute_path");
    expect(caseFileName("a/b\\c")).toBe("a_b_c");
    expect(caseFileName("run 02")).toBe("run_02");
  });

  it("does not produce a name that looks like an option or a directory entry", () => {
    expect(caseFileName("-rf")).toBe("trace");
    expect(caseFileName(".")).toBe("trace");
    expect(caseFileName("..")).toBe("trace");
  });

  it("keeps the name short enough for any file system", () => {
    expect(caseFileName("r".repeat(500))).toHaveLength(64);
  });
});

describe("caseWriter: writing", () => {
  it("creates the directory and writes the bytes it was given", () => {
    const directory = join(scratch, "fresh", "evals");
    const written = writeCaseFile(directory, "run_02", JSON_BODY, false);
    expect(written.ok).toBe(true);
    if (!written.ok) {
      return;
    }
    expect(written.path).toBe(join(directory, "run_02.json"));
    expect(written.bytes).toBe(Buffer.byteLength(JSON_BODY, "utf8"));
    expect(existsSync(written.path)).toBe(true);
    expect(readFileSync(written.path, "utf8")).toBe(JSON_BODY);
  });

  it("refuses to replace an existing file unless force was asked for", () => {
    const directory = join(scratch, "replace");
    const first = writeCaseFile(directory, "run_02", JSON_BODY, false);
    expect(first.ok).toBe(true);

    const second = writeCaseFile(directory, "run_02", '{"command":"eval-gen","cases":[1]}\n', false);
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.message).toContain("already exists");
    expect(second.message).toContain("--force");
    // The refusal leaves the earlier file exactly as it was.
    expect(readFileSync(join(directory, "run_02.json"), "utf8")).toBe(JSON_BODY);
  });

  it("replaces the file when force was asked for", () => {
    const directory = join(scratch, "forced");
    writeCaseFile(directory, "run_02", JSON_BODY, false);
    const replacement = '{"command":"eval-gen","cases":[1,2]}\n';
    const written = writeCaseFile(directory, "run_02", replacement, true);
    expect(written.ok).toBe(true);
    expect(readFileSync(join(directory, "run_02.json"), "utf8")).toBe(replacement);
  });

  it("reports a directory it cannot create instead of throwing", () => {
    const blocker = join(scratch, "blocker");
    writeFileSync(blocker, "not a directory\n", "utf8");
    const written = writeCaseFile(join(blocker, "evals"), "run_02", JSON_BODY, false);
    expect(written.ok).toBe(false);
    if (written.ok) {
      return;
    }
    expect(written.message).toContain("cannot write");
    expect(written.message).toMatch(/\((EEXIST|ENOTDIR|EACCES)\)/);
  });

  it("writes one file per run id into a shared directory", () => {
    const directory = join(scratch, "shared");
    mkdirSync(directory, { recursive: true });
    writeCaseFile(directory, "run_a", JSON_BODY, false);
    writeCaseFile(directory, "run_b", JSON_BODY, false);
    expect(statSync(join(directory, "run_a.json")).isFile()).toBe(true);
    expect(statSync(join(directory, "run_b.json")).isFile()).toBe(true);
  });
});
