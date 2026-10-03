import { applicationSchema } from "./application-schema";
import { batchApplicationData, validateBatch } from "./batch-validation";
import type { ApplicationData } from "./evaluate-verification";
import { prepareImage } from "./prepare-image";

export type BatchQueueItem = {
  filename: string;
  application: ApplicationData;
  originalImage: File;
  preparedImage: Blob | null;
  status: "queued" | "preparing" | "ready" | "error";
  error: string | null;
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
