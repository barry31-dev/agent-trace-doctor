/**
 * Model configuration, resolved from flags and environment.
 *
 * Nothing here reads a config file or writes one: the model name, the endpoint and
 * the key all come from a flag or a standard environment variable, and the key is
 * never stored, echoed or written anywhere by this tool. The defaults are the ones
 * the design draft names; the model name has no default on purpose, because picking
 * a model for the caller would be a silent decision about their money.
 */

/** The one provider this slice implements. */
export const DEFAULT_PROVIDER = "openai-compatible";

/** Speaks the OpenAI chat-completions dialect, which several gateways also implement. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * How many cited events may be quoted in one request. A trace with thousands of
 * failures would otherwise send thousands of events; the rest are still named in the
 * report, so nothing is hidden, only unquoted.
 */
export const DEFAULT_MAX_EXCERPT_EVENTS = 50;

export const ENV_API_KEY = "OPENAI_API_KEY";
export const ENV_BASE_URL = "OPENAI_BASE_URL";
export const ENV_MODEL = "OPENAI_MODEL";

export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  /** Null when no key is configured. The caller decides what that means. */
  apiKey: string | null;
  timeoutMs: number;
  /** Whether the trace file's own path may be included in the request. */
  sendPaths: boolean;
  maxExcerptEvents: number;
}

/** Flags the `explain` command collects before the model layer is touched. */
export interface ModelFlags {
  provider: string | null;
  modelName: string | null;
  timeoutSeconds: number | null;
  sendPaths: boolean;
  maxExcerptEvents: number | null;
}

export type ConfigResult = { ok: true; config: ModelConfig } | { ok: false; message: string };

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Resolves the model configuration. `env` is a parameter so tests can pass a plain
 * object instead of mutating the process environment.
 */
export function resolveModelConfig(flags: ModelFlags, env: Record<string, string | undefined> = process.env): ConfigResult {
  const model = nonEmpty(flags.modelName ?? undefined) ?? nonEmpty(env[ENV_MODEL]);
  if (model === null) {
    return {
      ok: false,
      message: `--model needs a model name: pass --model-name NAME or set ${ENV_MODEL}`,
    };
  }
  const baseUrl = nonEmpty(env[ENV_BASE_URL]) ?? DEFAULT_BASE_URL;
  const apiKey = nonEmpty(env[ENV_API_KEY]);
  return {
    ok: true,
    config: {
      provider: nonEmpty(flags.provider ?? undefined) ?? DEFAULT_PROVIDER,
      model,
      baseUrl,
      apiKey,
      timeoutMs: (flags.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      sendPaths: flags.sendPaths,
      maxExcerptEvents: flags.maxExcerptEvents ?? DEFAULT_MAX_EXCERPT_EVENTS,
    },
  };
}
