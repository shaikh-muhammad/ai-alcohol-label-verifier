import { applicationSchema } from "./application-schema";

export const CSV_COLUMNS = [
  "filename", "beverage_type", "brand_name", "class_type", "alcohol_content",
  "net_contents", "producer_name", "producer_address", "imported_product", "country_of_origin",
] as const;
export type BatchRow = Record<(typeof CSV_COLUMNS)[number], string>;
export type BatchImage = { name: string; type: string };

export function createCsvTemplate(): string {
  const example = ["old-tom.jpg", "distilled-spirits", "OLD TOM", "Straight Bourbon", "45% ABV", "750 mL", "Old Tom Distillery", "123 Example Street, Louisville, KY", "false", ""];
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `${CSV_COLUMNS.join(",")}\r\n${example.map(escape).join(",")}\r\n`;
}

/** Fixed-template CSV reader: quoted cells, escaped quotes, BOM, and CRLF supported. */
export function parseBatchCsv(text: string): { rows: BatchRow[]; errors: string[] } {
  const records: string[][] = [];
  let record: string[] = [], cell = "", quoted = false, closed = false;
  const malformed = () => ({ rows: [], errors: ["The CSV has an unfinished or misplaced quote. Please use the downloaded template and save it as CSV."] });
  const finishCell = () => { record.push(cell); cell = ""; closed = false; };
  const finishRecord = () => {
    finishCell();
    if (record.some((value) => value.trim() !== "")) records.push(record);
    record = [];
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === ",") finishCell();
    else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (char === '"') {
      if (cell || closed) return malformed();
      quoted = true;
    } else {
      if (closed) return malformed();
      cell += char;
    }
  }
  if (quoted) return malformed();
  finishRecord();
  const headers = records.shift()?.map((value) => value.trim()) ?? [];
  const errors = CSV_COLUMNS.filter((column) => !headers.includes(column)).map((column) => `The CSV is missing the ‘${column}’ column.`);
  for (const header of new Set(headers)) {
    if (headers.filter((value) => value === header).length > 1) errors.push(`The CSV repeats the ‘${header}’ column. Keep only one.`);
  }
  if (errors.length) return { rows: [], errors };
  const rows: BatchRow[] = [];
  records.forEach((values, index) => {
    if (values.length !== headers.length) {
      errors.push(`CSV row ${index + 2} has too many or too few values. Check its commas and quote values containing commas.`);
      return;
    }
    rows.push(Object.fromEntries(CSV_COLUMNS.map((column) => [column, values[headers.indexOf(column)]])) as BatchRow);
  });
  if (!records.length) errors.push("The CSV needs at least one label row.");
  return { rows, errors };
}

const fields = {
  beverageType: "beverage_type", brandName: "brand_name", classType: "class_type",
  alcoholContent: "alcohol_content", netContents: "net_contents", producerName: "producer_name",
  producerAddress: "producer_address", importedProduct: "imported_product", countryOfOrigin: "country_of_origin",
} as const;

export function validateBatch(csv: string | null, images: readonly BatchImage[]) {
  const parsed = csv === null ? { rows: [], errors: ["Choose one CSV file."] } : parseBatchCsv(csv);
  const errors = [...parsed.errors];
  if (!images.length) errors.push("Choose at least one label image.");
  const filenames = new Set<string>();
  parsed.rows.forEach((row, index) => {
    const label = row.filename || `CSV row ${index + 2}`;
    if (!row.filename.trim()) errors.push(`CSV row ${index + 2} needs a filename.`);
    else {
      if (filenames.has(row.filename)) errors.push(`Duplicate filename: ${row.filename}.`);
      filenames.add(row.filename);
    }
    const booleanText = row.imported_product.trim().toLowerCase();
    if (!["true", "false", "yes", "no", "1", "0"].includes(booleanText)) {
      errors.push(`${label}: imported_product must be true/false, yes/no, or 1/0.`);
    }
    const data = Object.fromEntries(Object.entries(fields).map(([field, column]) => [field,
      field === "importedProduct" ? ["true", "yes", "1"].includes(booleanText) : row[column],
    ]));
    const result = applicationSchema.safeParse(data);
    if (!result.success) for (const issue of result.error.issues) {
      const column = fields[issue.path[0] as keyof typeof fields];
      if (column === "beverage_type") errors.push(`${label}: beverage_type must be distilled-spirits, wine, or beer-malt-beverage.`);
      else if (column === "country_of_origin" && !row.country_of_origin.trim()) errors.push(`${label}: imported products need country_of_origin.`);
      else errors.push(`${label}: check ‘${column}’; enter a nonblank value within the single-label form’s length limit.`);
    }
  });
  const uploaded = new Set<string>();
  for (const image of images) {
    if (uploaded.has(image.name)) errors.push(`Duplicate uploaded image filename: ${image.name}.`);
    uploaded.add(image.name);
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) errors.push(`${image.name} has an unsupported image type. Choose JPEG, PNG, or WebP.`);
    if (!parsed.errors.length && !filenames.has(image.name)) errors.push(`${image.name} was uploaded but does not appear in the CSV.`);
  }
  for (const filename of filenames) {
    if (!uploaded.has(filename)) errors.push(`${filename} is listed in the CSV but was not uploaded.`);
  }
  return { rows: parsed.rows, errors, ready: errors.length === 0 };
}
