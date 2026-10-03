import { afterEach, describe, expect, it, vi } from "vitest";
import { createVerificationRequest, requestLabelVerification, verificationErrorMessage } from "./verify-label-client";
import { evaluateVerification, type ApplicationData } from "./evaluate-verification";
import type { LabelExtraction } from "./label-extraction-schema";
import { REQUIRED_GOVERNMENT_WARNING } from "./validate-government-warning";

const application: ApplicationData = {
  beverageType: "distilled-spirits", brandName: "STONE'S THROW",
  classType: "Straight Bourbon", alcoholContent: "90 PROOF", netContents: "0.75 L",
  producerName: "Example Distillery", producerAddress: "123 Main St., Louisville, KY",
  importedProduct: false, countryOfOrigin: "",
};
const extraction: LabelExtraction = {
  brandName: application.brandName, classType: application.classType,
  alcoholContent: application.alcoholContent, netContents: application.netContents,
  producerName: application.producerName, producerAddress: application.producerAddress,
  countryOfOrigin: null, governmentWarningText: REQUIRED_GOVERNMENT_WARNING,
  governmentWarningHeadingBold: "yes", governmentWarningBodyBold: "no",
  imageQuality: { readable: true, glare: "none", perspectiveDistortion: "none", criticalTextObscured: false, reason: null },
};
const successfulResponse = {
  extraction, verification: evaluateVerification(application, extraction), processingTimeMs: 3400,
};
const processed = new Blob(["processed-image"], { type: "image/jpeg" });
function formValues() {
  const form = new FormData();
  for (const [key, value] of Object.entries(application)) {
    if (typeof value === "string") form.set(key, value);
  }
  return form;
}
afterEach(() => vi.unstubAllGlobals());

describe("createVerificationRequest", () => {
  it("sends the processed image instead of an original image in the form", async () => {
    const form = formValues();
    form.set("image", new File(["oversized-original"], "original.png", { type: "image/png" }));
    const body = createVerificationRequest(form, processed);
    const image = body.get("image") as File;
    expect(image.type).toBe("image/jpeg");
    expect(image.size).toBe(processed.size);
    expect(await image.text()).toBe("processed-image");
    expect(JSON.parse(body.get("application") as string)).toEqual(application);
    expect(Array.from(body.keys())).toEqual(["image", "application"]);
  });

  it("sends checkbox state and imported country without changing capitalization or units", () => {
    const form = formValues();
    form.set("importedProduct", "on");
    form.set("countryOfOrigin", "CANADA");
    const body = createVerificationRequest(form, processed);
    expect(JSON.parse(body.get("application") as string)).toEqual({ ...application, importedProduct: true, countryOfOrigin: "CANADA" });
  });

  it("accepts an absent non-imported country", () => {
    const form = formValues();
    form.delete("countryOfOrigin");
    expect(JSON.parse(createVerificationRequest(form, processed).get("application") as string).countryOfOrigin).toBe("");
  });

  it.each([null, new Blob([])])("requires a nonempty processed image %s", (image) => {
    expect(() => createVerificationRequest(formValues(), image)).toThrow("Please choose a label image");
  });

  it("rejects blank required fields", () => {
    const form = formValues();
    form.set("brandName", "  ");
    expect(() => createVerificationRequest(form, processed)).toThrow("Please complete all required application fields");
  });

  it("requires a country for imports", () => {
    const form = formValues();
    form.set("importedProduct", "on");
    expect(() => createVerificationRequest(form, processed)).toThrow("country of origin");
  });
});

describe("verificationErrorMessage", () => {
  it.each([
    [400, "Please check the application fields"], [413, "The prepared image is still too large"],
    [415, "Please upload a JPEG, PNG, or WebP image"], [429, "The AI service is temporarily busy"],
    [500, "The verification service is not configured correctly"],
    [502, "The AI service could not complete this verification"], [503, "The AI service could not complete this verification"],
  ])("maps HTTP %s to a friendly message without showing internal text", (status, message) => {
    const displayed = verificationErrorMessage(status, { error: { code: "ERROR", message: "private internal stack trace" } });
    expect(displayed).toContain(message);
    expect(displayed).not.toContain("private internal stack trace");
  });

  it.each([null, {}, "bad response", { error: { message: "internal" } }])("handles invalid error response %j safely", (body) => {
    expect(verificationErrorMessage(500, body)).toBe("We couldn’t complete this verification. Please try again.");
  });
});

describe("requestLabelVerification", () => {
  it("posts only to our own endpoint and returns the server decisions unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(successfulResponse));
    vi.stubGlobal("fetch", fetchMock);
    const body = createVerificationRequest(formValues(), processed);
    expect(await requestLabelVerification(body)).toEqual(successfulResponse);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/verify", { method: "POST", body });
  });

  it("converts API errors to friendly UI errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "RATE_LIMIT", message: "internal" } }, { status: 429 })));
    await expect(requestLabelVerification(new FormData())).rejects.toThrow("The AI service is temporarily busy");
  });

  it("handles network failure without showing exception messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("internal network details")));
    await expect(requestLabelVerification(new FormData())).rejects.toThrow("We couldn’t complete this verification. Please try again.");
  });

  it("handles responses that are not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>internal error</html>", { status: 503 })));
    await expect(requestLabelVerification(new FormData())).rejects.toThrow("We couldn’t complete this verification. Please try again.");
  });

  it.each([
    {}, { ...successfulResponse, processingTimeMs: -1 },
    { ...successfulResponse, verification: { ...successfulResponse.verification, overall: { status: "unknown", reason: "bad" } } },
  ])("rejects malformed success data %j", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
    await expect(requestLabelVerification(new FormData())).rejects.toThrow("We couldn’t complete this verification. Please try again.");
  });
});
