import "server-only";

import { Buffer } from "node:buffer";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { extractionPrompt } from "./label-extraction-prompt";
import { labelExtractionSchema, type LabelExtraction } from "./label-extraction-schema";

export type LabelImageMimeType = "image/jpeg" | "image/png" | "image/webp";

type ExtractionErrorCode =
  | "CONFIGURATION"
  | "INVALID_IMAGE"
  | "GEMINI_REQUEST"
  | "RATE_LIMIT"
  | "EMPTY_RESPONSE"
  | "INVALID_JSON"
  | "INVALID_EXTRACTION";

export class LabelExtractionError extends Error {
  constructor(public readonly code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = "LabelExtractionError";
  }
}

const extractionJsonSchema = z.toJSONSchema(labelExtractionSchema);

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientNetworkCodes = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isTransientGeminiError(error: unknown): boolean {
  // ApiError exposes status only; no structured Retry-After or retry-delay hint.
  if (error instanceof ApiError) return transientStatuses.has(error.status);
  if (!(error instanceof Error)) return false;
  // Node fetch exposes network codes on the error or its cause. Do not match messages.
  const hasNetworkCode = (value: unknown): boolean =>
    typeof value === "object" && value !== null && "code" in value &&
    typeof value.code === "string" && transientNetworkCodes.has(value.code);
  return error.name === "TimeoutError" || hasNetworkCode(error) || hasNetworkCode(error.cause);
}

async function requestWithRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error: unknown) {
      if (attempt >= 2 || !isTransientGeminiError(error)) throw error;
      // 500–750 ms, then 1000–1500 ms. No delay on the successful path.
      const delayMs = 500 * 2 ** attempt * (1 + Math.random() * 0.5);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Send one image inline; return only locally validated extraction evidence. */
export async function extractLabelFromImage(
  imageBytes: Uint8Array,
  mimeType: LabelImageMimeType,
): Promise<LabelExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    throw new LabelExtractionError("CONFIGURATION", "GEMINI_API_KEY is missing from the server configuration.");
  }
  if (!(imageBytes instanceof Uint8Array) || imageBytes.byteLength === 0 ||
      !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new LabelExtractionError("INVALID_IMAGE", "Provide nonempty image bytes and a supported image MIME type.");
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  let text: string | undefined;
  try {
    // Disable nested SDK retries so the total cannot exceed three attempts.
    const client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    const response = await requestWithRetry(() => client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ inlineData: {
        mimeType,
        data: Buffer.from(imageBytes).toString("base64"),
      } }] }],
      config: {
        systemInstruction: extractionPrompt,
        responseMimeType: "application/json",
        responseJsonSchema: extractionJsonSchema,
        // LOW is the lowest documented level for Gemini 3.8 Flash.
        ...(model === "gemini-3.8-flash" ? {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        } : {}),
      },
    }));
    text = response.text;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 429) {
      throw new LabelExtractionError("RATE_LIMIT", "Gemini label extraction is temporarily rate limited.");
    }
    // Never propagate SDK messages or causes: they may contain credentials or data.
    throw new LabelExtractionError("GEMINI_REQUEST", "Gemini label extraction request failed.");
  }
  if (!text?.trim()) {
    throw new LabelExtractionError("EMPTY_RESPONSE", "Gemini returned no extraction text.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LabelExtractionError("INVALID_JSON", "Gemini returned malformed extraction JSON.");
  }
  const result = labelExtractionSchema.safeParse(parsed);
  if (!result.success) {
    throw new LabelExtractionError("INVALID_EXTRACTION", "Gemini output does not match the label-extraction schema.");
  }
  return result.data;
}
