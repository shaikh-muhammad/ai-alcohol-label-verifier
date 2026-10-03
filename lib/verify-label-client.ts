import { z } from "zod";
import { applicationSchema } from "./application-schema";
import { labelExtractionSchema } from "./label-extraction-schema";
import type { VerificationResult } from "./evaluate-verification";

const checkSchema = z.object({
  status: z.enum(["pass", "needs_review", "fail"]),
  reason: z.string(),
});
// Validate the response shape only; all verification decisions come from the server.
const verificationSchema: z.ZodType<VerificationResult> = z.object({
  overall: checkSchema,
  fields: z.array(checkSchema.extend({
    field: labelExtractionSchema.omit({ governmentWarningHeadingBold: true, governmentWarningBodyBold: true, imageQuality: true }).keyof(),
    fieldName: z.string(),
    applicationValue: z.string().optional(),
    extractedValue: z.string().nullable(),
  })),
  imageQuality: z.object({ status: z.enum(["pass", "needs_review"]), reason: z.string() }),
});
const responseSchema = z.object({
  extraction: labelExtractionSchema,
  verification: verificationSchema,
  processingTimeMs: z.number().finite().nonnegative(),
});
export type VerifyLabelResponse = z.infer<typeof responseSchema>;

export class VerificationUiError extends Error {}

export function createVerificationRequest(form: FormData, processedImage: Blob | null): FormData {
  const application = applicationSchema.safeParse({
    beverageType: form.get("beverageType"),
    brandName: form.get("brandName"),
    classType: form.get("classType"),
    alcoholContent: form.get("alcoholContent"),
    netContents: form.get("netContents"),
    producerName: form.get("producerName"),
    producerAddress: form.get("producerAddress"),
    importedProduct: form.get("importedProduct") === "on",
    countryOfOrigin: form.get("countryOfOrigin"),
  });
  if (!application.success) {
    throw new VerificationUiError("Please complete all required application fields, including country of origin for an imported product, and keep values within the allowed lengths.");
  }
  if (!processedImage || processedImage.size === 0) {
    throw new VerificationUiError("Please choose a label image and wait for its preparation to finish.");
  }
  const body = new FormData();
  body.set("image", processedImage, "label.jpg");
  body.set("application", JSON.stringify({ ...application.data, countryOfOrigin: application.data.countryOfOrigin ?? "" }));
  return body;
}

const genericError = "We couldn’t complete this verification. Please try again.";
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export function verificationErrorMessage(status: number, body: unknown): string {
  if (!errorSchema.safeParse(body).success) return genericError;
  // Fixed friendly messages keep internal exception text out of the page.
  switch (status) {
    case 400: return "Please check the application fields and prepared label image, then try again.";
    case 413: return "The prepared image is still too large. Please choose a smaller or clearer image.";
    case 415: return "Please upload a JPEG, PNG, or WebP image.";
    case 429: return "The AI service is temporarily busy. Please wait a moment and try again.";
    case 500: return "The verification service is not configured correctly.";
    case 502:
    case 503: return "The AI service could not complete this verification. Please try again.";
    default: return genericError;
  }
}

export async function requestLabelVerification(body: FormData): Promise<VerifyLabelResponse> {
  let response: Response;
  let data: unknown;
  try {
    response = await fetch("/api/verify", { method: "POST", body });
    data = await response.json();
  } catch {
    throw new VerificationUiError(genericError);
  }
  if (!response.ok) throw new VerificationUiError(verificationErrorMessage(response.status, data));
  const result = responseSchema.safeParse(data);
  if (!result.success) throw new VerificationUiError(genericError);
  return result.data;
}
