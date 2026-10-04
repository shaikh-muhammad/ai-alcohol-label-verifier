import { afterEach, describe, expect, it, vi } from "vitest";
import { createBatchQueue, prepareBatchQueue, createBatchVerificationRunner } from "./batch-queue";
import { createCsvTemplate, parseBatchCsv, CSV_COLUMNS } from "./batch-validation";
import { REQUIRED_GOVERNMENT_WARNING } from "./validate-government-warning";

const example = parseBatchCsv(createCsvTemplate()).rows[0];
const rows = [1, 2, 3].map((i) => ({ ...example, filename: `bourbon-00${i}.png`, brand_name: `OLD TOM ${i}` }));
const csv = [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((key) => `"${row[key].replaceAll('"', '""')}"`).join(","))].join("\n");
const images = rows.map((row) => new File(["original oversized"], row.filename, { type: "image/png" }));
const response = (brandName = "OLD TOM") => ({
  extraction: { brandName, classType: "Gin", alcoholContent: "40%", netContents: "750 mL", producerName: "Producer", producerAddress: "Address", countryOfOrigin: null, governmentWarningText: REQUIRED_GOVERNMENT_WARNING, governmentWarningHeadingBold: "yes", governmentWarningBodyBold: "no", imageQuality: { readable: true, glare: "none", perspectiveDistortion: "none", criticalTextObscured: false, reason: null } },
  verification: { overall: { status: "pass", reason: "Server result" }, fields: [], imageQuality: { status: "pass", reason: "Readable" } }, processingTimeMs: 2800,
});
async function ready() {
  return prepareBatchQueue(createBatchQueue(csv, [...images].reverse()), () => {}, async (file) => ({ blob: new Blob([`prepared ${file.name}`], { type: "image/jpeg" }), filename: file.name, originalSize: file.size, originalWidth: 100, originalHeight: 100, width: 100, height: 100 }));
}
afterEach(() => vi.unstubAllGlobals());

describe("batch verification", () => {
  it("runs two simultaneously, defers the third, never exceeds two, and ignores duplicate starts", async () => {
    let active = 0;
    let maximum = 0;
    const pending: (() => void)[] = [];
    const fetch = vi.fn((_url, options) => {
      active++;
      maximum = Math.max(maximum, active);
      const application = JSON.parse(options.body.get("application"));
      return new Promise<Response>((resolve) => pending.push(() => { active--; resolve(Response.json(response(application.brandName))); }));
    });
    vi.stubGlobal("fetch", fetch);
    const queue = await ready();
    const run = createBatchVerificationRunner();
    let latest = queue;
    const update = (items: typeof queue) => { latest = items; };
    const completion = run(queue, update);
    await run(queue, update);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(latest.map((item) => item.status)).toEqual(["checking", "checking", "queued"]);
    pending[1]();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    pending[0](); pending[2]();
    await completion;
    expect(maximum).toBe(2);
    expect(latest.every((item) => item.status === "done")).toBe(true);
    for (const [i, item] of latest.entries()) {
      expect(item.filename).toBe(rows[i].filename);
      expect(item.result?.extraction.brandName).toBe(rows[i].brand_name);
      expect(item.result?.processingTimeMs).toBe(2800);
      const [url, options] = fetch.mock.calls[i];
      expect(url).toBe("/api/verify");
      expect(options.method).toBe("POST");
      expect(Array.from(options.body.keys())).toEqual(["image", "application"]);
      expect(await options.body.get("image").text()).toBe(`prepared ${rows[i].filename}`);
      expect(JSON.parse(options.body.get("application"))).toEqual(item.application);
    }
    await run(queue, update);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([429, 502, 503, 504, "network"])("waits and retries %s, then succeeds", async (failure) => {
    const fetch = vi.fn();
    if (failure === "network") fetch.mockRejectedValueOnce(new TypeError("interrupted"));
    else fetch.mockResolvedValueOnce(new Response("busy", { status: Number(failure) }));
    fetch.mockResolvedValue(Response.json(response()));
    vi.stubGlobal("fetch", fetch);
    const sleep = vi.fn(async () => {});
    const queue = (await ready()).slice(0, 1);
    const statuses: string[] = [];
    await createBatchVerificationRunner(undefined, sleep)(queue, (items) => statuses.push(items[0].status));
    expect(statuses).toEqual(["queued", "checking", "waiting", "checking", "done"]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the final allowed attempt", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(Response.json(response()));
    vi.stubGlobal("fetch", fetch);
    const sleep = vi.fn(async () => {});
    let latest = (await ready()).slice(0, 1);
    await createBatchVerificationRunner(undefined, sleep)(latest, (items) => { latest = items; });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(latest[0].status).toBe("done");
  });

  it.each([400, 413, 415, 422, 500])("does not retry permanent HTTP %s", async (status) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: "ERROR", message: "private" } }, { status }));
    vi.stubGlobal("fetch", fetch);
    const sleep = vi.fn(async () => {});
    let latest = (await ready()).slice(0, 1);
    await createBatchVerificationRunner(undefined, sleep)(latest, (items) => { latest = items; });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(latest[0].status).toBe("error");
    expect(latest[0].result).toBeNull();
  });

  it("exhausts retries with bounded backoff while other items finish", async () => {
    const fetch = vi.fn(async (_url, options) => JSON.parse(options.body.get("application")).brandName === rows[0].brand_name ? new Response("busy", { status: 503 }) : Response.json(response()));
    vi.stubGlobal("fetch", fetch);
    const sleep = vi.fn(async () => {});
    let latest = await ready();
    await createBatchVerificationRunner(undefined, sleep)(latest, (items) => { latest = items; });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(latest.map((item) => item.status)).toEqual(["error", "done", "done"]);
    expect(latest[0].error).toBe("AI service could not complete this verification.");
    expect(latest[0].result).toBeNull();
  });

  it("a new selection creates fresh items without previous results and rejects obsolete updates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response())));
    let latest = await ready();
    await createBatchVerificationRunner()(latest, (items) => { latest = items; });
    expect(latest[0].result).not.toBeNull();
    const newSelection = createBatchQueue(csv, images);
    expect(newSelection.every((item) => item.result === null && item.status === "queued")).toBe(true);
    const update = vi.fn();
    await createBatchVerificationRunner()(await ready(), update, () => false);
    expect(update).not.toHaveBeenCalled();
  });
});
