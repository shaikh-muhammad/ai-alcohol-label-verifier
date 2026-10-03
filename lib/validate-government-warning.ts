export const REQUIRED_GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

export type GovernmentWarningResult = {
  status: "Pass" | "Fail";
  reason: string;
};

/** Validate warning text only; visual formatting cannot be checked from text. */
export function validateGovernmentWarning(
  text: string | null | undefined,
): GovernmentWarningResult {
  // Preserve every word, capital letter, and punctuation mark.
  const warning = (text ?? "").trim().replace(/\s+/g, " ");

  if (!warning) {
    return { status: "Fail", reason: "Government warning is missing." };
  }

  if (!warning.startsWith("GOVERNMENT WARNING:")) {
    return {
      status: "Fail",
      reason: "Government warning heading must be exactly 'GOVERNMENT WARNING:'.",
    };
  }

  if (warning !== REQUIRED_GOVERNMENT_WARNING) {
    return {
      status: "Fail",
      reason: "Government warning wording or punctuation does not match the required statement.",
    };
  }

  return {
    status: "Pass",
    reason: "Government warning wording and capitalization match the required text.",
  };
}
