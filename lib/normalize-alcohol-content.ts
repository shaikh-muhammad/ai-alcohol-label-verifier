export type BeverageType = "distilled-spirits" | "wine" | "beer-malt-beverage";

/** Return alcohol content as an ABV percentage, or null for unsupported input. */
export function normalizeAlcoholContent(
  text: string,
  beverageType: BeverageType,
): number | null {
  const input = text.trim().toLowerCase().replace(/\s+/g, " ");
  const abvMatch = input.match(
    /^(\d+(?:\.\d+)?)(?:\s*%\s*|\s+percent\s+)(?:abv|alc\.?\s*\/\s*vol\.?|alcohol by volume)$/,
  );

  let abv: number;

  if (abvMatch) {
    abv = Number(abvMatch[1]);
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
