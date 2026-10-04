import { describe, expect, it } from "vitest";
import {
  compareText,
  compareCountryOfOrigin,
  compareVolume,
  compareAlcoholContent,
  compareGovernmentWarning,
} from "./compare-fields";
import {
  REQUIRED_GOVERNMENT_WARNING,
  validateGovernmentWarning,
} from "./validate-government-warning";

describe("compareText", () => {
  it.each([
    ["Old Tom Distillery", "Old Tom Distillery", "pass"],
    ["Stone's Throw", "STONE'S THROW", "needs_review"],
    ["Stone's Throw", "Stone’s Throw", "needs_review"],
    ["Old Tom Distillery", "Old   Tom Distillery", "needs_review"],
    ["Stone's Throw", "STONE’S THROW", "needs_review"],
    ["Old Tom", " Old Tom ", "needs_review"],
    ["Stone's Throw", "Stone Ridge", "fail"],
    ["Old Tom", "Old Tom Distillery", "fail"],
    ["", "", "needs_review"],
    ["Old Tom", "", "needs_review"],
    ["", "Old Tom", "needs_review"],
    ["  ", "\t", "needs_review"],
  ])("compares %s with %s as %s", (application, label, status) => {
    const result = compareText(application, label);
    expect(result.status).toBe(status);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("explains why a normalized match needs review", () => {
    expect(compareText("Stone's Throw", "STONE’S THROW").reason).toContain(
      "match after normalization but are not identical as displayed",
    );
  });

  const address = "123 Bourbon Lane, Lexington, KY 40507";
  it.each([
    ["missing comma", "123 Bourbon Lane Lexington, KY 40507", "needs_review"],
    ["extra harmless punctuation", "123 Bourbon Lane,, Lexington; KY 40507!", "needs_review"],
    ["exact displayed address", address, "pass"],
    ["different address", "987 Whiskey Road, Louisville, KY 40202", "fail"],
    ["different street number", "124 Bourbon Lane Lexington, KY 40507", "fail"],
    ["different ZIP code", "123 Bourbon Lane Lexington, KY 40508", "fail"],
    ["different street name", "123 Whiskey Lane Lexington, KY 40507", "fail"],
    ["different city", "123 Bourbon Lane Louisville, KY 40507", "fail"],
    ["different decimal number", "1.23 Bourbon Lane Lexington, KY 40507", "fail"],
    ["joined words", "123 BourbonLane Lexington, KY 40507", "fail"],
  ])("handles address with %s as %s", (_description, label, status) => {
    expect(compareText(address, label).status).toBe(status);
  });
});

describe("compareVolume", () => {
  it.each([
    ["750 mL", "750 mL", "pass"],
    ["750 mL", "75 cL", "pass"],
    ["0.75 L", "750 mL", "pass"],
    ["750 mL", "1 L", "fail"],
    ["750 mL", "large", "needs_review"],
    ["large", "750 mL", "needs_review"],
    ["12 oz", "12 oz", "needs_review"],
    ["", "", "needs_review"],
  ])("compares %s with %s as %s", (application, label, status) => {
    const result = compareVolume(application, label);
    expect(result.status).toBe(status);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe("compareAlcoholContent", () => {
  it.each([
    ["45% ABV", "45% ABV", "pass"],
    ["45% ABV", "90 proof", "pass"],
    ["45% ABV", "45% ABV (90 Proof)", "pass"],
    ["45% ABV", "45% ABV (80 Proof)", "needs_review"],
    ["40% ABV", "80 proof", "pass"],
    ["45% ABV", "80 proof", "fail"],
    ["45% ABV", "strong", "needs_review"],
    ["strong", "45% ABV", "needs_review"],
    ["strong", "strong", "needs_review"],
    ["", "", "needs_review"],
  ])("compares spirits %s with %s as %s", (application, label, status) => {
    const result = compareAlcoholContent(application, label, "distilled-spirits");
    expect(result.status).toBe(status);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it.each(["wine", "beer-malt-beverage"] as const)(
    "needs review for proof in %s, even when displayed values match",
    (beverageType) => {
      expect(compareAlcoholContent("45% ABV", "90 proof", beverageType).status).toBe("needs_review");
      expect(compareAlcoholContent("90 proof", "45% ABV", beverageType).status).toBe("needs_review");
      expect(compareAlcoholContent("90 proof", "90 proof", beverageType).status).toBe("needs_review");
      expect(compareAlcoholContent("12% ABV", "12% Alcohol by Volume", beverageType).status).toBe("pass");
      expect(compareAlcoholContent("12% ABV", "13% ABV", beverageType).status).toBe("fail");
    },
  );
});

describe("compareGovernmentWarning", () => {
  it.each([
    [REQUIRED_GOVERNMENT_WARNING, "pass"],
    [REQUIRED_GOVERNMENT_WARNING.replace(/ /g, "\n"), "pass"],
    [REQUIRED_GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"), "fail"],
    [REQUIRED_GOVERNMENT_WARNING.replace("General,", "General"), "fail"],
    ["", "fail"],
    [null, "fail"],
    [undefined, "fail"],
  ])("maps warning validation to %s → %s", (text, status) => {
    const result = compareGovernmentWarning(text);
    expect(result.status).toBe(status);
    expect(result.reason).toBe(validateGovernmentWarning(text).reason);
  });
});

describe("compareCountryOfOrigin", () => {
  it.each([
    ["Canada", "Canada", "pass"],
    ["Canada", "PRODUCT OF CANADA", "pass"],
    ["Canada", "Product of Canada", "pass"],
    [" Canada ", " product  OF\tCANADA ", "pass"],
    ["Canada", "PRODUCT OF MEXICO", "fail"],
    ["Canada", "Mexico", "fail"],
    ["Canada", "PRODUCT OF", "needs_review"],
    ["Canada", "PRODUCT OF CANADA OR MEXICO", "needs_review"],
    ["Canada", "unknown", "needs_review"],
    ["Canada", "Made in Canada", "needs_review"],
    ["Canada", "", "needs_review"],
    ["", "Canada", "needs_review"],
    ["unknown", "unknown", "needs_review"],
  ])("compares %s with %s as %s", (application, label, status) => {
    const result = compareCountryOfOrigin(application, label);
    expect(result.status).toBe(status);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("keeps generic text comparison strict", () => {
    expect(compareText("Canada", "PRODUCT OF CANADA").status).toBe("fail");
  });
});
