import { describe, expect, it } from "vitest";
import {
  evaluateVerification,
  evaluateGovernmentWarning,
  evaluateImageQuality,
  type ApplicationData,
  type ExtractedLabelData,
} from "./evaluate-verification";
import { REQUIRED_GOVERNMENT_WARNING } from "./validate-government-warning";

const application: ApplicationData = {
  beverageType: "distilled-spirits",
  brandName: "Old Tom",
  classType: "Straight Bourbon",
  alcoholContent: "45% ABV",
  netContents: "750 mL",
  producerName: "Old Tom Distillery",
  producerAddress: "123 Example Street, Louisville, KY",
  importedProduct: false,
};

const label: ExtractedLabelData = {
  brandName: application.brandName,
  classType: application.classType,
  alcoholContent: application.alcoholContent,
  netContents: application.netContents,
  producerName: application.producerName,
  producerAddress: application.producerAddress,
  governmentWarningText: REQUIRED_GOVERNMENT_WARNING,
  governmentWarningHeadingBold: "yes",
  governmentWarningBodyBold: "no",
  imageQuality: {
    readable: true, glare: "none", perspectiveDistortion: "none",
    criticalTextObscured: false, reason: null,
  },
};

describe("evaluateVerification", () => {
  it("passes when every applicable field matches", () => {
    const result = evaluateVerification(application, label);
    expect(result.overall.status).toBe("pass");
    expect(result.fields).toHaveLength(7);
    expect(result.fields.every((field) => field.status === "pass")).toBe(true);
    expect(result.overall.reason.length).toBeGreaterThan(0);
  });

  it("needs review for a case-only brand difference", () => {
    const result = evaluateVerification(application, { ...label, brandName: "OLD TOM" });
    expect(result.fields.find((field) => field.field === "brandName")?.status).toBe("needs_review");
    expect(result.overall.status).toBe("needs_review");
  });

  it.each([
    ["alcoholContent", "40% ABV"],
    ["netContents", "1 L"],
  ] as const)("fails for incorrect %s", (field, value) => {
    const result = evaluateVerification(application, { ...label, [field]: value });
    expect(result.fields.find((entry) => entry.field === field)?.status).toBe("fail");
    expect(result.overall.status).toBe("fail");
  });

  it.each([
    "brandName", "classType", "alcoholContent", "netContents",
    "producerName", "producerAddress",
  ] as const)("needs review for missing or blank extracted %s", (field) => {
    for (const value of [undefined, null, "", " \t\n "]) {
      const result = evaluateVerification(application, { ...label, [field]: value });
      const fieldResult = result.fields.find((entry) => entry.field === field);
      expect(fieldResult?.status).toBe("needs_review");
      expect(fieldResult?.reason).toContain("Could not confidently read");
      expect(result.overall.status).toBe("needs_review");
    }
  });

  it.each([undefined, null, "", " \t\n "])("fails for a missing government warning: %s", (value) => {
    const result = evaluateVerification(application, { ...label, governmentWarningText: value });
    expect(result.fields.find((field) => field.field === "governmentWarningText")).toMatchObject({
      status: "fail", reason: "Government warning is missing.",
    });
    expect(result.overall.status).toBe("fail");
  });

  it("passes a matching country for an imported product", () => {
    const result = evaluateVerification(
      { ...application, importedProduct: true, countryOfOrigin: "Canada" },
      { ...label, countryOfOrigin: "Canada" },
    );
    expect(result.fields).toHaveLength(8);
    expect(result.fields.find((field) => field.field === "countryOfOrigin")?.status).toBe("pass");
    expect(result.overall.status).toBe("pass");
  });

  it("fails a wrong country for an imported product", () => {
    const result = evaluateVerification(
      { ...application, importedProduct: true, countryOfOrigin: "Canada" },
      { ...label, countryOfOrigin: "France" },
    );
    expect(result.fields.find((field) => field.field === "countryOfOrigin")?.status).toBe("fail");
    expect(result.overall.status).toBe("fail");
  });

  it("needs review for a normalized country match", () => {
    const result = evaluateVerification(
      { ...application, importedProduct: true, countryOfOrigin: "Canada" },
      { ...label, countryOfOrigin: "CANADA" },
    );
    expect(result.fields.find((field) => field.field === "countryOfOrigin")?.status).toBe("needs_review");
    expect(result.overall.status).toBe("needs_review");
  });

  it.each([undefined, null, "", " \n "])("needs review for an unreadable imported country: %s", (value) => {
    const result = evaluateVerification(
      { ...application, importedProduct: true, countryOfOrigin: "Canada" },
      { ...label, countryOfOrigin: value },
    );
    expect(result.fields.find((field) => field.field === "countryOfOrigin")?.status).toBe("needs_review");
    expect(result.overall.status).toBe("needs_review");
  });

  it("needs review when the imported application country is absent", () => {
    const result = evaluateVerification(
      { ...application, importedProduct: true }, { ...label, countryOfOrigin: "Canada" },
    );
    expect(result.overall.status).toBe("needs_review");
  });

  it.each([undefined, "", "France"])("ignores country for non-imported products: %s", (value) => {
    const result = evaluateVerification(
      { ...application, countryOfOrigin: "" }, { ...label, countryOfOrigin: value },
    );
    expect(result.fields.some((field) => field.field === "countryOfOrigin")).toBe(false);
    expect(result.overall.status).toBe("pass");
  });

  it("prioritizes Fail over Needs Review", () => {
    const result = evaluateVerification(application, { ...label, brandName: null, netContents: "1 L" });
    expect(result.fields.find((field) => field.field === "brandName")?.status).toBe("needs_review");
    expect(result.fields.find((field) => field.field === "netContents")?.status).toBe("fail");
    expect(result.overall.status).toBe("fail");
  });

  it("passes equivalent volume units", () => {
    const result = evaluateVerification(application, { ...label, netContents: "75 cL" });
    expect(result.fields.find((field) => field.field === "netContents")?.status).toBe("pass");
    expect(result.overall.status).toBe("pass");
  });

  it("passes equivalent ABV and proof for distilled spirits", () => {
    const result = evaluateVerification(application, { ...label, alcoholContent: "90 proof" });
    expect(result.fields.find((field) => field.field === "alcoholContent")?.status).toBe("pass");
    expect(result.overall.status).toBe("pass");
  });

  it.each(["wine", "beer-malt-beverage"] as const)("needs review for proof in %s", (beverageType) => {
    const result = evaluateVerification({ ...application, beverageType }, { ...label, alcoholContent: "90 proof" });
    expect(result.fields.find((field) => field.field === "alcoholContent")?.status).toBe("needs_review");
    expect(result.overall.status).toBe("needs_review");
  });

  it("includes display names, reasons, and original values for the future UI", () => {
    const result = evaluateVerification(application, { ...label, netContents: "75 cL" });
    expect(result.fields.find((field) => field.field === "netContents")).toMatchObject({
      fieldName: "Net Contents", applicationValue: "750 mL", extractedValue: "75 cL",
    });
    expect(result.fields.every((field) => field.fieldName && field.reason)).toBe(true);
  });

  it.each(["governmentWarningHeadingBold", "governmentWarningBodyBold"] as const)("needs review for uncertain %s", (field) => {
    expect(evaluateVerification(application, { ...label, [field]: "uncertain" }).overall.status).toBe("needs_review");
  });

  it("fails when the warning heading definitely is not bold", () => {
    expect(evaluateVerification(application, { ...label, governmentWarningHeadingBold: "no" }).overall.status).toBe("fail");
  });

  it("needs review for an unreadable image even when all fields pass", () => {
    const result = evaluateVerification(application, { ...label, imageQuality: { ...label.imageQuality!, readable: false } });
    expect(result.fields.every((field) => field.status === "pass")).toBe(true);
    expect(result.imageQuality.status).toBe("needs_review");
    expect(result.overall.status).toBe("needs_review");
  });

  it("preserves regulatory failure when image quality needs review", () => {
    const result = evaluateVerification(application, { ...label, netContents: "1 L", imageQuality: { ...label.imageQuality!, readable: false } });
    expect(result.imageQuality.status).toBe("needs_review");
    expect(result.overall.status).toBe("fail");
  });

  it("does not infer unreadable values from poor image quality", () => {
    const result = evaluateVerification(application, { ...label, brandName: null, imageQuality: { ...label.imageQuality!, readable: false } });
    expect(result.fields.find((field) => field.field === "brandName")).toMatchObject({ extractedValue: null, status: "needs_review" });
  });
});

describe("evaluateGovernmentWarning", () => {
  it("passes exact text with a bold heading and non-bold body", () => {
    expect(evaluateGovernmentWarning(label).status).toBe("pass");
  });

  it("fails a non-bold heading", () => {
    expect(evaluateGovernmentWarning({ ...label, governmentWarningHeadingBold: "no" })).toEqual({
      status: "fail", reason: "The 'GOVERNMENT WARNING:' heading does not appear bold.",
    });
  });

  it("fails a bold warning body", () => {
    expect(evaluateGovernmentWarning({ ...label, governmentWarningBodyBold: "yes" })).toEqual({
      status: "fail", reason: "The warning text after the heading should not appear bold.",
    });
  });

  it.each(["governmentWarningHeadingBold", "governmentWarningBodyBold"] as const)("needs review for uncertain or absent %s", (field) => {
    for (const value of ["uncertain", undefined] as const) {
      expect(evaluateGovernmentWarning({ ...label, [field]: value })).toMatchObject({
        status: "needs_review", reason: expect.stringContaining("could not be confirmed confidently"),
      });
    }
  });

  it("prioritizes definite visual failure over uncertainty", () => {
    expect(evaluateGovernmentWarning({ ...label, governmentWarningHeadingBold: "no", governmentWarningBodyBold: "uncertain" }).status).toBe("fail");
    expect(evaluateGovernmentWarning({ ...label, governmentWarningHeadingBold: "uncertain", governmentWarningBodyBold: "yes" }).status).toBe("fail");
  });

  it("keeps invalid warning text as Fail for every boldness combination", () => {
    for (const heading of ["yes", "no", "uncertain"] as const) {
      for (const body of ["yes", "no", "uncertain"] as const) {
        expect(evaluateGovernmentWarning({ ...label, governmentWarningText: "GOVERNMENT WARNING: wrong text", governmentWarningHeadingBold: heading, governmentWarningBodyBold: body })).toEqual({
          status: "fail", reason: "Government warning wording or punctuation does not match the required statement.",
        });
      }
    }
  });
});

describe("evaluateImageQuality", () => {
  const clean = label.imageQuality!;

  it("passes a readable clean image", () => {
    expect(evaluateImageQuality(clean).status).toBe("pass");
  });

  it.each([
    { readable: false }, { criticalTextObscured: true },
    { glare: "high" as const }, { perspectiveDistortion: "high" as const },
  ])("needs review for a serious image-quality problem %j", (problem) => {
    expect(evaluateImageQuality({ ...clean, ...problem })).toMatchObject({
      status: "needs_review", reason: expect.stringContaining("Please upload a clearer image"),
    });
  });

  it("prioritizes unreadable critical text over high glare or distortion", () => {
    expect(evaluateImageQuality({ ...clean, criticalTextObscured: true, glare: "high", perspectiveDistortion: "high" }).reason).toContain("critical text is obscured");
  });

  it("passes low glare and distortion while readable", () => {
    expect(evaluateImageQuality({ ...clean, glare: "low", perspectiveDistortion: "low" }).status).toBe("pass");
  });

  it("needs review when quality evidence is missing", () => {
    expect(evaluateImageQuality(undefined).status).toBe("needs_review");
    expect(evaluateVerification(application, { ...label, imageQuality: undefined }).overall.status).toBe("needs_review");
  });
});
