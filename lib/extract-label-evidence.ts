import "server-only";

import { extractLabelFromImage, LabelExtractionError, type LabelImageMimeType } from "./gemini";
import type { LabelExtraction } from "./label-extraction-schema";
import { extractLabelWithOpenAI } from "./openai";

export class LabelEvidenceServiceError extends Error {
  constructor() {
    super("The image-reading service could not complete verification. Please try again later.");
    this.name = "LabelEvidenceServiceError";
  }
}

const fallbackCodes = new Set<LabelExtractionError["code"]>([
  "CONFIGURATION", "RATE_LIMIT", "GEMINI_REQUEST", "EMPTY_RESPONSE", "INVALID_JSON", "INVALID_EXTRACTION",
]);

/** Gemini first; provider failures only. Compliance evaluation happens later. */
export async function extractLabelEvidence(
  imageBytes: Uint8Array,
  mimeType: LabelImageMimeType,
): Promise<LabelExtraction> {
  try {
    const extraction = await extractLabelFromImage(imageBytes, mimeType);
    return extraction;
  } catch (error: unknown) {
    if (!(error instanceof LabelExtractionError) || !fallbackCodes.has(error.code)) throw error;
  }
  try {
    const extraction = await extractLabelWithOpenAI(imageBytes, mimeType);
    return extraction;
  } catch {
    throw new LabelEvidenceServiceError();
  }
}
