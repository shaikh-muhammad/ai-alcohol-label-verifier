import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabelExtraction } from "../../../lib/label-extraction-schema";
import { evaluateVerification, type ApplicationData } from "../../../lib/evaluate-verification";
import { REQUIRED_GOVERNMENT_WARNING } from "../../../lib/validate-government-warning";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/gemini")>();
  return { ...actual, extractLabelFromImage: vi.fn() };
});

import { extractLabelFromImage, LabelExtractionError } from "../../../lib/gemini";
import { POST, runtime } from "./route";

const mockedExtract = vi.mocked(extractLabelFromImage);
const maxImageBytes = 2 * 1024 * 1024;
const application: ApplicationData = {
  beverageType: "distilled-spirits", brandName: "STONE'S THROW",
  classType: "Straight Bourbon", alcoholContent: "45% ABV", netContents: "750 mL",
  producerName: "Example Distillery", producerAddress: "123 Main St., Louisville, KY",
  importedProduct: false,
};
const extraction: LabelExtraction = {
  brandName: application.brandName, classType: application.classType,
  alcoholContent: application.alcoholContent, netContents: application.netContents,
  producerName: application.producerName, producerAddress: application.producerAddress,
  countryOfOrigin: null, governmentWarningText: REQUIRED_GOVERNMENT_WARNING,
  governmentWarningHeadingBold: "yes", governmentWarningBodyBold: "no",
  imageQuality: { readable: true, glare: "none", perspectiveDistortion: "none", criticalTextObscured: false, reason: null },
};

function makeForm(): FormData {
  const form = new FormData();
  // Distinctive bytes make accidental return of image/base64 data detectable.
  form.set("image", new File(["private-image-bytes-123"], "label.png", { type: "image/png" }));
  form.set("application", JSON.stringify(application));
  return form;
}
function postForm(form: FormData) {
  return POST(new Request("http://localhost/api/verify", { method: "POST", body: form }));
}

describe("POST /api/verify", () => {
  beforeEach(() => {
    mockedExtract.mockReset().mockResolvedValue(extraction);
    vi.stubEnv("GEMINI_API_KEY", "fake-route-test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the Node runtime and returns validated extraction, real evaluator results, and elapsed time", async () => {
    expect(runtime).toBe("nodejs");
    const response = await postForm(makeForm());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["extraction", "processingTimeMs", "verification"]);
    expect(body.extraction).toEqual(extraction);
    expect(body.verification).toEqual(evaluateVerification(application, extraction));
    expect(body.processingTimeMs).toEqual(expect.any(Number));
    expect(body.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(mockedExtract).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode("private-image-bytes-123"), "image/png");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("private-image-bytes-123");
    expect(serialized).not.toContain(Buffer.from("private-image-bytes-123").toString("base64"));
    expect(serialized).not.toContain("fake-route-test-key");
  });

  it("uses the deterministic evaluator for a failing extracted value", async () => {
    const mismatch = { ...extraction, netContents: "1 L" };
    mockedExtract.mockResolvedValue(mismatch);
    const body = await (await postForm(makeForm())).json();
    expect(body.verification).toEqual(evaluateVerification(application, mismatch));
    expect(body.verification.overall.status).toBe("fail");
  });

  it.each([
    ["missing image", 400, "MISSING_IMAGE", (form: FormData) => form.delete("image")],
    ["empty image", 400, "EMPTY_IMAGE", (form: FormData) => form.set("image", new File([], "label.png", { type: "image/png" }))],
    ["unsupported MIME despite PNG filename", 415, "UNSUPPORTED_IMAGE_TYPE", (form: FormData) => form.set("image", new File(["data"], "label.png", { type: "image/gif" }))],
    ["oversize image", 413, "IMAGE_TOO_LARGE", (form: FormData) => form.set("image", new File([new Uint8Array(maxImageBytes + 1)], "label.png", { type: "image/png" }))],
    ["missing application", 400, "MISSING_APPLICATION", (form: FormData) => form.delete("application")],
    ["malformed JSON", 400, "INVALID_APPLICATION_JSON", (form: FormData) => form.set("application", "{bad json")],
    ["text instead of image file", 400, "INVALID_IMAGE", (form: FormData) => form.set("image", "label.png")],
    ["file instead of application JSON", 400, "INVALID_APPLICATION", (form: FormData) => form.set("application", new File(["{}"], "application.json"))],
    ["duplicate image", 400, "INVALID_REQUEST", (form: FormData) => form.append("image", new File(["data"], "second.png"))],
    ["duplicate application", 400, "INVALID_REQUEST", (form: FormData) => form.append("application", "{}")],
    ["extra form field", 400, "INVALID_REQUEST", (form: FormData) => form.set("extra", "value")],
    ["oversize application JSON", 400, "INVALID_APPLICATION", (form: FormData) => form.set("application", "x".repeat(16_001))],
  ] as const)("rejects %s", async (_description, status, code, change) => {
    const form = makeForm();
    change(form);
    const response = await postForm(form);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it.each([
    { beverageType: "cider" }, { brandName: 42 }, { importedProduct: "false" },
    { importedProduct: true }, { importedProduct: true, countryOfOrigin: null },
    { importedProduct: true, countryOfOrigin: " \t " },
    { producerAddress: "x".repeat(1001) }, { brandName: "   " },
    { brandName: "x".repeat(501) }, { extra: "unexpected" },
  ])("rejects invalid application input %j", async (changes) => {
    const form = makeForm();
    form.set("application", JSON.stringify({ ...application, ...changes }));
    const response = await postForm(form);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_APPLICATION" } });
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ""])("accepts non-imported products with country of origin %s", async (countryOfOrigin) => {
    const form = makeForm();
    form.set("application", JSON.stringify({ ...application, countryOfOrigin }));
    expect((await postForm(form)).status).toBe(200);
  });

  it("accepts imported products with a usable country", async () => {
    const form = makeForm();
    form.set("application", JSON.stringify({ ...application, importedProduct: true, countryOfOrigin: "Canada" }));
    mockedExtract.mockResolvedValue({ ...extraction, countryOfOrigin: "Canada" });
    const response = await postForm(form);
    expect(response.status).toBe(200);
    expect((await response.json()).verification.overall.status).toBe("pass");
  });

  it("accepts an image exactly at the size limit", async () => {
    const form = makeForm();
    form.set("image", new File([new Uint8Array(maxImageBytes)], "label.webp", { type: "image/webp" }));
    expect((await postForm(form)).status).toBe(200);
  });

  it("rejects non-multipart requests", async () => {
    const response = await POST(new Request("http://localhost/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(400);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it("rejects unreadable multipart bodies safely", async () => {
    const response = await POST(new Request("http://localhost/api/verify", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=missing" }, body: "invalid" }));
    expect(response.status).toBe(400);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it("revalidates extraction returned by the mocked helper", async () => {
    mockedExtract.mockResolvedValue({ ...extraction, brandName: 42 } as unknown as LabelExtraction);
    const response = await postForm(makeForm());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_EXTRACTION" } });
  });

  it.each([
    [new Error("fake-route-test-key internal exception"), 502, "EXTRACTION_SERVICE_ERROR"],
    [new LabelExtractionError("GEMINI_REQUEST", "fake-route-test-key"), 502, "EXTRACTION_SERVICE_ERROR"],
    [new LabelExtractionError("INVALID_JSON", "fake-route-test-key"), 502, "EXTRACTION_SERVICE_ERROR"],
    [new LabelExtractionError("CONFIGURATION", "fake-route-test-key"), 500, "SERVER_CONFIGURATION"],
    [new LabelExtractionError("RATE_LIMIT", "fake-route-test-key"), 429, "RATE_LIMIT"],
  ] as const)("returns a safe response for helper failure %s", async (error, status, code) => {
    mockedExtract.mockRejectedValue(error);
    const response = await postForm(makeForm());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain("fake-route-test-key");
    expect(JSON.stringify(body)).not.toContain("internal exception");
  });
});
