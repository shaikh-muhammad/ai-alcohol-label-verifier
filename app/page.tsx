"use client";

import { useCallback, useReducer, useRef, useState, type FormEvent } from "react";
import LabelImageUpload from "./label-image-upload";
import { createVerificationRequest, requestLabelVerification, VerificationUiError, type VerifyLabelResponse } from "../lib/verify-label-client";
import { finalReviewedStatus, manualReviewReducer, type ManualDecision, type ReviewStatus } from "../lib/manual-review";

const statusLabels = { pass: "✓ Pass", needs_review: "⚠ Needs Review", fail: "✕ Fail" };

function FieldReview({ fieldName, automatedStatus, decision, onDecision }: {
  fieldName: string;
  automatedStatus: ReviewStatus;
  decision?: ManualDecision;
  onDecision: (decision: ManualDecision) => void;
}) {
  const [note, setNote] = useState(decision?.note ?? "");
  return (
    <>
      {decision && <div aria-live="polite">
        <p className="font-semibold">Manual decision: {statusLabels[decision.manualStatus]}</p>
        {decision.note && <p className="whitespace-pre-wrap">Review note: {decision.note}</p>}
      </div>}
      {automatedStatus !== "pass" && <details className="mt-4">
        <summary className="cursor-pointer font-semibold">Review Result<span className="sr-only"> for {fieldName}</span></summary>
        <div className="form-field mt-3">
          <label>
            Review note (optional)
            <input type="text" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <p>Choose a decision to apply it with your note. Reviews last only until a new verification or page refresh.</p>
          <div className="flex flex-wrap gap-2">
            {([
              ["pass", "Accept / Pass"],
              ["needs_review", "Keep as Needs Review"],
              ["fail", "Mark as Fail"],
            ] as const).map(([manualStatus, label]) => (
              <button type="button" key={manualStatus} className="remove-image-button" onClick={() => onDecision({ manualStatus, note: note.trim() })}>{label}</button>
            ))}
          </div>
        </div>
      </details>}
    </>
  );
}

export default function Home() {
  const [isImported, setIsImported] = useState(false);
  const [processedImage, setProcessedImage] = useState<Blob | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VerifyLabelResponse | null>(null);
  const [manualReviews, dispatchReview] = useReducer(manualReviewReducer, {});
  const requestInFlight = useRef(false);

  const onPreparedImage = useCallback((image: Blob | null) => {
    setProcessedImage(image);
    setResult(null);
    dispatchReview({ type: "reset" });
    setError("");
  }, []);

  async function verifyLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    setError("");
    setResult(null);
    dispatchReview({ type: "reset" });
    let body: FormData;
    try {
      body = createVerificationRequest(new FormData(event.currentTarget), processedImage);
    } catch (error: unknown) {
      setError(error instanceof VerificationUiError ? error.message : "Please check the application fields and label image.");
      return;
    }
    requestInFlight.current = true;
    setIsVerifying(true);
    try {
      setResult(await requestLabelVerification(body));
    } catch (error: unknown) {
      setError(error instanceof VerificationUiError ? error.message : "We couldn’t complete this verification. Please try again.");
    } finally {
      requestInFlight.current = false;
      setIsVerifying(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">
        Alcohol Label Verification
      </h1>
      <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        AI-assisted prototype for reviewing alcohol beverage label information.
      </p>
      <section aria-labelledby="single-label-heading">
        <h2 id="single-label-heading" className="text-2xl font-semibold">
          Single Label Verification
        </h2>
        <form id="single-label-form" className="application-form" onSubmit={verifyLabel} onChange={() => {
          setResult(null);
          dispatchReview({ type: "reset" });
          setError("");
        }}>
          <fieldset className="application-fields" disabled={isVerifying}>
          <div className="form-field">
            <label htmlFor="beverage-type">Beverage Type</label>
            <select id="beverage-type" name="beverageType">
              <option value="distilled-spirits">Distilled Spirits</option>
              <option value="wine">Wine</option>
              <option value="beer-malt-beverage">Beer / Malt Beverage</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="brand-name">Brand Name</label>
            <input id="brand-name" name="brandName" type="text" required maxLength={500} />
          </div>
          <div className="form-field">
            <label htmlFor="class-type">Class / Type</label>
            <input id="class-type" name="classType" type="text" required maxLength={500} />
          </div>
          <div className="form-field">
            <label htmlFor="alcohol-content">Alcohol Content</label>
            <input id="alcohol-content" name="alcoholContent" type="text" placeholder="45% ABV or 90 proof" required maxLength={100} />
          </div>
          <div className="form-field">
            <label htmlFor="net-contents">Net Contents</label>
            <input id="net-contents" name="netContents" type="text" placeholder="750 mL" required maxLength={100} />
          </div>
          <div className="form-field">
            <label htmlFor="producer-name">Producer / Bottler Name</label>
            <input id="producer-name" name="producerName" type="text" required maxLength={500} />
          </div>
          <div className="form-field">
            <label htmlFor="producer-address">Producer / Bottler Address</label>
            <input id="producer-address" name="producerAddress" type="text" required maxLength={1000} />
          </div>
          <label className="checkbox-field" htmlFor="imported-product">
            <input
              id="imported-product"
              name="importedProduct"
              type="checkbox"
              checked={isImported}
              onChange={(event) => setIsImported(event.target.checked)}
            />
            Imported Product
          </label>
          {isImported && (
            <div className="form-field">
              <label htmlFor="country-of-origin">Country of Origin</label>
              <input id="country-of-origin" name="countryOfOrigin" type="text" required maxLength={200} />
            </div>
          )}
          </fieldset>
        </form>
      </section>
      <LabelImageUpload onPreparedImage={onPreparedImage} disabled={isVerifying} />
      <button type="submit" form="single-label-form" className="verify-label-button" disabled={isVerifying}>
        {isVerifying ? "Checking Label…" : "Verify Label"}
      </button>
      {isVerifying && <p role="status">Reading and checking the label…</p>}
      {error && <p role="alert" className="verification-notice">{error}</p>}
      {result && (
        <section className="verification-results" aria-labelledby="overall-result-heading">
          <div role="status">
            <h2 id="overall-result-heading" className="text-2xl font-semibold">Automated Result</h2>
            <p className="text-2xl font-semibold">{statusLabels[result.verification.overall.status]}</p>
            <p>Verification completed in {(result.processingTimeMs / 1000).toFixed(1)} seconds</p>
          </div>
          <p>{result.verification.overall.reason}</p>
          {Object.keys(manualReviews).length > 0 && <div role="status">
            <h2 className="text-2xl font-semibold">Final Reviewed Result</h2>
            <p className="text-2xl font-semibold">{statusLabels[finalReviewedStatus(result.verification, manualReviews)]}</p>
            <p>Uses manual decisions where provided and automated statuses for all other fields.</p>
          </div>}
          {result.verification.imageQuality.status === "needs_review" && (
            <p className="verification-notice">We couldn’t confidently read all required label information. Please upload a clearer image with less glare and a straighter angle.</p>
          )}
          <ul className="verification-field-list">
            {result.verification.fields.map((field) => (
              <li key={field.field} className="verification-field">
                <h3 className="font-semibold">{field.fieldName}</h3>
                <p className="font-semibold">Automated result: {statusLabels[field.status]}</p>
                <p>Reason: {field.reason}</p>
                <dl className="verification-values">
                  {field.applicationValue !== undefined && <><dt>Application value</dt><dd>{field.applicationValue}</dd></>}
                  <dt>Label value</dt><dd>{field.extractedValue ?? "Could not confidently read"}</dd>
                </dl>
                <FieldReview fieldName={field.fieldName} automatedStatus={field.status} decision={manualReviews[field.field]} onDecision={(decision) => dispatchReview({ type: "decide", field: field.field, decision })} />
              </li>
            ))}
            <li className="verification-field">
              <h3 className="font-semibold">Image Quality</h3>
              <p className="font-semibold">Automated result: {statusLabels[result.verification.imageQuality.status]}</p>
              <p>Reason: {result.verification.imageQuality.reason}</p>
              {result.verification.imageQuality.status === "needs_review" && <p>Accept only if you can independently read and confirm the required information. If evidence is unreadable or obscured, upload a clearer image.</p>}
              <FieldReview fieldName="Image Quality" automatedStatus={result.verification.imageQuality.status} decision={manualReviews.imageQuality} onDecision={(decision) => dispatchReview({ type: "decide", field: "imageQuality", decision })} />
            </li>
          </ul>
        </section>
      )}
    </main>
  );
}
