import { applicationSchema } from "../../../lib/application-schema";
import { evaluateVerification } from "../../../lib/evaluate-verification";
import { LabelExtractionError, type LabelImageMimeType } from "../../../lib/gemini";
import { extractLabelEvidence } from "../../../lib/extract-label-evidence";
import { labelExtractionSchema } from "../../../lib/label-extraction-schema";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_APPLICATION_JSON_LENGTH = 16_000;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data") {
    return errorResponse(400, "INVALID_REQUEST", "Send one image and application data using multipart/form-data.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "The uploaded request could not be read. Please try again.");
  }
  if (form.getAll("image").length > 1 || form.getAll("application").length > 1 ||
      Array.from(form.keys()).some((key) => key !== "image" && key !== "application")) {
    return errorResponse(400, "INVALID_REQUEST", "Send exactly one image and one application value.");
  }

  const applicationJson = form.get("application");
  if (applicationJson === null) {
    return errorResponse(400, "MISSING_APPLICATION", "Include the application data with the image.");
  }
  if (typeof applicationJson !== "string" || applicationJson.length > MAX_APPLICATION_JSON_LENGTH) {
    return errorResponse(400, "INVALID_APPLICATION", "Application data must be a JSON text value within the allowed size.");
  }
  let applicationInput: unknown;
  try {
    applicationInput = JSON.parse(applicationJson);
  } catch {
    return errorResponse(400, "INVALID_APPLICATION_JSON", "Application data must contain valid JSON.");
  }
  const application = applicationSchema.safeParse(applicationInput);
  if (!application.success) {
    return errorResponse(400, "INVALID_APPLICATION", "Check the application fields, their lengths, and the country of origin for imported products.");
  }

  const image = form.get("image");
  if (image === null) {
    return errorResponse(400, "MISSING_IMAGE", "Upload a label image.");
  }
  if (!(image instanceof File)) {
    return errorResponse(400, "INVALID_IMAGE", "The image must be an uploaded file.");
  }
  if (image.size === 0) {
    return errorResponse(400, "EMPTY_IMAGE", "The label image is empty. Please upload an image with content.");
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return errorResponse(413, "IMAGE_TOO_LARGE", "The processed label image must be 2 MB or smaller.");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
    return errorResponse(415, "UNSUPPORTED_IMAGE_TYPE", "Upload a JPEG, PNG, or WebP label image.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await image.arrayBuffer());
  } catch {
    return errorResponse(400, "INVALID_IMAGE", "The uploaded image could not be read. Please try again.");
  }

  try {
    const extracted = await extractLabelEvidence(bytes, image.type as LabelImageMimeType);
    // The helper already validates; keep the endpoint boundary validated too.
    const extraction = labelExtractionSchema.safeParse(extracted);
    if (!extraction.success) {
      return errorResponse(502, "INVALID_EXTRACTION", "The image-reading service returned incomplete or invalid data. Please try again.");
    }
    const verification = evaluateVerification(application.data, extraction.data);
    return Response.json({
      extraction: extraction.data,
      verification,
      processingTimeMs: Math.round(performance.now() - startedAt),
    });
  } catch (error: unknown) {
    if (error instanceof LabelExtractionError) {
      if (error.code === "CONFIGURATION") {
        return errorResponse(500, "SERVER_CONFIGURATION", "Label verification is not configured on the server. Please contact the administrator.");
      }
      if (error.code === "RATE_LIMIT") {
        return errorResponse(429, "RATE_LIMIT", "The image-reading service is receiving too many requests. Please try again later.");
      }
    }
    return errorResponse(502, "EXTRACTION_SERVICE_ERROR", "The image-reading service could not complete verification. Please try again later.");
  }
}
