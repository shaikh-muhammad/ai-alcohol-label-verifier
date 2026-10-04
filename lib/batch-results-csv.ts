import type { BatchQueueItem } from "./batch-queue";
import { escapeCsvValue } from "./batch-validation";
import type { FieldVerificationResult } from "./evaluate-verification";

export const RESULTS_CSV_FILENAME = "label-verification-results.csv";
export const RESULTS_CSV_COLUMNS = [
  "filename", "processing_status", "overall_result", "processing_time_ms",
  "brand_result", "class_type_result", "alcohol_content_result", "net_contents_result",
  "producer_name_result", "producer_address_result", "country_of_origin_result",
  "government_warning_result", "image_quality_result", "error",
  "label_brand_name", "label_class_type", "label_alcohol_content", "label_net_contents",
  "label_producer_name", "label_producer_address", "label_country_of_origin",
] as const;

const statusLabels = { pass: "Pass", needs_review: "Needs Review", fail: "Fail" };

/** Export existing terminal items in queue order, without running any checks.
 * Missing values and non-applicable country results are consistently blank.
 * Error rows contain no regulatory or extracted values, even if stale data exists.
 */
export function createBatchResultsCsv(queue: readonly BatchQueueItem[]): string {
  const rows = queue.filter((item) => item.status === "done" || item.status === "error").map((item) => {
    const result = item.status === "done" ? item.result : null;
    const fieldStatus = (field: FieldVerificationResult["field"]) => {
      const status = result?.verification.fields.find((check) => check.field === field)?.status;
      return status ? statusLabels[status] : "";
    };
    return [
      item.filename,
      item.status === "done" ? "Done" : "Error",
      result ? statusLabels[result.verification.overall.status] : "",
      result ? String(result.processingTimeMs) : "",
      fieldStatus("brandName"), fieldStatus("classType"), fieldStatus("alcoholContent"),
      fieldStatus("netContents"), fieldStatus("producerName"), fieldStatus("producerAddress"),
      item.application.importedProduct ? fieldStatus("countryOfOrigin") : "",
      fieldStatus("governmentWarningText"),
      result ? statusLabels[result.verification.imageQuality.status] : "",
      item.error ?? "",
      result?.extraction.brandName ?? "", result?.extraction.classType ?? "",
      result?.extraction.alcoholContent ?? "", result?.extraction.netContents ?? "",
      result?.extraction.producerName ?? "", result?.extraction.producerAddress ?? "",
      result?.extraction.countryOfOrigin ?? "",
    ];
  });
  return [RESULTS_CSV_COLUMNS.join(","), ...rows.map((row) => row.map(escapeCsvValue).join(",")), ""].join("\r\n");
}
