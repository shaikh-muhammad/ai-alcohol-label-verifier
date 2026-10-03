import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize-text";

describe("normalizeText", () => {
  it.each([
    ["capitalization", "OLD TOM", "old tom"],
    ["extra spaces", "Old   Tom Distillery", "old tom distillery"],
    ["leading and trailing spaces", "  Old Tom  ", "old tom"],
    ["tabs and line breaks", "Old\tTom\nDistillery", "old tom distillery"],
    ["curly apostrophes", "Stone’s Throw", "stone's throw"],
    ["left curly apostrophes", "Stone‘s Throw", "stone's throw"],
    ["curly quotation marks", "“Old Tom”", '"old tom"'],
    ["spaces before punctuation", "Bottled by : Old Tom , USA", "bottled by old tom usa"],
    ["harmless text separators", "123 Bourbon Lane, Lexington; KY 40507!", "123 bourbon lane lexington ky 40507"],
    ["spaces inside brackets", "Old Tom ( Bourbon ) [ USA ]", "old tom (bourbon) [usa]"],
  ])("normalizes %s", (_description, input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it("treats STONE'S THROW and Stone’s Throw as equivalent", () => {
    expect(normalizeText("STONE'S THROW")).toBe(normalizeText("Stone’s Throw"));
  });

  it.each(["‐", "‑", "‒", "–", "—", "−"])(
    "normalizes the Unicode dash %s",
    (dash) => {
      expect(normalizeText(`Kentucky ${dash} Straight Bourbon`)).toBe(
        normalizeText("Kentucky - Straight Bourbon"),
      );
    },
  );

  it.each([
    ["Stone's Throw", "Stone Ridge"],
    ["Old Tom", "Old Tom Distillery"],
    ["45% ABV", "40% ABV"],
    ["0.75 L", "075 L"],
    ["Stone's Throw", "Stones Throw"],
    ["Old-Tom", "Old Tom"],
    ["1,000 Main St", "1000 Main St"],
    ["12:30", "1230"],
    ["Old,Tom", "OldTom"],
    ["45% ABV", "45 ABV"],
  ])("keeps %s different from %s", (first, second) => {
    expect(normalizeText(first)).not.toBe(normalizeText(second));
  });

  it("preserves meaningful numbers and punctuation", () => {
    expect(normalizeText("  0.75 L / 45% ABV  ")).toBe("0.75 l / 45% abv");
  });

  it("preserves numeric separators and decimals", () => {
    expect(normalizeText("1,000 / 0.75 / 12:30")).toBe("1,000 / 0.75 / 12:30");
  });

  it("handles empty text", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
  });
});
