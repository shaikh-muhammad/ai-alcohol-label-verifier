import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchQueueItem } from "./batch-queue";
import type { FieldVerificationResult } from "./evaluate-verification";
import { createBatchResultsCsv, RESULTS_CSV_COLUMNS, RESULTS_CSV_FILENAME } from "./batch-results-csv";

function item(filename = "bourbon-001.png", status: "pass" | "needs_review" | "fail" = "pass"): BatchQueueItem {
  const fields: FieldVerificationResult[] = [
    ["brandName", "pass"], ["classType", "needs_review"], ["alcoholContent", "fail"],
    ["netContents", "pass"], ["producerName", "needs_review"], ["producerAddress", "fail"],
    ["countryOfOrigin", "needs_review"], ["governmentWarningText", "pass"],
  ].map(([field, status]) => ({ field, status, fieldName: field, extractedValue: "value", reason: "Server decision" })) as FieldVerificationResult[];
  return {
    filename, status: "done", error: null,
    application: { beverageType: "distilled-spirits", brandName: "OLD TOM", classType: "Bourbon", alcoholContent: "45% ABV", netContents: "750 mL", producerName: "Old Tom", producerAddress: "Address", importedProduct: true, countryOfOrigin: "Canada" },
    originalImage: new File(["original"], filename), preparedImage: new Blob(["prepared"]),
    result: {
      verification: { overall: { status, reason: "Server decision" }, fields, imageQuality: { status: "needs_review", reason: "Review" } },
      processingTimeMs: 2800,
      extraction: { brandName: "OLD TOM", classType: "Bourbon", alcoholContent: "45% ABV", netContents: "750 mL", producerName: 'Old "Tom" Distillery', producerAddress: "123 Bourbon Lane, Lexington, KY 40507", countryOfOrigin: "Canada", governmentWarningText: null, governmentWarningHeadingBold: "uncertain", governmentWarningBodyBold: "uncertain", imageQuality: { readable: true, glare: "none", perspectiveDistortion: "none", criticalTextObscured: false, reason: null } },
    },
  };
}

// Independent decoder for assertions, including multiline quoted cells.
function decode(csv: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ""; }
    else if (char === '\r' && csv[i + 1] === '\n' && !quoted) {
      row.push(value); records.push(row); row = []; value = ""; i++;
    } else value += char;
  }
  const headers = records.shift()!;
  return records.map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i]])));
}

afterEach(() => vi.unstubAllGlobals());
describe("batch results CSV", () => {
  it.each([["pass", "Pass"], ["needs_review", "Needs Review"], ["fail", "Fail"]] as const)("exports %s overall results", (status, label) => {
    const csv = createBatchResultsCsv([item(undefined, status)]);
    expect(csv.split("\r\n")[0]).toBe(RESULTS_CSV_COLUMNS.join(","));
    expect(RESULTS_CSV_FILENAME).toBe("label-verification-results.csv");
    expect(decode(csv)[0]).toMatchObject({ filename: "bourbon-001.png", processing_status: "Done", overall_result: label, processing_time_ms: "2800", error: "" });
  });

  it("exports friendly errors without inventing regulatory results or leaking stale results", () => {
    const failed = { ...item(), status: "error" as const, error: "AI service could not complete this verification." };
    const row = decode(createBatchResultsCsv([failed]))[0];
    expect(row.filename).toBe(failed.filename);
    expect(row.processing_status).toBe("Error");
    expect(row.error).toBe(failed.error);
    for (const column of RESULTS_CSV_COLUMNS.filter((column) => !["filename", "processing_status", "error"].includes(column))) expect(row[column]).toBe("");
    expect(decode(createBatchResultsCsv([{ ...failed, result: null }]))[0]).toEqual(row);
  });

  it("quotes commas, doubles quotes, and preserves each extracted value in its cell", () => {
    const csv = createBatchResultsCsv([item()]);
    expect(csv).toContain('"123 Bourbon Lane, Lexington, KY 40507"');
    expect(csv).toContain('"Old ""Tom"" Distillery"');
    expect(decode(csv)[0]).toMatchObject({ label_brand_name: "OLD TOM", label_class_type: "Bourbon", label_alcohol_content: "45% ABV", label_net_contents: "750 mL", label_producer_name: 'Old "Tom" Distillery', label_producer_address: "123 Bourbon Lane, Lexington, KY 40507", label_country_of_origin: "Canada" });
  });

  it("preserves LF and CRLF line breaks inside quoted cells", () => {
    const value = item();
    value.result!.extraction.producerAddress = '123 Bourbon Lane\nSuite "A"\r\nLexington, KY';
    const csv = createBatchResultsCsv([value, item("second.png")]);
    expect(csv).toContain('"123 Bourbon Lane\nSuite ""A""\r\nLexington, KY"');
    expect(decode(csv)).toHaveLength(2);
    expect(decode(csv)[0].label_producer_address).toBe(value.result!.extraction.producerAddress);
  });

  it("maps fields by their identifiers rather than array order", () => {
    const value = item();
    value.result!.verification.fields.reverse();
    expect(decode(createBatchResultsCsv([value]))[0]).toMatchObject({ brand_result: "Pass", class_type_result: "Needs Review", alcohol_content_result: "Fail", net_contents_result: "Pass", producer_name_result: "Needs Review", producer_address_result: "Fail", country_of_origin_result: "Needs Review", government_warning_result: "Pass", image_quality_result: "Needs Review" });
  });

  it("consistently leaves non-imported country results blank", () => {
    const value = item();
    value.application.importedProduct = false;
    expect(decode(createBatchResultsCsv([value]))[0].country_of_origin_result).toBe("");
    value.result!.verification.fields = value.result!.verification.fields.filter((field) => field.field !== "countryOfOrigin");
    expect(decode(createBatchResultsCsv([value]))[0].country_of_origin_result).toBe("");
  });

  it("preserves filename/result association and queue order across multiple rows", () => {
    const values = [item("third.png", "fail"), item("first.png", "pass"), item("second.png", "needs_review")];
    const rows = decode(createBatchResultsCsv(values));
    expect(rows.map((row) => [row.filename, row.overall_result])).toEqual([["third.png", "Fail"], ["first.png", "Pass"], ["second.png", "Needs Review"]]);
    expect(values.map((value) => value.status)).toEqual(["done", "done", "done"]);
  });

  it("exports only terminal items and leaves missing values blank", () => {
    const value = item();
    value.result!.extraction.brandName = null;
    value.result!.verification.fields = [];
    const rows = decode(createBatchResultsCsv([{ ...item(), status: "checking" }, value, { ...item(), status: "queued" }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].label_brand_name).toBe("");
    expect(rows[0].brand_result).toBe("");
    expect(decode(createBatchResultsCsv([]))).toEqual([]);
  });

  it("makes no network request and does not mutate batch results", () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const queue = [item()];
    const before = structuredClone(queue);
    createBatchResultsCsv(queue);
    expect(fetch).not.toHaveBeenCalled();
    expect(queue).toEqual(before);
  });
});
