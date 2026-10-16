import { annotateEvents, asRecord, asText, describeEvent, payloadOf } from "./analyze.js";
import type { LoadedEvent } from "./loader.js";

/**
 * One event printed in full. The payload is carried through as the recorder wrote it,
 * key order included: `show` is the command a reader uses to check what a line on disk
 * actually says, so re-ordering it would defeat the purpose.
 */
export interface ShownEvent {
  index: number;
  step: number;
  line: number;
  event_id: string;
  timestamp: string;
  offset_ms: number;
  duration_ms: number | null;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface ShowReport {
  command: "show";
  file: string;
  schema: string;
  run_id: string | null;
  /** Events in the file, not the number selected. */
  events: number;
  selected: ShownEvent[];
}

export type ShowResult = { ok: true; report: ShowReport } | { ok: false; message: string };

/**
 * Builds the `show` report. With an event id, exactly that event is selected and an id
 * the file does not carry is reported as not found rather than as an empty report,
 * because an empty report reads like "this run had no events". Without one, every
 * event is selected, which is what `timeline` carries plus the payload.
 *
 * Pure over loaded events, like the analyzer and the diff: no clock, no file system,
 * no network.
 */
export function buildShow(file: string, schemaLabel: string, events: LoadedEvent[], eventId: string | null): ShowResult {
  const annotations = annotateEvents(events);
  let runId: string | null = null;
  const selected: ShownEvent[] = [];

  for (let position = 0; position < events.length; position += 1) {
    const loaded = events[position];
    const annotation = annotations[position];
    if (loaded === undefined || annotation === undefined) {
      continue;
    }
    const { event } = loaded;
    if (runId === null) {
      const id = asText(asRecord(event)?.run_id);
      if (id !== null) {
        runId = id;
      }
    }
    if (eventId !== null && annotation.event_id !== eventId) {
      continue;
    }
    selected.push({
      ...annotation,
      type: asText(asRecord(event)?.type) ?? "unknown",
      summary: describeEvent(event),
      payload: payloadOf(event),
    });
  }

  if (eventId !== null && selected.length === 0) {
    return { ok: false, message: `no event with id ${eventId} in ${file}` };
  }

  return {
    ok: true,
    report: {
      command: "show",
      file,
      schema: schemaLabel,
      run_id: runId,
      events: events.length,
      selected,
    },
  };
}
