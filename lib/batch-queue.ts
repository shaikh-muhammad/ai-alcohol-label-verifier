import { applicationSchema } from "./application-schema";
import { batchApplicationData, validateBatch } from "./batch-validation";
import type { ApplicationData } from "./evaluate-verification";
import { createVerificationRequest, requestLabelVerification, VerificationUiError, type VerifyLabelResponse } from "./verify-label-client";
import { prepareImage } from "./prepare-image";

export type BatchQueueItem = {
  filename: string;
  application: ApplicationData;
  originalImage: File;
  preparedImage: Blob | null;
  status: "queued" | "preparing" | "ready" | "checking" | "waiting" | "done" | "error";
  error: string | null;
  result: VerifyLabelResponse | null;
};

export const PREPARATION_ERROR = "Could not prepare this image. Please replace it with a valid JPEG, PNG, or WebP image.";

export function createBatchQueue(csv: string, images: readonly File[]): BatchQueueItem[] {
  const validation = validateBatch(csv, images);
  if (!validation.ready) throw new Error("Fix batch validation problems before preparing images.");
  const byFilename = new Map(images.map((image) => [image.name, image]));
  return validation.rows.map((row) => ({
    filename: row.filename,
    application: applicationSchema.parse(batchApplicationData(row)),
    originalImage: byFilename.get(row.filename)!,
    preparedImage: null,
    status: "queued",
    error: null,
    result: null,
  }));
}

/** Sequential, browser-only preparation. Each failure belongs to its own item. */
export async function prepareBatchQueue(
  queue: readonly BatchQueueItem[],
  onUpdate: (queue: BatchQueueItem[]) => void,
  prepare = prepareImage,
  isCurrent: () => boolean = () => true,
): Promise<BatchQueueItem[]> {
  const items = queue.map((item) => ({ ...item }));
  for (let index = 0; index < items.length; index++) {
    if (!isCurrent()) break;
    items[index] = { ...items[index], status: "preparing", error: null };
    onUpdate([...items]);
    try {
      const prepared = await prepare(items[index].originalImage);
      items[index] = { ...items[index], preparedImage: prepared.blob, status: "ready" };
    } catch {
      items[index] = { ...items[index], preparedImage: null, status: "error", error: PREPARATION_ERROR };
    }
    if (!isCurrent()) break;
    onUpdate([...items]);
  }
  return items;
}

export const BATCH_VERIFICATION_ERROR = "AI service could not complete this verification.";

export function createBatchVerificationRequest(item: BatchQueueItem): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(item.application)) {
    form.set(key, typeof value === "boolean" ? (value ? "on" : "") : value ?? "");
  }
  return createVerificationRequest(form, item.preparedImage);
}

/** Two workers share a cursor. A waiting retry retains its worker slot. */
export function createBatchVerificationRunner(
  request = requestLabelVerification,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let started = false;
  return async function run(
    queue: readonly BatchQueueItem[],
    onUpdate: (items: BatchQueueItem[]) => void,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (started || queue.length === 0 || !queue.every((item) => item.status === "ready" && item.preparedImage?.size)) return;
    started = true;
    const items = queue.map((item): BatchQueueItem => ({ ...item, status: "queued", result: null, error: null }));
    const publish = () => { if (isCurrent()) onUpdate([...items]); };
    publish();
    let next = 0;
    async function worker() {
      while (isCurrent() && next < items.length) {
        const index = next++;
        for (let attempt = 0; attempt < 3 && isCurrent(); attempt++) {
          items[index] = { ...items[index], status: "checking" };
          publish();
          try {
            const result = await request(createBatchVerificationRequest(items[index]));
            items[index] = { ...items[index], status: "done", result, error: null };
            publish();
            break;
          } catch (error) {
            if (error instanceof VerificationUiError && error.retryable && attempt < 2) {
              items[index] = { ...items[index], status: "waiting" };
              publish();
              await sleep(1000 * 2 ** attempt);
            } else {
              items[index] = { ...items[index], status: "error", error: error instanceof VerificationUiError && !error.retryable ? error.message : BATCH_VERIFICATION_ERROR };
              publish();
              break;
            }
          }
        }
      }
    }
    await Promise.all([worker(), worker()]);
  };
}
