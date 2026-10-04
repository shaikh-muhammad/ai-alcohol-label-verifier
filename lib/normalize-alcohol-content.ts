export type BeverageType = "distilled-spirits" | "wine" | "beer-malt-beverage";

/** Return alcohol content as an ABV percentage, or null for unsupported input. */
export function normalizeAlcoholContent(
  text: string,
  beverageType: BeverageType,
): number | null {
  const input = text.trim().toLowerCase().replace(/\s+/g, " ");
  const abvMatch = input.match(
    /^(\d+(?:\.\d+)?)(?:\s*%\s*|\s+percent\s+)(?:abv|alc\.?\s*\/\s*vol\.?|alcohol by volume)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*proof\s*\))?$/,
  );

  let abv: number;

  if (abvMatch) {
    abv = Number(abvMatch[1]);
    if (abvMatch[2] !== undefined) {
      if (beverageType !== "distilled-spirits") return null;
      const proofAbv = Number(abvMatch[2]) / 2;
      // Allow only floating-point rounding, never a substantive discrepancy.
      if (!Number.isFinite(proofAbv) ||
          Math.abs(abv - proofAbv) > Number.EPSILON * Math.max(1, abv, proofAbv)) return null;
    }
  } else {
    // Proof is interpreted only when the caller explicitly selects spirits.
    if (beverageType !== "distilled-spirits") return null;

    const proofMatch = input.match(/^(\d+(?:\.\d+)?)\s*proof$/);
    if (!proofMatch) return null;

    abv = Number(proofMatch[1]) / 2;
  }

  // ABV is a percentage, so values outside 0–100 cannot be valid.
  if (!Number.isFinite(abv) || abv < 0 || abv > 100) return null;

  return abv;
}
