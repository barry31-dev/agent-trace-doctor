/**
 * The mini agent loop of the spike.
 *
 * Five steps, real execution, one trace. "Real" here means the loop really runs,
 * the tools really touch the file system inside the sandbox, and every event is
 * written by the recorder as it happens. The only thing that is not real is the
 * model: it is a `ScriptedModel` replaying a fixed plan, so the spike costs nothing
 * and talks to nobody. That is the point of a spike, and it is also why this loop
 * is the place to learn what the trace schema can and cannot express.
 *
 * The loop records before and after every side effect, never only after: a trace
 * that contains only completions cannot tell "the call never happened" from "the
 * call happened and the process died before writing it down".
 */

import type { EffectDisposition, ModelRole, TraceEvent, TraceRecorder } from "./recorder.js";
import type { ModelContext, ModelProvider, ToolResultRecord } from "./model.js";
import { ToolContractError, requiresPermission, toolSummaries } from "./tools.js";
import type { GuardClass, ToolArgs, ToolDefinition, ToolEnvironment, ToolOutcome } from "./tools.js";

export interface AgentRunOptions {
  input: string;
  model: ModelProvider;
  tools: ToolDefinition[];
  workdir: string;
  recorder: TraceRecorder;
  /** Hard cap on model turns. The spike default is 5. */
  maxSteps?: number;
  /** Who decided the permission requests. Recorded verbatim. */
  decidedBy?: string;
}

export type RunOutcome = "completed" | "failed";

export interface AgentRunResult {
  outcome: RunOutcome;
  /** Events written, in file order. */
  events: TraceEvent[];
  /** Turns the loop actually ran. */
  steps: number;
  /** The final text the model produced, when it produced one. */
  finalText: string | null;
}

interface TranscriptEntry {
  role: "system" | "user" | "assistant" | "tool";
  text: string;
}

/**
 * A short, single-line, human-readable rendering of the arguments a tool received.
 * Full arguments are deliberately kept out of the trace: they can carry file
 * contents and secrets, and the trace is meant to be shareable. Whitespace runs
 * are collapsed first so a value that carries newlines (a file body, a diff)
 * cannot break the one-line-per-event contract the timeline table depends on.
 */
export function summariseArgs(args: ToolArgs): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      const flat = value.replace(/\s+/g, " ").trim();
      const shown = flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
      parts.push(`${key}=${shown}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${value}`);
    } else {
      parts.push(`${key}=<${Array.isArray(value) ? "array" : "object"}>`);
    }
  }
  return parts.join(" ");
}

function recordToolFailure(
  recorder: TraceRecorder,
  tool: string,
  errorType: string,
  message: string,
  durationMs: number,
  guard?: GuardClass,
): void {
  recorder.record("tool.call.failed", {
    tool,
    status: "failed",
    error: { type: errorType, message },
    duration_ms: durationMs,
    ...(guard === undefined ? {} : { guard }),
  });
}

/** Runs the loop to completion and returns what it did. */
export function runAgent(options: AgentRunOptions): AgentRunResult {
  const { input, model, tools, workdir, recorder, maxSteps = 5, decidedBy = "spike-policy" } = options;

  const env: ToolEnvironment = { workdir };
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const transcript: TranscriptEntry[] = [
    { role: "system", text: "You are the mini agent of the Agent Trace Doctor spike." },
    { role: "user", text: input },
  ];
  const toolResults: ToolResultRecord[] = [];

  recorder.record("run.started", {
    input_summary: input,
    config_summary: {
      model: model.name,
      max_steps: maxSteps,
      tools: toolSummaries(tools),
    },
  });

  let finalText: string | null = null;
  let steps = 0;

  for (let turn = 0; turn < maxSteps; turn += 1) {
    steps = turn + 1;

    const context: ModelContext = {
      input,
      availableTools: tools.filter((tool) => tool.available).map((tool) => tool.name),
      toolResults: [...toolResults],
      turn,
    };

    recorder.record("model.request.started", {
      model: model.name,
      messages: transcript.length,
      role: model.role as ModelRole,
      slot_label: "planner",
    });

    const requestedAt = Date.now();
    const turnResult = model.complete(context);
    const responseMs = Date.now() - requestedAt;

    transcript.push({ role: "assistant", text: turnResult.text ?? "(tool calls only)" });

    recorder.record("model.response.completed", {
      model: model.name,
      usage: turnResult.usage,
      duration_ms: responseMs,
      finish_reason: turnResult.finishReason,
      role: model.role as ModelRole,
      slot_label: "planner",
      streamed: model.streamed,
      // `capture` is only written when there is a body to place. A tool-calls-only
      // turn produced no text, and claiming "inline" for it would tell a reader the
      // body is in the event when there is no body at all.
      ...(turnResult.text === null ? {} : { capture: "inline", output_summary: turnResult.text }),
    });

    if (turnResult.finishReason === "stop") {
      finalText = turnResult.text;
      break;
    }

    for (const call of turnResult.toolCalls) {
      const tool = byName.get(call.tool);

      if (tool === undefined) {
        recordToolFailure(recorder, call.tool, "unknown_tool", `no tool named ${call.tool} is registered`, 0);
        toolResults.push({
          tool_call_id: call.tool_call_id,
          tool: call.tool,
          ok: false,
          summary: `unknown tool ${call.tool}`,
        });
        transcript.push({ role: "tool", text: `error: unknown tool ${call.tool}` });
        continue;
      }

      if (!tool.available) {
        // A tool that was never offered still has to be answered, and the answer has
        // to say why. This is the only place a trace can explain a tool the model
        // asked for and never got.
        recordToolFailure(
          recorder,
          tool.name,
          "tool_unavailable",
          `${tool.name} exists but was withheld from this run`,
          0,
        );
        toolResults.push({
          tool_call_id: call.tool_call_id,
          tool: tool.name,
          ok: false,
          summary: `${tool.name} is unavailable`,
        });
        transcript.push({ role: "tool", text: `error: ${tool.name} is unavailable` });
        continue;
      }

      if (requiresPermission(tool)) {
        recorder.record("permission.requested", {
          action: tool.name,
          resource: typeof call.args.path === "string" ? call.args.path : undefined,
          tool: tool.name,
        });
        const approved = true;
        recorder.record("permission.resolved", {
          decision: approved ? "approved" : "denied",
          decided_by: decidedBy,
        });
        if (!approved) {
          recordToolFailure(
            recorder,
            tool.name,
            "permission_denied",
            `permission for ${tool.name} was denied`,
            0,
          );
          toolResults.push({
            tool_call_id: call.tool_call_id,
            tool: tool.name,
            ok: false,
            summary: `permission denied for ${tool.name}`,
          });
          transcript.push({ role: "tool", text: `error: permission denied for ${tool.name}` });
          continue;
        }
      }

      recorder.record("tool.call.started", {
        tool: tool.name,
        tool_call_id: call.tool_call_id,
        args_summary: summariseArgs(call.args),
      });

      const startedAt = Date.now();
      let outcome: ToolOutcome;
      try {
        outcome = tool.run(call.args, env);
      } catch (error) {
        // A tool that throws instead of returning is a contract violation at the
        // tool boundary, and it is recorded as one rather than being allowed to end
        // the run: the reader needs to see which call broke the contract.
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof ToolContractError) {
          outcome = { ok: false, error: "argument_contract", message, ...(error.guard === undefined ? {} : { guard: error.guard }) };
        } else {
          outcome = { ok: false, error: "tool_threw", message };
        }
      }
      const durationMs = Date.now() - startedAt;

      if (outcome.ok) {
        recorder.record("tool.call.completed", {
          tool: tool.name,
          status: "completed",
          duration_ms: durationMs,
          result_bytes: outcome.resultBytes,
          result_truncated: outcome.truncated,
          effect_disposition: tool.effect as EffectDisposition,
        });
        toolResults.push({
          tool_call_id: call.tool_call_id,
          tool: tool.name,
          ok: true,
          summary: outcome.summary,
        });
        transcript.push({ role: "tool", text: outcome.summary });
      } else {
        recordToolFailure(recorder, tool.name, outcome.error, outcome.message, durationMs, outcome.guard);
        toolResults.push({
          tool_call_id: call.tool_call_id,
          tool: tool.name,
          ok: false,
          summary: outcome.message,
        });
        transcript.push({ role: "tool", text: `error: ${outcome.message}` });
      }
    }
  }

  if (finalText === null) {
    recorder.record("run.failed", {
      status: "failed",
      error: {
        type: "step_limit_reached",
        message: `the model did not produce a final answer within ${maxSteps} steps`,
      },
    });
    return { outcome: "failed", events: [...recorder.events()], steps, finalText: null };
  }

  recorder.record("run.finished", {
    status: "completed",
    output_summary: finalText,
  });
  return { outcome: "completed", events: [...recorder.events()], steps, finalText };
}
