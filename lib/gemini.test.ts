import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { labelExtractionSchema, type LabelExtraction } from "./label-extraction-schema";

const { generateContent, createClient } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  createClient: vi.fn(),
}));

// Next.js enforces this marker during builds; tests run in Node outside Next.js.
vi.mock("server-only", () => ({}));
vi.mock("@google/genai", () => ({
  ApiError: class extends Error {
    status: number;
    constructor(options: { message: string; status: number }) {
      super(options.message);
      this.status = options.status;
    }
  },
  GoogleGenAI: class {
    constructor(options: unknown) { createClient(options); }
    models = { generateContent };
  },
  ThinkingLevel: { LOW: "low" },
}));

import { extractLabelFromImage, LabelExtractionError, type LabelImageMimeType } from "./gemini";
import { extractLabelEvidence, LabelEvidenceServiceError } from "./extract-label-evidence";
import { ApiError } from "@google/genai";
import { REQUIRED_GOVERNMENT_WARNING, validateGovernmentWarning } from "./validate-government-warning";
import { evaluateGovernmentWarning } from "./evaluate-verification";

const testKey = "fake-test-key-never-a-real-credential";
const image = new Uint8Array([1, 2, 3]);
const extraction: LabelExtraction = {
  brandName: "STONE'S THROW",
  classType: null,
  alcoholContent: "90 PROOF",
  netContents: "0.75 L",
  producerName: null,
  producerAddress: null,
  countryOfOrigin: null,
  governmentWarningText: null,
  governmentWarningHeadingBold: "uncertain",
  governmentWarningBodyBold: "uncertain",
  imageQuality: {
    readable: false, glare: "high", perspectiveDistortion: "none",
    criticalTextObscured: true,
    reason: "Glare obscures part of the government warning.",
  },
};

describe("extractLabelFromImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", testKey);
    vi.stubEnv("GEMINI_MODEL", undefined);
    generateContent.mockReset().mockResolvedValue({ text: JSON.stringify(extraction) });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("throws a configuration error before creating a client if the key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({
      name: "LabelExtractionError", code: "CONFIGURATION",
      message: "GEMINI_API_KEY is missing from the server configuration.",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it.each(["image/jpeg", "image/png", "image/webp"] as const)("sends %s inline and validates the response", async (mimeType) => {
    expect(await extractLabelFromImage(image, mimeType)).toEqual(extraction);
    expect(createClient).toHaveBeenCalledWith({ apiKey: testKey, httpOptions: { retryOptions: { attempts: 1 } } });
    expect(generateContent.mock.calls[0][0].config.systemInstruction).toContain("governmentWarningBodyBold");
    expect(generateContent).toHaveBeenCalledExactlyOnceWith({
      model: "gemini-3.8-flash",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: "AQID" } }] }],
      config: {
        systemInstruction: expect.stringContaining("Do not determine Pass, Fail, Needs Review"),
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(labelExtractionSchema),
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
  });

  it("uses GEMINI_MODEL and avoids assuming custom model thinking support", async () => {
    vi.stubEnv("GEMINI_MODEL", "configured-model");
    await extractLabelFromImage(image, "image/png");
    expect(generateContent.mock.calls[0][0].model).toBe("configured-model");
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty("thinkingConfig");
  });

  it("explicitly requests the entire visible warning including its heading", async () => {
    await extractLabelFromImage(image, "image/png");
    const prompt = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(prompt).toContain("governmentWarningText must contain the ENTIRE visible warning statement");
    expect(prompt).toContain('If the visible heading is "GOVERNMENT WARNING:", include it at the beginning of governmentWarningText');
    expect(prompt).toContain("Preserve the heading exactly as seen, including capitalization, spaces, punctuation, and colon");
    expect(prompt).toContain("Do not strip or omit the heading because governmentWarningHeadingBold reports separate visual evidence");
    expect(prompt).toContain("If the heading cannot be read confidently, do not invent or prepend one");
  });

  it("preserves a full warning that passes deterministic validation", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...extraction, governmentWarningText: REQUIRED_GOVERNMENT_WARNING }) });
    const result = await extractLabelFromImage(image, "image/png");
    expect(result.governmentWarningText).toBe(REQUIRED_GOVERNMENT_WARNING);
    expect(validateGovernmentWarning(result.governmentWarningText).status).toBe("Pass");
  });

  it("does not insert a heading into body-only output, which still fails deterministic evaluation", async () => {
    const bodyOnly = REQUIRED_GOVERNMENT_WARNING.replace("GOVERNMENT WARNING: ", "");
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...extraction, governmentWarningText: bodyOnly, governmentWarningHeadingBold: "yes", governmentWarningBodyBold: "no" }) });
    const result = await extractLabelFromImage(image, "image/png");
    expect(result.governmentWarningText).toBe(bodyOnly);
    expect(validateGovernmentWarning(result.governmentWarningText).status).toBe("Fail");
    expect(evaluateGovernmentWarning(result).status).toBe("fail");
  });

  it.each([undefined, "", "   "])("rejects empty response text %s", async (text) => {
    generateContent.mockResolvedValue({ text });
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("rejects malformed JSON without exposing response text", async () => {
    generateContent.mockResolvedValue({ text: `{${testKey}` });
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({
      code: "INVALID_JSON", message: "Gemini returned malformed extraction JSON.",
    });
  });

  it.each([{}, { ...extraction, brandName: 42 }, { ...extraction, complianceStatus: "Pass" }])("rejects structurally invalid output", async (output) => {
    generateContent.mockResolvedValue({ text: JSON.stringify(output) });
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({ code: "INVALID_EXTRACTION" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("replaces SDK errors containing secrets with a safe error without a cause", async () => {
    generateContent.mockRejectedValue(new Error(`Request failed with key=${testKey}`));
    const error = await extractLabelFromImage(image, "image/png").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(LabelExtractionError);
    expect(error).toMatchObject({ code: "GEMINI_REQUEST", message: "Gemini label extraction request failed." });
    expect(String(error)).not.toContain(testKey);
    expect(JSON.stringify(error)).not.toContain(testKey);
    expect(error).not.toHaveProperty("cause");
  });

  it("sanitizes client construction errors too", async () => {
    createClient.mockImplementationOnce(() => { throw new Error(testKey); });
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({
      code: "GEMINI_REQUEST", message: "Gemini label extraction request failed.",
    });
  });

  it("maps HTTP 429 to RATE_LIMIT after one attempt without retry delays or exposing its message", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(new ApiError({ message: testKey, status: 429 }));
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({
      code: "RATE_LIMIT", message: "Gemini label extraction is temporarily rate limited.",
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not schedule a delay for first-attempt success", async () => {
    vi.useFakeTimers();
    expect(await extractLabelFromImage(image, "image/png")).toEqual(extraction);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 2])("succeeds after %i transient failures with bounded exponential backoff", async (failures) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    for (let i = 0; i < failures; i++) {
      generateContent.mockRejectedValueOnce(new ApiError({ status: 503, message: testKey }));
    }
    const pending = extractLabelFromImage(image, "image/png");
    await vi.advanceTimersByTimeAsync(624);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
    if (failures === 2) {
      await vi.advanceTimersByTimeAsync(1249);
      expect(generateContent).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(await pending).toEqual(extraction);
    expect(generateContent).toHaveBeenCalledTimes(failures + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([408, 500, 502, 503, 504])("bounds exhausted HTTP %i failures and sanitizes the error", async (status) => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(new ApiError({ status, message: testKey }));
    const pending = extractLabelFromImage(image, "image/png");
    const assertion = expect(pending).rejects.toMatchObject({ code: "GEMINI_REQUEST" });
    await vi.runAllTimersAsync();
    await assertion;
    const error = await pending.catch((error: unknown) => error);
    expect(String(error)).not.toContain(testKey);
    expect(JSON.stringify(error)).not.toContain(testKey);
    expect(error).not.toHaveProperty("cause");
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 401, 403, 404, 422])("does not retry non-transient HTTP %i failures", async (status) => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(new ApiError({ status, message: testKey }));
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({ code: "GEMINI_REQUEST" });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    Object.assign(new Error(testKey), { code: "ECONNRESET" }),
    new TypeError(testKey, { cause: { code: "EAI_AGAIN" } }),
    Object.assign(new Error(testKey), { name: "TimeoutError" }),
  ])("retries recognized transient network and timeout errors", async (error) => {
    vi.useFakeTimers();
    generateContent.mockRejectedValueOnce(error);
    const pending = extractLabelFromImage(image, "image/png");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(extraction);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Error("503 timeout too many requests"),
    Object.assign(new Error(testKey), { code: "ENOTFOUND" }),
    Object.assign(new Error(testKey), { name: "AbortError" }),
    Object.assign(new Error(testKey), { code: "CERT_HAS_EXPIRED" }),
  ])("does not retry unknown errors, cancellation, or permanent network failures", async (error) => {
    generateContent.mockRejectedValue(error);
    await expect(extractLabelFromImage(image, "image/png")).rejects.toMatchObject({ code: "GEMINI_REQUEST" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects empty images and unsupported MIME types without a request", async () => {
    await expect(extractLabelFromImage(new Uint8Array(), "image/png")).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(extractLabelFromImage(image, "image/gif" as LabelImageMimeType)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(generateContent).not.toHaveBeenCalled();
  });
});


describe("fallback integration after Gemini retry handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", testKey);
    vi.stubEnv("OPENAI_API_KEY", undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it("immediately falls back after one Gemini HTTP 429 attempt without advancing timers", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(new ApiError({ status: 429, message: testKey }));
    const fallback = vi.spyOn(await import("./openai"), "extractLabelWithOpenAI").mockResolvedValue(extraction);
    expect(await extractLabelEvidence(image, "image/png")).toEqual(extraction);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledExactlyOnceWith(image, "image/png");
    expect(generateContent.mock.invocationCallOrder[0]).toBeLessThan(fallback.mock.invocationCallOrder[0]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([408, 500, 502, 503, 504])("falls back only after all three HTTP %i attempts", async (status) => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(new ApiError({ status, message: testKey }));
    const fallback = vi.spyOn(await import("./openai"), "extractLabelWithOpenAI").mockResolvedValue(extraction);
    const pending = extractLabelEvidence(image, "image/png");
    expect(fallback).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(extraction);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("falls back after exhausted recognized network failures", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(Object.assign(new Error(testKey), { code: "ECONNRESET" }));
    const fallback = vi.spyOn(await import("./openai"), "extractLabelWithOpenAI").mockResolvedValue(extraction);
    const pending = extractLabelEvidence(image, "image/png");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(extraction);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("returns a neutral service error when Gemini fails and the actual fallback key is missing", async () => {
    generateContent.mockRejectedValue(new Error(testKey));
    await expect(extractLabelEvidence(image, "image/png")).rejects.toBeInstanceOf(LabelEvidenceServiceError);
  });
  it("does not require a fallback key on Gemini success", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(extraction) });
    const fallback = vi.spyOn(await import("./openai"), "extractLabelWithOpenAI");
    expect(await extractLabelEvidence(image, "image/png")).toEqual(extraction);
    expect(fallback).not.toHaveBeenCalled();
  });
});
