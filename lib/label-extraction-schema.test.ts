import { describe, expect, it } from "vitest";
import { labelExtractionSchema, type LabelExtraction } from "./label-extraction-schema";

const extraction: LabelExtraction = {
  brandName: "STONE'S THROW",
  classType: "Kentucky Straight Bourbon WHISKEY",
  alcoholContent: "90 PROOF",
  netContents: "0.75 L",
  producerName: "Bottled by: Stone's Throw Distillery",
  producerAddress: "123 Main St., Louisville, KY",
  countryOfOrigin: "USA",
  governmentWarningText: "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
  governmentWarningHeadingBold: "yes",
  governmentWarningBodyBold: "no",
  imageQuality: {
    readable: true,
    glare: "none",
    perspectiveDistortion: "low",
    criticalTextObscured: false,
    reason: null,
  },
};

const textFields = [
  "brandName", "classType", "alcoholContent", "netContents",
  "producerName", "producerAddress", "countryOfOrigin", "governmentWarningText",
] as const;

describe("labelExtractionSchema", () => {
  it("accepts a complete extraction and preserves all text exactly", () => {
    expect(labelExtractionSchema.parse(extraction)).toEqual(extraction);
  });

  it("accepts all unreadable text fields as null", () => {
    const unreadable = {
      ...extraction,
      ...Object.fromEntries(textFields.map((field) => [field, null])),
    };
    expect(labelExtractionSchema.parse(unreadable)).toEqual(unreadable);
  });

  it("preserves whitespace, spelling, capitalization, punctuation, and units", () => {
    const verbatim = { ...extraction, brandName: "  STONE'S THROWW\n", alcoholContent: "90 PROOF", netContents: "0.75 L" };
    expect(labelExtractionSchema.parse(verbatim)).toEqual(verbatim);
  });

  it.each(["yes", "no", "uncertain"])("accepts heading boldness %s", (value) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, governmentWarningHeadingBold: value }).success).toBe(true);
  });

  it.each(["bold", "YES", "Pass", "Fail", "Needs Review", true, null, 1])("rejects invalid heading boldness %s", (value) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, governmentWarningHeadingBold: value }).success).toBe(false);
  });

  it.each(["none", "low", "high"])("accepts image quality level %s", (value) => {
    expect(labelExtractionSchema.safeParse({
      ...extraction,
      imageQuality: { readable: false, glare: value, perspectiveDistortion: value, criticalTextObscured: true, reason: "Glare obscures part of the government warning." },
    }).success).toBe(true);
  });

  it.each(["yes", "no", "uncertain"])("accepts body boldness %s", (value) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, governmentWarningBodyBold: value }).success).toBe(true);
  });

  it.each(["bold", "NO", "Pass", true, null, 1])("rejects invalid body boldness %s", (value) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, governmentWarningBodyBold: value }).success).toBe(false);
  });

  it.each(["glare", "perspectiveDistortion"])("rejects invalid %s levels", (field) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, imageQuality: { ...extraction.imageQuality, [field]: "medium" } }).success).toBe(false);
  });

  it.each(Object.keys(extraction))("requires property %s", (field) => {
    const incomplete: Record<string, unknown> = { ...extraction };
    delete incomplete[field];
    expect(labelExtractionSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each(Object.keys(extraction.imageQuality))("requires imageQuality.%s", (field) => {
    const incomplete: Record<string, unknown> = { ...extraction.imageQuality };
    delete incomplete[field];
    expect(labelExtractionSchema.safeParse({ ...extraction, imageQuality: incomplete }).success).toBe(false);
  });

  it.each(textFields)("rejects incorrect types for %s", (field) => {
    for (const value of [42, false, [], {}, undefined]) {
      expect(labelExtractionSchema.safeParse({ ...extraction, [field]: value }).success).toBe(false);
    }
  });

  it.each([
    ["readable", "true"], ["criticalTextObscured", 0],
    ["glare", null], ["perspectiveDistortion", 1], ["reason", {}],
  ])("rejects incorrect imageQuality.%s types", (field, value) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, imageQuality: { ...extraction.imageQuality, [field]: value } }).success).toBe(false);
  });

  it.each([null, [], "image", 42])("rejects invalid imageQuality objects %s", (value) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, imageQuality: value }).success).toBe(false);
  });

  it.each(["Pass", "Fail", "Needs Review"])("rejects added compliance status %s", (status) => {
    expect(labelExtractionSchema.safeParse({ ...extraction, complianceStatus: status }).success).toBe(false);
    expect(labelExtractionSchema.safeParse({ ...extraction, imageQuality: { ...extraction.imageQuality, complianceStatus: status } }).success).toBe(false);
  });
});
