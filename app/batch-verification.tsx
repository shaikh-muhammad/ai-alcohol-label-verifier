"use client";

import { useEffect, useRef, useState } from "react";
import { createCsvTemplate, validateBatch } from "../lib/batch-validation";
import { createBatchResultsCsv, RESULTS_CSV_FILENAME } from "../lib/batch-results-csv";

import { createBatchQueue, prepareBatchQueue, createBatchVerificationRunner, type BatchQueueItem } from "../lib/batch-queue";

function downloadTemplate() {
  downloadCsv(createCsvTemplate(), "label-verification-template.csv");
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function BatchVerification() {
  const [csv, setCsv] = useState<string | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const selection = useRef(0);
  const preparation = useRef(0);
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [started, setStarted] = useState(false);
  const runner = useRef(createBatchVerificationRunner());
  const active = useRef(false);

  async function verifyBatch() {
    if (active.current || started || preparing) return;
    active.current = true;
    setProcessing(true);
    setStarted(true);
    const current = preparation.current;
    try {
      await runner.current(queue, setQueue, () => preparation.current === current);
    } finally {
      if (preparation.current === current) { active.current = false; setProcessing(false); }
    }
  }
  useEffect(() => () => { preparation.current += 1; }, []);

  function clearQueue() {
    preparation.current += 1;
    setQueue([]);
    runner.current = createBatchVerificationRunner();
    active.current = false;
    setProcessing(false);
    setStarted(false);
    setPreparing(false);
  }

  async function prepareBatch() {
    if (preparing || reading || fileError || !validation.ready || csv === null) return;
    const current = ++preparation.current;
    const items = createBatchQueue(csv, images);
    setQueue(items);
    setPreparing(true);
    try {
      await prepareBatchQueue(items, setQueue, undefined, () => preparation.current === current);
    } finally {
      if (preparation.current === current) setPreparing(false);
    }
  }

  const validation = validateBatch(csv, images);

  async function selectCsv(file: File | undefined) {
    clearQueue();
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
    <p>Validate and prepare a batch, then verify up to two labels at a time. Prepared images are uploaded only when you start verification. Batch results stay in browser memory until a new selection or refresh.</p>
    <button type="button" className="remove-image-button" onClick={downloadTemplate}>Download CSV Template</button>
    <p id="batch-help">Match each CSV filename to the image’s exact filename, including capitalization and extension. Use beverage_type: distilled-spirits, wine, or beer-malt-beverage. Use imported_product: true/false, yes/no, or 1/0. Country is required for imports.</p>
    <div className="form-field">
      <label htmlFor="batch-csv">CSV file</label>
      <input id="batch-csv" disabled={processing} type="file" accept=".csv,text/csv" aria-describedby="batch-help" onChange={(event) => { void selectCsv(event.target.files?.[0]); }} />
    </div>
    <div className="form-field">
      <label htmlFor="batch-images">Label images (JPEG, PNG, WebP)</label>
      <input id="batch-images" disabled={processing} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-describedby="batch-help" onChange={(event) => { clearQueue(); setImages(Array.from(event.target.files ?? [])); }} />
      <p>{images.length} images selected. A new selection replaces the current images.</p>
    </div>
    <div role="status" aria-live="polite">
      {reading ? <p>Reading CSV…</p> : validation.ready && !fileError ? <p className="font-semibold">Batch validation passed: {validation.rows.length} {validation.rows.length === 1 ? "label" : "labels"}</p> : <>
        <p className="font-semibold">Batch has problems that must be fixed.</p>
        <ul className="list-disc pl-6 break-words">{[fileError, ...validation.errors].filter(Boolean).map((error, index) => <li key={index}>{error}</li>)}</ul>
      </>}
    </div>
    {!reading && !fileError && validation.ready && queue.length === 0 && <button type="button" className="remove-image-button" onClick={() => { void prepareBatch(); }}>Prepare Batch</button>}
    {!started && !preparing && queue.length > 0 && queue.every((item) => item.status === "ready") && <button type="button" className="remove-image-button" onClick={() => { void verifyBatch(); }}>Verify Batch</button>}
    {started && <div role="status" aria-live="polite">
      <p>{processing ? `Checking labels: ${queue.filter((item) => item.status === "done" || item.status === "error").length} / ${queue.length} complete` : "Batch verification complete"}</p>
      <p>{["queued", "checking", "waiting", "done", "error"].map((status) => `${status[0].toUpperCase() + status.slice(1)}: ${queue.filter((item) => item.status === status).length}`).join(" · ")}</p>
      {!processing && <p>{queue.filter((item) => item.status === "done").length} processed · {queue.filter((item) => item.result?.verification.overall.status === "pass").length} Pass · {queue.filter((item) => item.result?.verification.overall.status === "needs_review").length} Needs Review · {queue.filter((item) => item.result?.verification.overall.status === "fail").length} Fail · {queue.filter((item) => item.status === "error").length} Errors</p>}
    </div>}
    {started && !processing && queue.some((item) => item.status === "done" || item.status === "error") && <button type="button" className="remove-image-button" onClick={() => downloadCsv(createBatchResultsCsv(queue), RESULTS_CSV_FILENAME)}>Download Results CSV</button>}
    {queue.length > 0 && <div role="status" aria-live="polite">
      {started ? null : preparing ? <p>Preparing images: {queue.filter((item) => item.status === "ready" || item.status === "error").length} / {queue.length}</p>
        : queue.every((item) => item.status === "ready") ? <p>{queue.length} {queue.length === 1 ? "label" : "labels"} ready for verification</p>
        : <p>Image preparation complete: {queue.filter((item) => item.status === "ready").length} ready, {queue.filter((item) => item.status === "error").length} errors. Replace the invalid images to prepare a new batch.</p>}
      <ul>{queue.map((item) => <li key={item.filename} className="break-words">
        {item.filename} — {item.status === "ready" ? "Queued" : item.status[0].toUpperCase() + item.status.slice(1)}
        {item.status === "waiting" && <p>Waiting — AI service is temporarily busy</p>}
        {item.result && <p>{({ pass: "✓ Pass", needs_review: "⚠ Needs Review", fail: "✗ Fail" })[item.result.verification.overall.status]} · {(item.result.processingTimeMs / 1000).toFixed(1)} seconds</p>}
        {item.error && <p>{item.error}</p>}
      </li>)}</ul>
    </div>}
    {!reading && !fileError && validation.ready && <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="mb-3 text-left">Batch preview — input validation only; no regulatory or AI results.</caption>
        <thead><tr>{["Filename", "Brand name", "Beverage type", "Validation status"].map((heading) => <th scope="col" key={heading} className="border-b p-2">{heading}</th>)}</tr></thead>
        <tbody>{validation.rows.map((row) => <tr key={row.filename}><td className="p-2 break-all">{row.filename}</td><td className="p-2">{row.brand_name}</td><td className="p-2">{row.beverage_type}</td><td className="p-2">Ready</td></tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
