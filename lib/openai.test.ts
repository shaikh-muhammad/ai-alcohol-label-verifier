import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { labelExtractionSchema } from "./label-extraction-schema";
import { extractionPrompt } from "./label-extraction-prompt";
const { parse, createClient } = vi.hoisted(() => ({ parse: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { createClient(options); }
  responses = { parse };
} }));
import { extractLabelWithOpenAI } from "./openai";
const image = new Uint8Array([1, 2, 3]);
const extraction = {
  brandName: "STONE'S THROW", classType: null, alcoholContent: "90 PROOF", netContents: "0.75 L",
  producerName: null, producerAddress: null, countryOfOrigin: null, governmentWarningText: null,
  governmentWarningHeadingBold: "uncertain", governmentWarningBodyBold: "uncertain",
  imageQuality: { readable: false, glare: "high", perspectiveDistortion: "none", criticalTextObscured: true, reason: null },
};
describe("OpenAI extraction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "fake-test-key");
    vi.stubEnv("OPENAI_MODEL", undefined);
    parse.mockResolvedValue({ status: "completed", output_parsed: extraction });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["image/jpeg", "image/png", "image/webp"] as const)("uses Responses structured outputs and a %s data URL", async (mimeType) => {
    expect(await extractLabelWithOpenAI(image, mimeType)).toEqual(labelExtractionSchema.parse(extraction));
    expect(createClient).toHaveBeenCalledExactlyOnceWith({ apiKey: "fake-test-key", timeout: 60_000, maxRetries: 2 });
    const request = parse.mock.calls[0][0];
    expect(request).toMatchObject({ model: "gpt-5.4-mini", store: false, instructions: extractionPrompt,
      input: [{ role: "user", content: [{ type: "input_image", image_url: `data:${mimeType};base64,AQID`, detail: "auto" }] }],
    });
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "label_extraction", strict: true,
      schema: zodTextFormat(labelExtractionSchema, "label_extraction").schema });
    expect(request.text.format.$parseRaw(JSON.stringify(extraction))).toEqual(extraction);
    expect(() => request.text.format.$parseRaw(JSON.stringify({ ...extraction, complianceStatus: "Pass" }))).toThrow();
  });
  it("honors the configured model", async () => {
    vi.stubEnv("OPENAI_MODEL", "configured-model");
    await extractLabelWithOpenAI(image, "image/png");
    expect(parse.mock.calls[0][0].model).toBe("configured-model");
  });
  it.each([null, {}, { ...extraction, brandName: 42 }, { ...extraction, complianceStatus: "Pass" }])("rejects unusable output using the existing strict schema", async (output_parsed) => {
    parse.mockResolvedValue({ status: "completed", output_parsed });
    await expect(extractLabelWithOpenAI(image, "image/png")).rejects.toThrow("The image-reading service could not extract label evidence.");
  });
  it.each(["incomplete", "failed"])("rejects %s responses", async (status) => {
    parse.mockResolvedValue({ status, output_parsed: extraction });
    await expect(extractLabelWithOpenAI(image, "image/png")).rejects.toThrow();
  });
  it("sanitizes SDK and client-construction failures", async () => {
    parse.mockRejectedValue(new Error("fake-test-key private billing details"));
    const error = await extractLabelWithOpenAI(image, "image/png").catch((error: unknown) => error);
    expect(String(error)).not.toContain("fake-test-key");
    expect(error).not.toHaveProperty("cause");
    createClient.mockImplementationOnce(() => { throw new Error("fake-test-key"); });
    await expect(extractLabelWithOpenAI(image, "image/png")).rejects.toThrow("The image-reading service could not extract label evidence.");
  });
  it("fails safely without a key before client creation", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    await expect(extractLabelWithOpenAI(image, "image/png")).rejects.toThrow("The image-reading service is unavailable.");
    expect(createClient).not.toHaveBeenCalled();
  });
  it("rejects empty images before making a request", async () => {
    await expect(extractLabelWithOpenAI(new Uint8Array(), "image/png")).rejects.toThrow();
    expect(parse).not.toHaveBeenCalled();
  });
});
