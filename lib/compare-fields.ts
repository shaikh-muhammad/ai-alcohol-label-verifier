import { normalizeText } from "./normalize-text";
import { normalizeVolume } from "./normalize-volume";
import { normalizeAlcoholContent, type BeverageType } from "./normalize-alcohol-content";
import { validateGovernmentWarning } from "./validate-government-warning";

export type ComparisonResult = {
  status: "pass" | "needs_review" | "fail";
  reason: string;
};

export function compareText(application: string, label: string): ComparisonResult {
  const applicationText = normalizeText(application);
  const labelText = normalizeText(label);

  // Two blank fields are not evidence of a match.
  if (!applicationText || !labelText) {
    return {
      status: "needs_review",
      reason: "One or both text values are missing. Please review them before comparing.",
    };
  }

  if (application === label) {
    return { status: "pass", reason: "The text values are identical as displayed." };
  }

  if (applicationText === labelText) {
    return {
      status: "needs_review",
      reason: "The values match after normalization but are not identical as displayed. Please review the formatting differences.",
    };
  }

  return { status: "fail", reason: "The text values differ even after normalization." };
}

// Use built-in English region names to avoid treating arbitrary phrases as countries.
const countryNames = new Set<string>();
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
for (let first = 65; first <= 90; first++) {
  for (let second = 65; second <= 90; second++) {
    const name = regionNames.of(String.fromCharCode(first, second));
    if (name) countryNames.add(name.toLowerCase());
  }
}

function normalizeCountryOfOrigin(text: string): string | null {
  const country = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/^product of /, "");
  return countryNames.has(country) ? country : null;
}

export function compareCountryOfOrigin(application: string, label: string): ComparisonResult {
  const applicationCountry = normalizeCountryOfOrigin(application);
  const labelCountry = normalizeCountryOfOrigin(label);
  if (applicationCountry === null || labelCountry === null) {
    return {
      status: "needs_review",
      reason: "One or both country-of-origin values could not be interpreted as a country name or PRODUCT OF a country. Please review them.",
    };
  }
  if (applicationCountry === labelCountry) {
    return { status: "pass", reason: "Both country-of-origin values identify the same country." };
  }
  return { status: "fail", reason: "The country-of-origin values identify different countries." };
}

export function compareVolume(application: string, label: string): ComparisonResult {
  const applicationVolume = normalizeVolume(application);
  const labelVolume = normalizeVolume(label);

  if (applicationVolume === null || labelVolume === null) {
    return {
      status: "needs_review",
      reason: "One or both net-contents values could not be read as a supported metric volume. Please review them.",
    };
  }

  if (applicationVolume === labelVolume) {
    return { status: "pass", reason: `Both net-contents values equal ${applicationVolume} mL.` };
  }

  return {
    status: "fail",
    reason: `Net contents differ: the application has ${applicationVolume} mL and the label has ${labelVolume} mL.`,
  };
}

export function compareAlcoholContent(
  application: string,
  label: string,
  beverageType: BeverageType,
): ComparisonResult {
  const applicationAbv = normalizeAlcoholContent(application, beverageType);
  const labelAbv = normalizeAlcoholContent(label, beverageType);

  if (applicationAbv === null || labelAbv === null) {
    return {
      status: "needs_review",
      reason: "One or both alcohol-content values could not be interpreted for this beverage type. Please review them; proof conversion is supported only for distilled spirits.",
    };
  }

  if (applicationAbv === labelAbv) {
    return { status: "pass", reason: `Both alcohol-content values equal ${applicationAbv}% ABV.` };
  }

  return {
    status: "fail",
    reason: `Alcohol content differs: the application has ${applicationAbv}% ABV and the label has ${labelAbv}% ABV.`,
  };
}

export function compareGovernmentWarning(text: string | null | undefined): ComparisonResult {
  const result = validateGovernmentWarning(text);
  return {
    status: result.status === "Pass" ? "pass" : "fail",
    reason: result.reason,
  };
}
