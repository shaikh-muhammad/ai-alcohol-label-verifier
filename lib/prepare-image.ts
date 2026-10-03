export async function prepareImage(file: File) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const source = new Image();
    source.src = sourceUrl;
    await source.decode();

    const originalWidth = source.naturalWidth;
    const originalHeight = source.naturalHeight;
    const scale = Math.min(1, 1600 / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable.");

    // JPEG has no transparency, so give transparent labels a white background.
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Image preparation failed."));
      }, "image/jpeg", 0.9);
    });

    return {
      filename: file.name,
      originalSize: file.size,
      originalWidth,
      originalHeight,
      width,
      height,
      blob,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

