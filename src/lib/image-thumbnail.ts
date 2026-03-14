const MAX_THUMBNAIL_SIZE = 600;

interface ThumbnailResult {
  thumbnail: File;
  previewUrl: string;
  isOriginal: boolean;
}

/**
 * Generates a thumbnail from an image file using canvas.
 * If the image is already within the max dimensions, returns the original file.
 */
export async function generateThumbnail(
  file: File,
  maxSize = MAX_THUMBNAIL_SIZE,
): Promise<ThumbnailResult> {
  const img = await loadImage(file);
  const { width, height } = img;

  if (width <= maxSize && height <= maxSize) {
    return {
      thumbnail: file,
      previewUrl: URL.createObjectURL(file),
      isOriginal: true,
    };
  }

  const scale = maxSize / Math.max(width, height);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const hasAlpha = file.type === "image/png";
  const outputType = hasAlpha ? "image/png" : "image/jpeg";
  const quality = hasAlpha ? undefined : 0.8;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      outputType,
      quality,
    );
  });

  const ext = hasAlpha ? ".png" : ".jpg";
  const thumbName = file.name.replace(/\.[^.]+$/, `_thumb${ext}`);
  const thumbnailFile = new File([blob], thumbName, { type: outputType });

  return {
    thumbnail: thumbnailFile,
    previewUrl: URL.createObjectURL(thumbnailFile),
    isOriginal: false,
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}
