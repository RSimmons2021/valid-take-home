import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

/** Pinned so a change of model is a reviewed code change, not an environment surprise. */
export const MODEL = "gpt-6.1-terra";

/** USD per 1M tokens, from OpenAI's model page (checked 2026-11-18). Used for the cost shown in the UI and the daily budget. */
export const PRICE_PER_M = { input: 1.0, cachedInput: 0.05, output: 5.0 };

export interface Usage {
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export interface LlmRequest<T> {
  /** schema name sent to the API (letters, digits, underscores) */
  name: string;
  schema: z.ZodType<T>;
  instructions: string;
  input: string;
  maxOutputTokens: number;
}

/** The only thing the feature code knows about the model. Tests pass a fake. */
export type Llm = <T>(req: LlmRequest<T>) => Promise<{ data: T; usage: Usage }>;

export class AiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 502, code = "ai_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function costOf(inputTokens: number, cachedTokens: number, outputTokens: number): number {
  const fresh = Math.max(0, inputTokens - cachedTokens);
  return (fresh * PRICE_PER_M.input + cachedTokens * PRICE_PER_M.cachedInput + outputTokens * PRICE_PER_M.output) / 1e6;
}

/**
 * Structured call through the Responses API.
 *
 * - Structured Outputs (strict JSON schema from the zod schema) means the reply always
 *   parses; feature code still validates meaning (grounding, duplicates, limits).
 * - Low reasoning effort: these are short judgement tasks, and latency is felt in the UI.
 * - `store: false`: user briefs aren't retained by the API for later retrieval.
 * - One SDK retry for transient errors, and a hard timeout so a slow call can't hang the UI.
 */
export function openAiLlm(apiKey: string, timeoutMs = 25_000): Llm {
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: timeoutMs });
  return async <T>(req: LlmRequest<T>) => {
    const t0 = performance.now();
    let res;
    try {
      res = await client.responses.parse({
        model: MODEL,
        instructions: req.instructions,
        input: req.input,
        reasoning: { effort: "low" },
        max_output_tokens: req.maxOutputTokens,
        store: false,
        text: { format: zodTextFormat(req.schema as z.ZodType, req.name) },
      });
    } catch (e) {
      if (e instanceof OpenAI.APIConnectionTimeoutError) throw new AiError("The model took too long. Try again.", 504, "timeout");
      if (e instanceof OpenAI.RateLimitError) throw new AiError("The AI service is busy. Try again in a minute.", 429, "upstream_rate_limit");
      if (e instanceof OpenAI.APIError) throw new AiError("The AI service returned an error.", 502, "upstream_error");
      throw e;
    }
    if (res.status === "incomplete") throw new AiError("The model ran out of room before finishing. Try a shorter request.", 502, "incomplete");
    const data = res.output_parsed as T | null;
    if (data == null) throw new AiError("The model didn't return a usable answer.", 502, "no_output");
    const u = res.usage;
    const inputTokens = u?.input_tokens ?? 0;
    const cachedTokens = u?.input_tokens_details?.cached_tokens ?? 0;
    const outputTokens = u?.output_tokens ?? 0;
    return {
      data,
      usage: {
        model: MODEL,
        inputTokens,
        cachedTokens,
        outputTokens,
        costUsd: costOf(inputTokens, cachedTokens, outputTokens),
        ms: Math.round(performance.now() - t0),
      },
    };
  };
}
