import { describe, expect, it } from "vitest";
import type { VerificationResult } from "./evaluate-verification";
import { finalReviewedStatus, manualReviewReducer, type ManualReviews } from "./manual-review";

function automated(status: "pass" | "needs_review" | "fail" = "needs_review"): VerificationResult {
  return {
    overall: { status, reason: "Original overall reason" },
    fields: [
      { field: "producerAddress", fieldName: "Address", status, reason: "Original address reason", applicationValue: "Example Street", extractedValue: "EXAMPLE STREET" },
      { field: "brandName", fieldName: "Brand", status: "pass", reason: "Exact match", extractedValue: "OLD TOM" },
    ],
    imageQuality: { status: "pass", reason: "Readable" },
  };
}

const accepted: ManualReviews = { producerAddress: { manualStatus: "pass", note: "Confirmed against application." } };

describe("finalReviewedStatus", () => {
  it.each(["pass", "needs_review", "fail"] as const)("preserves automated %s without overrides", (status) => {
    expect(finalReviewedStatus(automated(status), {})).toBe(status);
  });

  it("passes when the only Needs Review is manually accepted", () => {
    expect(finalReviewedStatus(automated(), accepted)).toBe("pass");
  });

  it("prioritizes a manual Fail over remaining Needs Review", () => {
    expect(finalReviewedStatus(automated(), { producerAddress: { manualStatus: "fail", note: "Label must be corrected." } })).toBe("fail");
  });

  it("keeps a remaining Needs Review", () => {
    const result = automated();
    result.imageQuality.status = "needs_review";
    expect(finalReviewedStatus(result, accepted)).toBe("needs_review");
  });

  it("includes manual image-quality decisions", () => {
    const result = automated();
    result.imageQuality.status = "needs_review";
    expect(finalReviewedStatus(result, { ...accepted, imageQuality: { manualStatus: "pass", note: "Independently readable" } })).toBe("pass");
    expect(finalReviewedStatus(result, { ...accepted, imageQuality: { manualStatus: "fail", note: "" } })).toBe("fail");
  });

  it("keeps an automated Fail that has no manual decision", () => {
    const result = automated();
    result.fields[1].status = "fail";
    expect(finalReviewedStatus(result, accepted)).toBe("fail");
  });

  it("does not mutate automated statuses, reasons, or values", () => {
    const result = automated();
    const original = structuredClone(result);
    finalReviewedStatus(result, accepted);
    expect(result).toEqual(original);
  });
});

describe("manualReviewReducer", () => {
  it("stores decisions separately without changing existing reviews", () => {
    const next = manualReviewReducer(accepted, { type: "decide", field: "imageQuality", decision: { manualStatus: "needs_review", note: "Glare" } });
    expect(next.producerAddress).toEqual(accepted.producerAddress);
    expect(next.imageQuality?.manualStatus).toBe("needs_review");
    expect(accepted.imageQuality).toBeUndefined();
  });

  it("clears previous overrides for a new verification", () => {
    const reset = manualReviewReducer(accepted, { type: "reset" });
    expect(reset).toEqual({});
    expect(finalReviewedStatus(automated(), reset)).toBe("needs_review");
    expect(accepted.producerAddress?.manualStatus).toBe("pass");
  });
});
