"use client";

import { useEffect, useRef, useState } from "react";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type PreparedImage = {
  filename: string;
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  blob: Blob;
  url: string;
};

async function prepareImage(file: File) {
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

export default function LabelImageUpload({
  onPreparedImage,
  disabled = false,
}: {
  onPreparedImage: (image: Blob | null) => void;
  disabled?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionId = useRef(0);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => { selectionId.current += 1; };
  }, []);

  // Release the browser's preview URL when the image is replaced or removed.
  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.url);
    };
  }, [image]);

  async function selectImage(files: FileList | null) {
    if (disabled) return;
    if (!files || files.length === 0) return;

    // Only the most recent selection may update the preview.
    const currentSelection = ++selectionId.current;
    setIsProcessing(false);

    if (files.length > 1) {
      setError("Please choose one label image at a time.");
      return;
    }

    const file = files[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("This file type is not supported. Please choose a JPEG, PNG, or WebP image.");
      return;
    }

    setError("");
    setImage(null);
    onPreparedImage(null);
    setIsProcessing(true);

    try {
      const prepared = await prepareImage(file);
      if (currentSelection !== selectionId.current) return;
      setImage({ ...prepared, url: URL.createObjectURL(prepared.blob) });
      onPreparedImage(prepared.blob);
    } catch {
      if (currentSelection === selectionId.current) {
        setError("We could not prepare this image. Please try another JPEG, PNG, or WebP image.");
      }
    } finally {
      if (currentSelection === selectionId.current) setIsProcessing(false);
    }
  }

  return (
    <section className="label-image-section" aria-labelledby="label-image-heading">
      <h2 id="label-image-heading" className="text-2xl font-semibold">
        Label Image
      </h2>
      <p id="label-image-help">
        Choose one JPEG, PNG, or WebP image. The prepared image is sent for verification only when you select Verify Label.
      </p>
      <input
        ref={fileInput}
        type="file"
        disabled={disabled}
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choose a label image"
        hidden
        onChange={(event) => {
          selectImage(event.target.files);
          // Allow the same file to be chosen again after removing it.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        className="image-upload-area"
        aria-describedby="label-image-help"
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          selectImage(event.dataTransfer.files);
        }}
      >
        Choose a label image
        <span>or drag and drop an image here</span>
      </button>
      {isProcessing && <p role="status">Preparing your image…</p>}
      {error && <p role="alert">Error: {error}</p>}
      {image && (
        <div className="image-preview">
          {/* A browser-local blob URL needs no server-side image processing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="Preview of the selected alcohol label"
            onError={() => setError("This image could not be displayed. Please choose another JPEG, PNG, or WebP image.")}
          />
          <p className="image-file-details" aria-live="polite">
            {image.filename}
          </p>
          <p>
            <strong>Original:</strong><br />
            {image.originalWidth} × {image.originalHeight} pixels<br />
            {formatFileSize(image.originalSize)}
          </p>
          <p>
            <strong>Prepared for verification:</strong><br />
            {image.width} × {image.height} pixels<br />
            {formatFileSize(image.blob.size)} (JPEG)
          </p>
          <button
            type="button"
            disabled={disabled}
            className="remove-image-button"
            onClick={() => {
              selectionId.current += 1;
              setImage(null);
              onPreparedImage(null);
              setIsProcessing(false);
              setError("");
            }}
          >
            Remove image
          </button>
        </div>
      )}
    </section>
  );
}
