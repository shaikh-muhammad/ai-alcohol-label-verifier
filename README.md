# AI-Powered Alcohol Label Verification

A standalone prototype for verifying alcohol beverage labels against application data. It supports single-label review and batch processing with a CSV and multiple images.

**AI extracts evidence. Deterministic code makes compliance decisions.** Gemini reads visible label text and visual evidence; it does not decide compliance or infer missing information. TypeScript rules produce **Pass**, **Needs Review**, or **Fail**, with reasons for each result. These results support human review and are not regulatory approval.

Source Code: https://github.com/shaikh-muhammad/ai-alcohol-label-verifier

Live Demo: https://ai-alcohol-label-verifier-tau.vercel.app

## Workflow and architecture

1. Enter application data and upload a label image.
2. The browser resizes and compresses the image, then sends it with the application data to this application's own Next.js API route.
3. The server calls Gemini Flash vision to extract visible evidence only and validates the structured response with Zod.
4. Deterministic TypeScript rules compare the extraction with the application and validate the warning and image quality.
5. The UI displays Pass, Needs Review, or Fail. A human reviewer may manually override a field result with a review note; the automated result remains visible.

```text
Browser (application data + prepared image)
  ↓
Next.js /api/verify
  ↓
Gemini Flash
  ↓
Structured extraction
  ↓
Deterministic TypeScript rules
  ↓
Pass / Needs Review / Fail
```

Batch processing uses the same endpoint:

```text
Browser queue (CSV + prepared images)
  ↓
max 2 concurrent /api/verify requests
```

## Tech stack

- **Next.js, React, TypeScript:** application UI, server route, and comparison rules.
- **Zod:** application-data and extraction-schema validation.
- **Google Gemini via `@google/genai`:** server-side vision extraction.
- **Vitest:** automated tests.
- **GitHub:** source control and repository review.
- **Vercel:** deployment target.

## Features and comparison behavior

### Single-label verification

Checks beverage type context (distilled spirits, wine, or beer/malt beverage), brand name, class/type, alcohol content, net contents, producer/bottler name and address, country of origin for imports, government warning, and image quality. Manual reviewer overrides can update field and image-quality decisions.

| Check | Behavior |
| --- | --- |
| General text | Normalizes case, whitespace, supported punctuation, and curly/straight apostrophes. Exact displayed matches pass; formatting-only matches need review; substantive differences fail. Arbitrary words are not removed. |
| Net contents | Equivalent supported metric volumes pass, such as `750 mL`, `75 cL`, and `0.75 L`. Unsupported values need review. |
| Alcohol content | Supports ABV formats and ABV/proof equivalence for distilled spirits only. Combined values such as `45% ABV (90 Proof)` normalize to 45% ABV when consistent; conflicting values such as `45% ABV (80 Proof)` need review. Proof conversion is not applied to wine or beer. |
| Country of origin | A dedicated comparator accepts recognized English country names and `PRODUCT OF <country>`, ignoring case and ordinary whitespace. `Canada` and `PRODUCT OF CANADA` pass; Canada versus Mexico fails. Unrecognized or ambiguous values need review. |

### Government warning

Deterministic validation checks the required statement's exact wording, heading capitalization (`GOVERNMENT WARNING:`), and punctuation, allowing ordinary whitespace differences. Vision extraction separately assesses whether the heading is bold and whether the warning body is bold. A confirmed non-bold heading or bold body fails; uncertain formatting needs review when the text otherwise passes. Missing or incorrect warning text fails.

### Image quality

Extraction assesses glare, perspective distortion, readability, and obscured critical text. Unreadable or obscured information, high glare, or high distortion triggers Needs Review and a request for a clearer image rather than guessing.

### Batch mode

Upload a CSV and multiple JPEG, PNG, or WebP images. CSV validation checks required columns, application values, duplicates, and exact filename matching before processing. Images are prepared in the browser. The queue limits verification to **two concurrent requests**, with bounded retries and backoff for eligible temporary errors. Progress includes queued, checking, waiting, done, and error states, plus image-preparation states. Results can be downloaded as CSV.

Use the UI's downloadable CSV template. Beverage values are `distilled-spirits`, `wine`, or `beer-malt-beverage`; imported rows require a country of origin.

## Run locally

Prerequisites: Node.js 20.9 or newer, npm, Git, and a Gemini API key with access to the configured model.

1. Clone this repository using its GitHub URL and enter the project folder:

   ```bash
   git clone https://github.com/shaikh-muhammad/ai-alcohol-label-verifier.git
   cd ai-alcohol-label-verifier
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment template:

   ```bash
   cp .env.example .env.local
   ```

4. Open `.env.local` and replace the placeholder for `GEMINI_API_KEY` with your own key. Optionally set `GEMINI_MODEL` to a model available to your account.
5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000). Restart the server after changing environment variables.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Required server-side Gemini API credential. Never commit a real key. |
| `GEMINI_MODEL` | Optional model identifier. The current code and `.env.example` default to `gemini-3.8-flash`; model access depends on your account. |

## Tests and checks

```bash
npm test
npm run lint
npm run build
```

The repository has **500+ automated tests** covering deterministic comparisons, government-warning validation, schemas, API validation, image preparation, retry behavior, manual review helpers, and batch validation, queueing, and CSV export. Automated tests mock Gemini and do not make real Gemini calls. Manual UI verification requires a configured API key and consumes API quota.

The production build uses Next.js/Turbopack. It needs an environment that permits its local worker processes and port binding. The application uses system fonts and has no external font dependency or build-time font downloads.

## Sample labels and reviewer evaluation

[sample-labels/](sample-labels/) contains synthetic test labels and [sample-applications.csv](sample-labels/sample-applications.csv). See the [sample pack notes](sample-labels/README.md) for intended outcomes.

Examples include a perfect label, wrong ABV, wrong volume, case-only brand difference, title-case warning heading, altered warning wording, missing warning, non-bold warning heading, glare, an angled image, an imported pass, and a country mismatch.

For a quick evaluation, run the automated checks, try single-label verification using the sample application data and images, exercise a manual override, then try batch mode and download its results. Vision-model outputs can vary slightly between runs; deterministic comparisons remain consistent for the same extracted evidence.

## Performance

The stakeholder target is approximately **5 seconds per single label**. Observed local test examples were approximately **1.5 seconds, 2.4 seconds, and 3.7 seconds**. These are illustrative observations, not a guarantee that every request finishes within five seconds. Image preparation, network conditions, model latency, and retries affect timing.

Batch throughput can be slower because of Gemini free-tier quotas, rate limits, and retries, even with two concurrent requests.

## Security and privacy

- Standalone prototype only: no database and no intentional persistent storage. Images, application data, extracted evidence, and review state are processed in memory by the application. Downloaded results are saved only when the user requests an export.
- The browser calls only this application's own API route for verification. Gemini calls happen server-side; only the label image and extraction instructions are sent to Gemini, not the entered application data.
- `GEMINI_API_KEY` is never exposed to browser code. `.env.local` is ignored by Git. Do not use `NEXT_PUBLIC_` variables for secrets.
- No application analytics or external browser-loaded fonts, scripts, or CDNs. The application uses system fonts and has no external font dependency.
- **Use synthetic/fake labels only.** Application memory-only processing does not override Google's data-use terms or hosting-provider policies.

### Gemini free developer tier

The Gemini free developer tier may use submitted content to improve Google products. Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) describe unpaid-service data use, including possible human review. Use only synthetic/fake labels for this prototype; do not upload sensitive government or personal information.

### Production and government deployment

A production federal deployment would require an appropriately approved government-compliant AI endpoint, agency security authorization, PII handling requirements, retention policies, audit/logging requirements, infrastructure and network review, and FedRAMP-related review where applicable. **This prototype is not claimed to be FedRAMP compliant.**

## Limitations

- Prototype only; not legal advice or final regulatory approval.
- Does not comprehensively implement every TTB rule.
- Physical font size cannot be reliably measured from arbitrary photographs without scale information.
- AI visual extraction can vary between runs, including boldness and image-quality assessments.
- Gemini free tier can return temporary rate or service errors; batch throughput depends on API quota.
- No COLA integration.
- No persistence or audit database; manual review state is not a durable audit record.

## Repository structure

| Path | Contents |
| --- | --- |
| `app/` | Next.js pages, React UI, styles, and `/api/verify` server route. |
| `lib/` | Extraction, schemas, deterministic rules, image preparation, manual review, and batch helpers. |
| `sample-labels/` | Synthetic image examples, application CSV, and expected-outcome notes. |
| `*.test.ts` | Tests colocated with helpers in `lib/` and the API route in `app/api/verify/`. |
| `.env.example` | Placeholder-only server environment configuration. |

## Deploy with Vercel

1. Import the GitHub repository into Vercel as a Next.js project.
2. Configure `GEMINI_API_KEY` and `GEMINI_MODEL` in the project's environment variables for the intended deployment environments.
3. Deploy, or redeploy after adding or changing environment variables.
4. Confirm the Live Demo URL above points to the production deployment.

Keep credentials server-side; never expose secrets through `NEXT_PUBLIC_` variables.

## Tools and assumptions

Codex was used as an AI-assisted development tool. The application runtime uses Gemini Flash for evidence extraction and TypeScript for deterministic decisions. The prototype assumes synthetic test data, readable label images, and a human reviewer responsible for interpreting results.
