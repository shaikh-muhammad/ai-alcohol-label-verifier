import { afterEach, describe, expect, it, vi } from "vitest";
import { createCsvTemplate, parseBatchCsv, CSV_COLUMNS } from "./batch-validation";
import { createBatchQueue, prepareBatchQueue, PREPARATION_ERROR } from "./batch-queue";

const example = parseBatchCsv(createCsvTemplate()).rows[0];
const rows = [0, 1, 2].map((index) => ({ ...example, filename: `bourbon-00${index + 1}.png`, brand_name: `OLD TOM ${index + 1}` }));
const csv = [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((column) => `"${row[column].replaceAll('"', '""')}"`).join(","))].join("\n");
const images = rows.map((row) => new File([row.filename], row.filename, { type: "image/png" }));
const prepared = (file: File) => ({ filename: file.name, originalSize: file.size, originalWidth: 2000, originalHeight: 1000, width: 1600, height: 800, blob: new Blob([file.name], { type: "image/jpeg" }) });
afterEach(() => vi.unstubAllGlobals());

describe("batch preparation queue", () => {
  it("creates queued items and matches images by filename rather than upload order", () => {
    const queue = createBatchQueue(csv, [...images].reverse());
    queue.forEach((item, index) => {
      expect(item.status).toBe("queued");
      expect(item.filename).toBe(rows[index].filename);
      expect(item.originalImage).toBe(images[index]);
      expect(item.application.brandName).toBe(rows[index].brand_name);
      expect(item.application.importedProduct).toBe(false);
      expect(item.preparedImage).toBeNull();
      expect(item.error).toBeNull();
    });
  });

  it("rejects invalid batches", () => {
    expect(() => createBatchQueue(csv, images.slice(1))).toThrow("validation");
  });

  it("prepares sequentially, reports transitions, and keeps the application and filename associated", async () => {
    const queue = createBatchQueue(csv, images);
    const update = vi.fn<(items: import("./batch-queue").BatchQueueItem[]) => void>();
    const prepare = vi.fn(async (file: File) => prepared(file));
    const result = await prepareBatchQueue(queue, update, prepare);
    expect(prepare.mock.calls.map(([file]) => file)).toEqual(images);
    expect(update.mock.calls.map(([items]) => items.map((item) => item.status))).toEqual([
      ["preparing", "queued", "queued"], ["ready", "queued", "queued"],
      ["ready", "preparing", "queued"], ["ready", "ready", "queued"],
      ["ready", "ready", "preparing"], ["ready", "ready", "ready"],
    ]);
    for (const [index, item] of result.entries()) {
      expect(item.status).toBe("ready");
      expect(item.application).toBe(queue[index].application);
      expect(item.filename).toBe(images[index].name);
      expect(item.originalImage).toBe(images[index]);
      expect(await item.preparedImage?.text()).toBe(images[index].name);
    }
    expect(queue.every((item) => item.status === "queued")).toBe(true);
  });

  it("marks a failed image as error and continues preparing later images", async () => {
    const result = await prepareBatchQueue(createBatchQueue(csv, images), vi.fn(), async (file) => {
      if (file === images[1]) throw new Error("private decoder details");
      return prepared(file);
    });
    expect(result.map((item) => item.status)).toEqual(["ready", "error", "ready"]);
    expect(result[1].error).toBe(PREPARATION_ERROR);
    expect(result[1].preparedImage).toBeNull();
  });

  it("makes no network request when using the real browser image preparation helper", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = 2000;
      naturalHeight = 1000;
      async decode() {}
    });
    vi.stubGlobal("document", { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["jpeg"], { type: "image/jpeg" })),
    }) });
    const result = await prepareBatchQueue(createBatchQueue(csv, images), vi.fn());
    expect(result.every((item) => item.status === "ready")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops an obsolete selection without publishing its prepared image", async () => {
    let current = true;
    const update = vi.fn<(items: import("./batch-queue").BatchQueueItem[]) => void>();
    const prepare = vi.fn(async (file: File) => { current = false; return prepared(file); });
    await prepareBatchQueue(createBatchQueue(csv, images), update, prepare, () => current);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
