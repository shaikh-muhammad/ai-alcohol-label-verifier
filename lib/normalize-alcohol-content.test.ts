import { describe, expect, it } from "vitest";
import { normalizeAlcoholContent } from "./normalize-alcohol-content";

describe("normalizeAlcoholContent", () => {
  it.each([
    ["45% ABV", 45],
    ["45% Alc./Vol.", 45],
    ["45% Alc/Vol", 45],
    ["45% Alcohol by Volume", 45],
    ["40 percent alcohol by volume", 40],
    ["40% Alcohol by Volume", 40],
    ["90 proof", 45],
    ["80 Proof", 40],
    ["45% abv", 45],
    ["45% ALCOHOL BY VOLUME", 45],
    ["90 PROOF", 45],
    [" 45 %   ABV  ", 45],
    ["45%ABV", 45],
    ["45% Alc. / Vol.", 45],
    ["40   percent   alcohol by   volume", 40],
    [" 90   proof ", 45],
    ["45%\tAlcohol\nby Volume", 45],
    ["37.5% ABV", 37.5],
    ["75.5 proof", 37.75],
    ["0% ABV", 0],
    ["100% ABV", 100],
    ["200 proof", 100],
  ])("normalizes %s to %s ABV for spirits", (input, expected) => {
    expect(normalizeAlcoholContent(input, "distilled-spirits")).toBe(expected);
  });

  it.each([
    ["45% ABV", "90 proof"],
    ["40% ABV", "80 proof"],
  ])("treats %s and %s as equivalent for spirits", (abv, proof) => {
    expect(normalizeAlcoholContent(abv, "distilled-spirits")).toBe(
      normalizeAlcoholContent(proof, "distilled-spirits"),
    );
  });

  it.each(["wine", "beer-malt-beverage"] as const)(
    "accepts ABV but rejects proof for %s",
    (beverageType) => {
      expect(normalizeAlcoholContent("12.5% ABV", beverageType)).toBe(12.5);
      expect(normalizeAlcoholContent("40 percent alcohol by volume", beverageType)).toBe(40);
      expect(normalizeAlcoholContent("90 proof", beverageType)).toBeNull();
      expect(normalizeAlcoholContent("80 Proof", beverageType)).toBeNull();
    },
  );

  it.each([
    "strong",
    "high alcohol",
    "45",
    "proof",
    "ABV unknown",
    "",
    "   ",
    "45%",
    "45 ABV",
    "45% alcohol",
    "-45% ABV",
    "+45% ABV",
    "101% ABV",
    "201 proof",
    "-90 proof",
    "4 5% ABV",
    "45..5% ABV",
    "45,5% ABV",
    ".5% ABV",
    "45.% ABV",
    "4.5e1% ABV",
    "about 45% ABV",
    "45% ABV extra",
    "45% ABV / 90 proof",
    "Infinity% ABV",
    "NaN% ABV",
    `${"9".repeat(400)} proof`,
  ])("returns null for malformed or unsupported input: %s", (input) => {
    expect(normalizeAlcoholContent(input, "distilled-spirits")).toBeNull();
  });

  it("keeps different alcohol contents different", () => {
    expect(normalizeAlcoholContent("45% ABV", "distilled-spirits")).not.toBe(
      normalizeAlcoholContent("80 proof", "distilled-spirits"),
    );
  });
});
