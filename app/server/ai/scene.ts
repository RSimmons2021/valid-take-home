import OpenAI from "openai";
import { z } from "zod";
import { AnglesRequest } from "./angles.ts";
import { AiError, type Usage } from "./llm.ts";

/**
 * A scene photo for a pin's video: the service happening in a neighbourhood like this one.
 *
 * The prompt is never the client's text. The route looks up the pin's *verified* angles
 * (the same cached reply the pin card shows) and paints the chosen angle's scene, which
 * verifyAngles already checked names no real place: image models render names as fake
 * signage. A fixed frame around it rules out text, logos and real likenesses. So this
 * endpoint can't be used to make arbitrary images on the project's key.
 */

/** Pinned like the text model: a change of model is a reviewed change. */
export const IMAGE_MODEL = "gpt-image-2";
/**
 * Low quality, portrait. It looks like a phone photo, takes ~13 s, and is the cheap tier;
 * medium took ~30 s and was more likely to slip in a readable logo. The cost is an estimate
 * (third-party figures for OpenAI's low tier, 1024×1536), used for the daily budget.
 */
export const IMAGE_COST_USD = 0.006;

export const SceneRequest = AnglesRequest.extend({
  /** which of the pin's verified angles to picture */
  angle: z.number().int().min(0).max(2).default(0),
});
export type SceneInput = z.infer<typeof SceneRequest>;

/** The only thing the route knows about the image model. Tests pass a fake. */
export type ImageGen = (prompt: string) => Promise<{ jpeg: Buffer; usage: Usage }>;

export function scenePrompt(scene: string): string {
  return [
    "Vertical 9:16 photograph for a local service ad, natural and warm, like a skilled phone photo, shallow depth of field.",
    `Scene: ${scene.trim()}`,
    "Absolutely no text, letters, numbers, logos, brand marks or signage anywhere in the image.",
    "No famous or real identifiable people; ordinary people only, faces natural.",
  ].join("\n");
}

export function openAiImage(apiKey: string, timeoutMs = 90_000): ImageGen {
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: timeoutMs });
  return async (prompt) => {
    const t0 = performance.now();
    let res;
    try {
      res = await client.images.generate({
        model: IMAGE_MODEL,
        prompt,
        size: "1024x1536",
        quality: "low",
        output_format: "jpeg",
        output_compression: 82,
        n: 1,
      });
    } catch (e) {
      if (e instanceof OpenAI.APIConnectionTimeoutError) throw new AiError("The image took too long. Try again.", 504, "timeout");
      if (e instanceof OpenAI.RateLimitError) throw new AiError("The image service is busy. Try again in a minute.", 429, "upstream_rate_limit");
      if (e instanceof OpenAI.BadRequestError) throw new AiError("The image service declined this scene.", 422, "image_refused");
      if (e instanceof OpenAI.APIError) throw new AiError("The image service returned an error.", 502, "upstream_error");
      throw e;
    }
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new AiError("The image service returned no image.", 502, "no_output");
    return {
      jpeg: Buffer.from(b64, "base64"),
      usage: {
        model: IMAGE_MODEL,
        inputTokens: res.usage?.input_tokens ?? 0,
        cachedTokens: 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        costUsd: IMAGE_COST_USD,
        ms: Math.round(performance.now() - t0),
      },
    };
  };
}
