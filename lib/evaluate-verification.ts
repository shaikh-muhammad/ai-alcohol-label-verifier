import {
  compareText,
  compareVolume,
  compareAlcoholContent,
  compareGovernmentWarning,
  type ComparisonResult,
} from "./compare-fields";
import type { BeverageType } from "./normalize-alcohol-content";
import type { LabelExtraction } from "./label-extraction-schema";

export type ApplicationData = {
  beverageType: BeverageType;
  brandName: string;
  classType: string;
  alcoholContent: string;
  netContents: string;
  producerName: string;
  producerAddress: string;
  importedProduct: boolean;
  countryOfOrigin?: string;
};

// Partial evidence remains supported; missing visual evidence must need review.
export type ExtractedLabelData = Partial<LabelExtraction>;
type TextField = Exclude<keyof LabelExtraction,
  "governmentWarningHeadingBold" | "governmentWarningBodyBold" | "imageQuality">;

export type ImageQualityResult = {
  status: "pass" | "needs_review";
  reason: string;
};

export function evaluateGovernmentWarning(label: ExtractedLabelData): ComparisonResult {
  const textResult = compareGovernmentWarning(label.governmentWarningText);
  if (textResult.status === "fail") return textResult;
  if (label.governmentWarningHeadingBold === "no") {
    return { status: "fail", reason: "The 'GOVERNMENT WARNING:' heading does not appear bold." };
  }
  if (label.governmentWarningBodyBold === "yes") {
    return { status: "fail", reason: "The warning text after the heading should not appear bold." };
  }
  if (label.governmentWarningHeadingBold !== "yes" || label.governmentWarningBodyBold !== "no") {
    return { status: "needs_review", reason: "Government warning visual formatting could not be confirmed confidently: the heading must appear bold and the text after it must not appear bold." };
  }
  return { status: "pass", reason: "Government warning text matches the required statement, the heading appears bold, and the text after it does not appear bold." };
}

export function evaluateImageQuality(quality: LabelExtraction["imageQuality"] | undefined): ImageQualityResult {
  if (!quality) {
    return { status: "needs_review", reason: "Image quality has not been assessed, so readability of required information could not be confirmed. Please upload a clearer image for review." };
  }
  if (!quality.readable || quality.criticalTextObscured) {
    return { status: "needs_review", reason: "Required information could not be read confidently because the image is unreadable or critical text is obscured. Please upload a clearer image." };
  }
  if (quality.glare === "high" || quality.perspectiveDistortion === "high") {
    return { status: "needs_review", reason: "High glare or perspective distortion makes required information difficult to confirm confidently. Please upload a clearer image." };
  }
  return { status: "pass", reason: "The image is readable, critical text is not obscured, and there is no high-severity glare or perspective distortion." };
}

export type FieldVerificationResult = ComparisonResult & {
  field: TextField;
  fieldName: string;
  applicationValue?: string;
  extractedValue: string | null;
};

export type VerificationResult = {
  overall: ComparisonResult;
  fields: FieldVerificationResult[];
  imageQuality: ImageQualityResult;
};

export function evaluateVerification(
  application: ApplicationData,
  label: ExtractedLabelData,
): VerificationResult {
  const fields: FieldVerificationResult[] = [];

  function addField(
    field: Exclude<TextField, "governmentWarningText">,
    fieldName: string,
    applicationValue: string,
    compare: (application: string, label: string) => ComparisonResult = compareText,
  ) {
    const extractedValue = label[field] ?? null;
    const result: ComparisonResult = extractedValue === null || !extractedValue.trim()
      ? {
          status: "needs_review",
          reason: `Could not confidently read the ${fieldName.toLowerCase()} from the label.`,
        }
      : compare(applicationValue, extractedValue);

    fields.push({ field, fieldName, applicationValue, extractedValue, ...result });
  }

  addField("brandName", "Brand Name", application.brandName);
  addField("classType", "Class / Type", application.classType);
  addField("alcoholContent", "Alcohol Content", application.alcoholContent,
    (applicationValue, labelValue) => compareAlcoholContent(applicationValue, labelValue, application.beverageType));
  addField("netContents", "Net Contents", application.netContents, compareVolume);
  addField("producerName", "Producer / Bottler Name", application.producerName);
  addField("producerAddress", "Producer / Bottler Address", application.producerAddress);

  if (application.importedProduct) {
    addField("countryOfOrigin", "Country of Origin", application.countryOfOrigin ?? "");
  }

  fields.push({
    field: "governmentWarningText",
    fieldName: "Government Warning",
    extractedValue: label.governmentWarningText ?? null,
    ...evaluateGovernmentWarning(label),
  });

  const imageQuality = evaluateImageQuality(label.imageQuality);
  let overall: ComparisonResult;
  if (fields.some((field) => field.status === "fail")) {
    overall = { status: "fail", reason: "At least one applicable field failed an automated check. Review the individual field results." };
  } else if (imageQuality.status === "needs_review" || fields.some((field) => field.status === "needs_review")) {
    overall = { status: "needs_review", reason: "At least one applicable field or image quality needs review before verification can be completed." };
  } else {
    overall = { status: "pass", reason: "All applicable fields and image quality passed the automated checks." };
  }

  return { overall, fields, imageQuality };
}
