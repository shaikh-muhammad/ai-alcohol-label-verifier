import "server-only";

import { Buffer } from "node:buffer";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { LabelImageMimeType } from "./gemini";
import { extractionPrompt } from "./label-extraction-prompt";
import { labelExtractionSchema, type LabelExtraction } from "./label-extraction-schema";

/** Fallback evidence extraction only; never makes compliance decisions. */
export async function extractLabelWithOpenAI(
  imageBytes: Uint8Array,
  mimeType: LabelImageMimeType,
): Promise<LabelExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new Error("The image-reading service is unavailable.");
  if (!(imageBytes instanceof Uint8Array) || imageBytes.byteLength === 0 ||
      !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Provide nonempty image bytes and a supported image MIME type.");
  }
  try {
    // Lazy construction keeps a missing fallback key from affecting Gemini success.
    const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });
    const response = await client.responses.parse({
      model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
      store: false,
      instructions: extractionPrompt,
      input: [{ role: "user", content: [{
        type: "input_image",
        image_url: `data:${mimeType};base64,${Buffer.from(imageBytes).toString("base64")}`,
        detail: "auto",
      }] }],
      text: { format: zodTextFormat(labelExtractionSchema, "label_extraction") },
    });
    if (response.status !== "completed") throw new Error("Incomplete extraction.");
    // Validate locally too, including refusals/null output and unexpected fields.
    return labelExtractionSchema.parse(response.output_parsed);
  } catch {
    // Never retain SDK messages, provider responses, or causes.
    throw new Error("The image-reading service could not extract label evidence.");
  }
}
