import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, createCsvTemplate, parseBatchCsv, validateBatch, type BatchRow } from "./batch-validation";

const example = parseBatchCsv(createCsvTemplate()).rows[0];
const image = { name: example.filename, type: "image/jpeg" };
function csv(overrides: Partial<BatchRow> = {}, copies = 1) {
  const row = { ...example, ...overrides };
  const escaped = CSV_COLUMNS.map((column) => `"${row[column].replaceAll('"', '""')}"`).join(",");
  return `${CSV_COLUMNS.join(",")}\n${Array(copies).fill(escaped).join("\n")}`;
}

describe("batch input validation", () => {
  it("accepts valid CSV and matching images", () => {
    expect(validateBatch(csv(), [image]).ready).toBe(true);
  });
  it("reports a missing required column", () => {
    expect(validateBatch(csv().replace("brand_name,", ""), [image]).errors).toContain("The CSV is missing the ‘brand_name’ column.");
  });
  it("reports a row without filename", () => {
    expect(validateBatch(csv({ filename: " " }), [image]).errors).toContain("CSV row 2 needs a filename.");
  });
  it("reports duplicate CSV filenames", () => {
    expect(validateBatch(csv({}, 2), [image]).errors).toContain(`Duplicate filename: ${image.name}.`);
  });
  it("reports missing uploaded images", () => {
    expect(validateBatch(csv(), []).errors).toContain(`${image.name} is listed in the CSV but was not uploaded.`);
  });
  it("reports extra uploaded images", () => {
    expect(validateBatch(csv(), [image, { ...image, name: "extra.png" }]).errors).toContain("extra.png was uploaded but does not appear in the CSV.");
  });
  it("reports duplicate image filenames", () => {
    expect(validateBatch(csv(), [image, image]).errors).toContain(`Duplicate uploaded image filename: ${image.name}.`);
  });
  it("reports unsupported image types", () => {
    expect(validateBatch(csv(), [{ ...image, type: "image/gif" }]).errors.join()).toContain("unsupported image type");
  });
  it("requires country for imported rows", () => {
    expect(validateBatch(csv({ imported_product: "true" }), [image]).errors.join()).toContain("imported products need country_of_origin");
  });
  it("accepts blank country for non-imported rows", () => {
    expect(validateBatch(csv({ imported_product: "false", country_of_origin: "" }), [image]).ready).toBe(true);
  });
  it("rejects invalid beverage type", () => {
    expect(validateBatch(csv({ beverage_type: "cider" }), [image]).errors.join()).toContain("beverage_type must be");
  });
  it("rejects unclear imported_product", () => {
    expect(validateBatch(csv({ imported_product: "maybe" }), [image]).errors.join()).toContain("imported_product must be");
  });
  it("validates the downloadable OLD TOM example", () => {
    const result = validateBatch(createCsvTemplate(), [image]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].brand_name).toBe("OLD TOM");
  });
  it("requires a CSV and at least one image", () => {
    expect(validateBatch(null, []).errors).toEqual(["Choose one CSV file.", "Choose at least one label image."]);
  });
  it.each(["brand_name", "class_type", "alcohol_content", "net_contents", "producer_name", "producer_address"] as const)("requires %s", (field) => {
    expect(validateBatch(csv({ [field]: " " }), [image]).errors.join()).toContain(`check ‘${field}’`);
  });
  it.each(["wine", "beer-malt-beverage", "distilled-spirits"])("supports %s", (beverage_type) => {
    expect(validateBatch(csv({ beverage_type }), [image]).ready).toBe(true);
  });
  it.each(["true", "YES", "1", "false", "No", "0"])("accepts clear boolean %s", (imported_product) => {
    expect(validateBatch(csv({ imported_product, country_of_origin: "USA" }), [image]).ready).toBe(true);
  });
  it("matches filenames case sensitively", () => {
    expect(validateBatch(csv(), [{ ...image, name: "OLD-TOM.jpg" }]).errors).toHaveLength(2);
  });
  it("enforces application length limits", () => {
    expect(validateBatch(csv({ brand_name: "a".repeat(501) }), [image]).ready).toBe(false);
  });
});

describe("CSV parsing", () => {
  it("handles BOM, CRLF, blank lines, quoted commas, escaped quotes, and multiline cells", () => {
    const result = parseBatchCsv(`\uFEFF\r\n${csv({ brand_name: 'OLD "TOM"', producer_address: "Street, City\nUSA" }).replaceAll("\n", "\r\n")}\r\n\r\n`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].brand_name).toBe('OLD "TOM"');
    expect(result.rows[0].producer_address).toBe("Street, City\r\nUSA");
  });
  it.each(['"unfinished', 'un"expected', '"closed"extra'])("explains malformed quotes in plain language", (value) => {
    expect(parseBatchCsv(`${CSV_COLUMNS.join(",")}\n${value}`).errors.join()).toContain("unfinished or misplaced quote");
  });
  it("rejects mismatched row widths", () => {
    expect(parseBatchCsv(`${CSV_COLUMNS.join(",")}\na,b`).errors.join()).toContain("too many or too few values");
  });
  it("rejects duplicate headers", () => {
    expect(parseBatchCsv(`${CSV_COLUMNS.join(",")},filename\n`).errors.join()).toContain("repeats the ‘filename’ column");
  });
  it("rejects a header-only CSV", () => {
    expect(parseBatchCsv(CSV_COLUMNS.join(",")).errors).toContain("The CSV needs at least one label row.");
  });
});
