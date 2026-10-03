/** Return a positive metric volume in milliliters, or null for invalid input. */
export function normalizeVolume(text: string): number | null {
  // Require one complete number and a supported unit; do not guess missing units.
  const match = text.trim().match(/^(\d+(?:\.\d+)?)\s*(ml|cl|l)$/i);
  if (!match) return null;

  const unit = match[2].toLowerCase();
  const decimalShift = unit === "l" ? 3 : unit === "cl" ? 1 : 0;

  // Shift the decimal by 0, 1, or 3 places (multiply by 1, 10, or 1000).
  // Parsing once avoids multiplication artifacts such as 0.07 * 1000.
  const milliliters = Number(`${match[1]}e${decimalShift}`);

  if (!Number.isFinite(milliliters) || milliliters <= 0 || milliliters > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return milliliters;
}
