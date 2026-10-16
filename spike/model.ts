/**
 * The model layer of the mini agent spike.
 *
 * This module is the seam a real model plugs into. Everything the agent loop knows
 * about "thinking" goes through `ModelProvider.complete`; the spike ships one
 * implementation, `ScriptedModel`, which replays a fixed plan. That is enough to
 * exercise the recorder, the tools and the schema, and it costs nothing and talks to
 * nobody. Swapping in a provider that calls an API is a change to this file alone,
 * and it stays opt-in: no code path here reaches the network.
 */

import type { TokenUsage } from "./recorder.js";

/** One tool call the model asked for. */
export interface ToolCallRequest {
  /** Recorder-assigned id linking the started and completed events. */
  tool_call_id: string;
  tool: string;
  args: Record<string, unknown>;
}

/** What one model turn produced. */
export interface ModelTurn {
  /** Text the model wrote back. Null when the turn only called tools. */
  text: string | null;
  toolCalls: ToolCallRequest[];
  /** Provider finish reason, recorded verbatim. */
  finishReason: string;
  usage: TokenUsage;
}

/** Everything the provider is allowed to see about the run so far. */
export interface ModelContext {
  /** The task, as given to the run. */
  input: string;
  /** Names of the tools offered for this run, in registration order. */
  availableTools: string[];
  /** Results of tool calls completed so far, oldest first. */
  toolResults: ToolResultRecord[];
  /** How many model turns happened before this one. */
  turn: number;
}

/** A completed tool call, handed back to the model on the next turn. */
export interface ToolResultRecord {
  tool_call_id: string;
  tool: string;
  ok: boolean;
  /** Short text summary of the result. Full bodies stay out of the transcript. */
  summary: string;
}

/**
 * One model backend. Implementations must be deterministic given the same context
 * unless they are explicitly non-deterministic (a live API is), and they must not
 * touch the file system: tool execution belongs to the agent loop.
 */
export interface ModelProvider {
  readonly name: string;
  /** Whether responses arrive incrementally. Reported to the trace. */
  readonly streamed: boolean;
  /** Which slot of the turn this provider fills. */
  readonly role: "main" | "reference" | "aggregator";
  complete(context: ModelContext): ModelTurn;
}

/** One step of the scripted plan. */
export type ScriptedStep =
  | { kind: "tools"; text?: string; calls: Array<{ tool: string; args: Record<string, unknown> }> }
  | { kind: "final"; text: string };

export interface ScriptedModelOptions {
  name?: string;
  role?: "main" | "reference" | "aggregator";
  streamed?: boolean;
  steps: ScriptedStep[];
  /** Token counts to report per turn. Defaults to a fixed pair. */
  usage?: TokenUsage;
}

/**
 * A model that replays a fixed plan, one step per turn. The plan is indexed by turn
 * number, so the same context always produces the same turn.
 *
 * `complete` throws when the plan runs out instead of inventing a final answer: a
 * spike that silently succeeded after its script ended would produce a trace that
 * looks like a real five-step run while actually being a truncated one.
 */
export class ScriptedModel implements ModelProvider {
  readonly name: string;
  readonly role: "main" | "reference" | "aggregator";
  readonly streamed: boolean;

  private readonly steps: ScriptedStep[];
  private readonly usage: TokenUsage;

  constructor(options: ScriptedModelOptions) {
    this.name = options.name ?? "scripted-stub-1";
    this.role = options.role ?? "main";
    this.streamed = options.streamed ?? false;
    this.steps = options.steps;
    this.usage = options.usage ?? { input_tokens: 512, output_tokens: 96 };
  }

  complete(context: ModelContext): ModelTurn {
    const step = this.steps[context.turn];
    if (step === undefined) {
      throw new Error(`scripted model has no step ${context.turn + 1} of ${this.steps.length}`);
    }
    if (step.kind === "final") {
      return {
        text: step.text,
        toolCalls: [],
        finishReason: "stop",
        usage: this.usage,
      };
    }
    return {
      text: step.text ?? null,
      toolCalls: step.calls.map((call, index) => ({
        tool_call_id: `call_${context.turn + 1}_${index + 1}`,
        tool: call.tool,
        args: call.args,
      })),
      finishReason: "tool_calls",
      usage: this.usage,
    };
  }
}
