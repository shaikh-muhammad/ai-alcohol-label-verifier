import { describe, expect, it } from "vitest";
import { normalizeVolume } from "./normalize-volume";

describe("normalizeVolume", () => {
  it.each([
    ["750 mL", 750],
    ["750 ml", 750],
    ["750 ML", 750],
    ["75 cL", 750],
    ["75 cl", 750],
    ["75 CL", 750],
    ["0.75 L", 750],
    ["0.750 l", 750],
    ["1.5 L", 1500],
    ["37.5 cL", 375],
    ["750mL", 750],
    ["75cl", 750],
    ["0.75L", 750],
    ["  750   mL  ", 750],
    ["750\tmL", 750],
    ["0.07 L", 70],
    ["0.1 cL", 1],
    ["12.5 mL", 12.5],
  ])("converts %s to %s milliliters", (input, expected) => {
    expect(normalizeVolume(input)).toBe(expected);
  });

  it("treats milliliters, centiliters, and liters as equivalent", () => {
    expect(normalizeVolume("750 mL")).toBe(normalizeVolume("75 cL"));
    expect(normalizeVolume("750 mL")).toBe(normalizeVolume("0.75 L"));
  });

  it.each([
    "one bottle",
    "large",
    "750",
    "12 oz",
    "12 fl oz",
    "750 mg",
    "750 milliliters",
    "",
    "   ",
    "mL",
    "0 mL",
    "-750 mL",
    "+750 mL",
    "0.7.5 L",
    "0,75 L",
    "1,000 mL",
    ".75 L",
    "1. L",
    "7 50 mL",
    "750 m L",
    "750 mL extra",
    "about 750 mL",
    "750 mL / 0.75 L",
    "1e3 mL",
    "Infinity L",
    "NaN L",
    "9007199254740992 mL",
    `${"9".repeat(400)} L`,
  ])("returns null for invalid or unsupported input: %s", (input) => {
    expect(normalizeVolume(input)).toBeNull();
  });

  it("keeps different volumes different", () => {
    expect(normalizeVolume("750 mL")).not.toBe(normalizeVolume("700 mL"));
  });
});
