"use client";

import { useRef, useState } from "react";
import { createCsvTemplate, validateBatch } from "../lib/batch-validation";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([createCsvTemplate()], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "label-verification-template.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function BatchVerification() {
  const [csv, setCsv] = useState<string | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const selection = useRef(0);
  const validation = validateBatch(csv, images);

  async function selectCsv(file: File | undefined) {
    const current = ++selection.current;
    setCsv(null);
    setFileError("");
    setReading(false);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setFileError("Choose a CSV file saved with a .csv filename.");
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (selection.current === current) setCsv(text);
    } catch {
      if (selection.current === current) setFileError("We couldn’t read that CSV. Please select it again or save a new copy.");
    } finally {
      if (selection.current === current) setReading(false);
    }
  }

  return <section aria-labelledby="batch-heading" className="flex flex-col gap-6">
    <h2 id="batch-heading" className="text-2xl font-semibold">Batch Verification</h2>
    <p>Prepare and validate a batch. CSV and images stay in browser memory until refresh. Nothing is uploaded, and AI processing is not available in this step.</p>
    <button type="button" className="remove-image-button" onClick={downloadTemplate}>Download CSV Template</button>
    <p id="batch-help">Match each CSV filename to the image’s exact filename, including capitalization and extension. Use beverage_type: distilled-spirits, wine, or beer-malt-beverage. Use imported_product: true/false, yes/no, or 1/0. Country is required for imports.</p>
    <div className="form-field">
      <label htmlFor="batch-csv">CSV file</label>
      <input id="batch-csv" type="file" accept=".csv,text/csv" aria-describedby="batch-help" onChange={(event) => { void selectCsv(event.target.files?.[0]); }} />
    </div>
    <div className="form-field">
      <label htmlFor="batch-images">Label images (JPEG, PNG, WebP)</label>
      <input id="batch-images" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-describedby="batch-help" onChange={(event) => setImages(Array.from(event.target.files ?? []))} />
      <p>{images.length} images selected. A new selection replaces the current images.</p>
    </div>
    <div role="status" aria-live="polite">
      {reading ? <p>Reading CSV…</p> : validation.ready && !fileError ? <p className="font-semibold">Ready to process: {validation.rows.length} {validation.rows.length === 1 ? "label" : "labels"}</p> : <>
        <p className="font-semibold">Batch has problems that must be fixed.</p>
        <ul className="list-disc pl-6 break-words">{[fileError, ...validation.errors].filter(Boolean).map((error, index) => <li key={index}>{error}</li>)}</ul>
      </>}
    </div>
    {!reading && !fileError && validation.ready && <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="mb-3 text-left">Batch preview — input validation only; no regulatory or AI results.</caption>
        <thead><tr>{["Filename", "Brand name", "Beverage type", "Validation status"].map((heading) => <th scope="col" key={heading} className="border-b p-2">{heading}</th>)}</tr></thead>
        <tbody>{validation.rows.map((row) => <tr key={row.filename}><td className="p-2 break-all">{row.filename}</td><td className="p-2">{row.brand_name}</td><td className="p-2">{row.beverage_type}</td><td className="p-2">Ready</td></tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
