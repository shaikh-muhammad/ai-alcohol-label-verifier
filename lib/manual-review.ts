import type { VerificationResult } from "./evaluate-verification";

export type ReviewStatus = VerificationResult["overall"]["status"];
export type ReviewField = VerificationResult["fields"][number]["field"] | "imageQuality";
export type ManualDecision = { manualStatus: ReviewStatus; note: string };
export type ManualReviews = Partial<Record<ReviewField, ManualDecision>>;
export type ReviewAction =
  | { type: "reset" }
  | { type: "decide"; field: ReviewField; decision: ManualDecision };

export function manualReviewReducer(state: ManualReviews, action: ReviewAction): ManualReviews {
  if (action.type === "reset") return {};
  return { ...state, [action.field]: action.decision };
}

export function finalReviewedStatus(automated: VerificationResult, reviews: ManualReviews): ReviewStatus {
  if (Object.keys(reviews).length === 0) return automated.overall.status;
  const statuses = [
    ...automated.fields.map((field) => reviews[field.field]?.manualStatus ?? field.status),
    reviews.imageQuality?.manualStatus ?? automated.imageQuality.status,
  ];
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("needs_review")) return "needs_review";
  return "pass";
}
