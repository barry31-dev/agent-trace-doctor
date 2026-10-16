import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/analyze.js";
import { loadTraceFile } from "../src/loader.js";
import { renderShowJson, renderShowText } from "../src/report.js";
import { buildShow } from "../src/show.js";
import type { ShowReport } from "../src/show.js";
import { projectRoot } from "./helpers.js";

function load(name: string) {
  const loaded = loadTraceFile(join(projectRoot, "examples", name));
  if (!loaded.ok) {
    throw new Error(`fixture ${name} did not load: ${loaded.message}`);
  }
  return loaded.events;
}

function show(name: string, eventId: string | null = null): ShowReport {
  const result = buildShow(`examples/${name}`, "bundled", load(name), eventId);
  if (!result.ok) {
    throw new Error(`show failed for ${name}: ${result.message}`);
  }
  return result.report;
}

const FAILED = show("failed.jsonl");

describe("show: selection", () => {
  it("selects exactly the named event", () => {
    const report = show("failed.jsonl", "evt_000013");
    expect(report.selected.map((event) => event.event_id)).toEqual(["evt_000013"]);
    expect(report.selected[0]?.line).toBe(13);
    expect(report.selected[0]?.type).toBe("tool.call.failed");
  });

  it("selects every event, in file order, when no id is given", () => {
    const onDisk = load("failed.jsonl").map(({ event }) => (event as { event_id: string }).event_id);
    expect(FAILED.selected.map((event) => event.event_id)).toEqual(onDisk);
    expect(FAILED.selected.map((event) => event.line)).toEqual(
      load("failed.jsonl").map(({ line }) => line),
    );
  });

  it("reports an id the file does not carry instead of an empty report", () => {
    const result = buildShow("examples/failed.jsonl", "bundled", load("failed.jsonl"), "evt_999999");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toBe("no event with id evt_999999 in examples/failed.jsonl");
  });

  it("counts the file, not the selection, in events", () => {
    expect(FAILED.events).toBe(26);
    expect(show("failed.jsonl", "evt_000013").events).toBe(26);
    expect(show("failed.jsonl", "evt_000013").selected).toHaveLength(1);
  });

  it("takes run_id from the first event that carries one", () => {
    expect(FAILED.run_id).toBe("run_02");
    expect(show("success.jsonl").run_id).toBe("run_01");
    expect(show("cancelled.jsonl").run_id).toBe("run_03");
  });
});

describe("show: agreement with the other per-event commands", () => {
  it("reports the same line, step, offset and description as timeline for every example", () => {
    for (const name of ["success.jsonl", "failed.jsonl", "cancelled.jsonl", "spike-run.jsonl"]) {
      const timeline = buildTimeline(`examples/${name}`, "bundled", load(name));
      const report = show(name);
      expect(report.selected.map((event) => [event.line, event.step, event.offset_ms, event.summary])).toEqual(
        timeline.events.map((row) => [row.line, row.step, row.offset_ms, row.summary]),
      );
    }
  });

  it("reports the same duration the recorder wrote, and null when it wrote none", () => {
    const completed = show("failed.jsonl", "evt_000003");
    expect(completed.selected[0]?.duration_ms).toBe(960);
    const started = show("failed.jsonl", "evt_000004");
    expect(started.selected[0]?.duration_ms).toBeNull();
  });
});

describe("show: the payload", () => {
  it("carries the payload exactly as the recorder wrote it, key order included", () => {
    const raw = readFileSync(join(projectRoot, "examples/failed.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const line13 = JSON.parse(raw[12] ?? "{}") as { payload: Record<string, unknown> };
    const shown = show("failed.jsonl", "evt_000013").selected[0];
    expect(shown?.payload).toEqual(line13.payload);
    expect(Object.keys(shown?.payload ?? {})).toEqual(Object.keys(line13.payload));
  });

  it("keeps a nested object printable on one line and a JSON null as null", () => {
    const report: ShowReport = {
      command: "show",
      file: "fixture.jsonl",
      schema: "bundled",
      run_id: "run_01",
      events: 1,
      selected: [
        {
          index: 1,
          step: 1,
          line: 1,
          event_id: "evt_000001",
          timestamp: "2026-10-14T10:00:00.000Z",
          offset_ms: 0,
          duration_ms: null,
          type: "tool.call.completed",
          summary: "tool result: read_file; 250 ms; 1024 bytes",
          payload: { nested: { a: 1, b: [1, 2] }, nothing: null, flag: true },
        },
      ],
    };
    const text = renderShowText(report);
    expect(text).toContain('nested   {"a":1,"b":[1,2]}');
    expect(text).toContain("nothing  null");
    expect(text).toContain("flag     true");
  });

  it("says so when an event has no payload fields at all", () => {
    const report: ShowReport = {
      command: "show",
      file: "fixture.jsonl",
      schema: "bundled",
      run_id: "run_01",
      events: 1,
      selected: [
        {
          index: 1,
          step: 1,
          line: 1,
          event_id: "evt_000001",
          timestamp: "2026-10-14T10:00:00.000Z",
          offset_ms: 0,
          duration_ms: null,
          type: "run.finished",
          summary: "run finished: completed",
          payload: {},
        },
      ],
    };
    expect(renderShowText(report)).toContain("(no payload fields)");
  });
});

describe("show: report rendering", () => {
  it("states both numbers in the selection line when the whole file was selected", () => {
    expect(renderShowText(FAILED).split("\n")[4]).toBe("selected  26 of 26 events");
  });

  it("names the selected id when exactly one was", () => {
    const text = renderShowText(show("failed.jsonl", "evt_000013"));
    expect(text.split("\n")[4]).toBe("selected  1 of 26 events: evt_000013");
  });

  it("says events, singular, for a one-event selection", () => {
    const one = show("cancelled.jsonl", "evt_000008");
    expect(renderShowText(one).split("\n")[4]).toBe("selected  1 of 8 events: evt_000008");
  });

  it("prints stable top-level keys in --json mode", () => {
    expect(Object.keys(JSON.parse(renderShowJson(FAILED)) as object)).toEqual([
      "command",
      "file",
      "schema",
      "run_id",
      "events",
      "selected",
    ]);
  });

  it("prints stable keys for one selected event in --json mode", () => {
    const parsed = JSON.parse(renderShowJson(FAILED)) as ShowReport;
    expect(Object.keys(parsed.selected[0] ?? {})).toEqual([
      "index",
      "step",
      "line",
      "event_id",
      "timestamp",
      "offset_ms",
      "duration_ms",
      "type",
      "summary",
      "payload",
    ]);
  });

  it("produces the same bytes for the same input, twice", () => {
    expect(renderShowText(FAILED)).toBe(renderShowText(show("failed.jsonl")));
    expect(renderShowJson(FAILED)).toBe(renderShowJson(show("failed.jsonl")));
  });
});

/**
 * The README shows one block of real terminal output. A block that drifts from what the
 * command prints is a documentation bug that reads as a feature, so it is compared here
 * rather than trusted.
 */
describe("show: the README excerpt", () => {
  it("matches what the command actually prints", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("### `trace show FILE"));
    expect(section.length).toBeGreaterThan(0);
    const block = /```text\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(renderShowText(show("failed.jsonl", "evt_000013")));
  });
});
