import { afterEach, expect, it, vi } from "vitest";
import { prepareImage } from "./prepare-image";

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

it.each([[3200, 1600, 1600, 800], [800, 2400, 533, 1600], [400, 200, 400, 200]])(
  "prepares %sx%s as %sx%s without enlargement", async (originalWidth, originalHeight, width, height) => {
    const source = { src: "", naturalWidth: originalWidth, naturalHeight: originalHeight, decode: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("Image", class { constructor() { return source; } });
    const context = { fillStyle: "", imageSmoothingQuality: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toBlob: vi.fn((callback: (blob: Blob) => void) => callback(blob)) };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const file = new File(["original"], "label.png", { type: "image/png" });
    const result = await prepareImage(file);
    expect(result).toMatchObject({ filename: file.name, originalWidth, originalHeight, width, height, blob });
    expect(context.fillStyle).toBe("white");
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, width, height);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
    expect(revoke).toHaveBeenCalledWith(source.src);
  },
);

it("releases the source URL when decoding fails", async () => {
  vi.stubGlobal("Image", class { src = ""; async decode() { throw new Error("Invalid image"); } });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  await expect(prepareImage(new File(["broken"], "broken.png"))).rejects.toThrow("Invalid image");
  expect(revoke).toHaveBeenCalledOnce();
});
