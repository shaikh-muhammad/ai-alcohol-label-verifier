import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateVerification, type ApplicationData } from "./evaluate-verification";
import { REQUIRED_GOVERNMENT_WARNING } from "./validate-government-warning";

vi.mock("server-only", () => ({}));
vi.mock("./gemini", async (importOriginal) => ({
  ...await importOriginal<typeof import("./gemini")>(), extractLabelFromImage: vi.fn(),
}));
vi.mock("./openai", async (importOriginal) => ({
  ...await importOriginal<typeof import("./openai")>(), extractLabelWithOpenAI: vi.fn(),
}));
import { extractLabelFromImage, LabelExtractionError } from "./gemini";
import { extractLabelWithOpenAI, OpenAIExtractionError } from "./openai";
import { extractLabelEvidence, LabelEvidenceServiceError } from "./extract-label-evidence";

const image = new Uint8Array([1, 2, 3]);
const application: ApplicationData = {
  beverageType: "wine", brandName: "Example", classType: "Wine", alcoholContent: "12% ABV",
  netContents: "750 mL", producerName: "Example", producerAddress: "123 Main St", importedProduct: false,
};
const extraction = {
  brandName: "Example", classType: "Wine", alcoholContent: "12% ABV", netContents: "750 mL",
  producerName: "Example", producerAddress: "123 Main St", countryOfOrigin: null,
  governmentWarningText: REQUIRED_GOVERNMENT_WARNING,
  governmentWarningHeadingBold: "yes" as const, governmentWarningBodyBold: "no" as const,
  imageQuality: { readable: true, glare: "none" as const, perspectiveDistortion: "none" as const, criticalTextObscured: false, reason: null },
};
describe("provider orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(extractLabelWithOpenAI).mockResolvedValue(extraction);
    vi.mocked(extractLabelFromImage).mockResolvedValue({ ...extraction, brandName: "Fallback" });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("returns OpenAI success without calling Gemini even without a fallback key", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    expect(await extractLabelEvidence(image, "image/png")).toBe(extraction);
    expect(extractLabelFromImage).not.toHaveBeenCalled();
  });
  it.each(["OPENAI_REQUEST", "CONFIGURATION"] as const)("falls back after OpenAI %s handling fails", async (code) => {
    vi.mocked(extractLabelWithOpenAI).mockRejectedValue(new OpenAIExtractionError(code, "sanitized"));
    expect(await extractLabelEvidence(image, "image/png")).toEqual({ ...extraction, brandName: "Fallback" });
    expect(extractLabelFromImage).toHaveBeenCalledExactlyOnceWith(image, "image/png");
    expect(vi.mocked(extractLabelWithOpenAI).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(extractLabelFromImage).mock.invocationCallOrder[0]);
  });
  it.each(["fail", "needs_review"] as const)("never falls back for evidence producing %s", async (status) => {
    const evidence = { ...extraction, brandName: status === "fail" ? "Wrong" : null };
    vi.mocked(extractLabelWithOpenAI).mockResolvedValue(evidence);
    const result = await extractLabelEvidence(image, "image/png");
    expect(evaluateVerification(application, result).overall.status).toBe(status);
    expect(result).toBe(evidence);
    expect(extractLabelFromImage).not.toHaveBeenCalled();
  });
  it("sanitizes failure from both providers", async () => {
    vi.mocked(extractLabelWithOpenAI).mockRejectedValue(new OpenAIExtractionError("OPENAI_REQUEST", "private OpenAI details"));
    vi.mocked(extractLabelFromImage).mockRejectedValue(new LabelExtractionError("RATE_LIMIT", "private Gemini details"));
    const error = await extractLabelEvidence(image, "image/png").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(LabelEvidenceServiceError);
    expect(error).toMatchObject({
      message: "The image-reading service could not complete verification. Please try again later.",
    });
    expect(String(error)).not.toContain("private");
    expect(error).not.toHaveProperty("cause");
  });
  it("does not fall back for invalid input or unexpected programming errors", async () => {
    for (const error of [new OpenAIExtractionError("INVALID_IMAGE", "invalid"), new Error("unexpected")]) {
      vi.mocked(extractLabelWithOpenAI).mockRejectedValue(error);
      await expect(extractLabelEvidence(image, "image/png")).rejects.toBe(error);
    }
    expect(extractLabelFromImage).not.toHaveBeenCalled();
  });
});
