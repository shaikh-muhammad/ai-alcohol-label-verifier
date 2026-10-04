import "server-only";

import { Buffer } from "node:buffer";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { LabelImageMimeType } from "./gemini";
import { extractionPrompt } from "./label-extraction-prompt";
import { labelExtractionSchema, type LabelExtraction } from "./label-extraction-schema";

export class OpenAIExtractionError extends Error {
  constructor(public readonly code: "CONFIGURATION" | "INVALID_IMAGE" | "OPENAI_REQUEST", message: string) {
    super(message);
    this.name = "OpenAIExtractionError";
  }
}

/** Primary evidence extraction only; never makes compliance decisions. */
export async function extractLabelWithOpenAI(
  imageBytes: Uint8Array,
  mimeType: LabelImageMimeType,
): Promise<LabelExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new OpenAIExtractionError("CONFIGURATION", "The image-reading service is unavailable.");
  if (!(imageBytes instanceof Uint8Array) || imageBytes.byteLength === 0 ||
      !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new OpenAIExtractionError("INVALID_IMAGE", "Provide nonempty image bytes and a supported image MIME type.");
  }
  try {
    // Construct server-side at request time so configuration failures can fall back.
    const client = new OpenAI({ apiKey, timeout: 5_000, maxRetries: 0 });
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
    throw new OpenAIExtractionError("OPENAI_REQUEST", "The image-reading service could not extract label evidence.");
  }
}
