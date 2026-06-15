type UploadWorkerRequest =
  | { id: number; type: 'hash'; file: File }
  | {
      id: number;
      type: 'image-thumbnail';
      file: File;
      maxSide: number;
      quality: number;
      watermarkText: string;
    }
  | {
      id: number;
      type: 'compress-image';
      file: File;
      clientMaxBytes: number;
      targetMaxBytes: number;
      maxSide: number;
      minSide: number;
      qualities: number[];
    };

type UploadWorkerResponse =
  | { id: number; ok: true; result: string | File | null }
  | { id: number; ok: false; error: string };

function post(response: UploadWorkerResponse) {
  self.postMessage(response);
}

function assertImageWorkerSupport() {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Image worker APIs unavailable.');
  }
}

async function calculateHash(file: File) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function canvasToJpegFile(canvas: OffscreenCanvas, fileName: string, quality: number) {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new File([blob], fileName, { type: 'image/jpeg' });
}

async function generateImageThumbnail(input: Extract<UploadWorkerRequest, { type: 'image-thumbnail' }>) {
  assertImageWorkerSupport();
  const bitmap = await createImageBitmap(input.file);
  try {
    const scale = Math.min(1, input.maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(-Math.PI / 6);
    const watermarkFontSize = Math.max(14, Math.round(Math.min(width, height) / 16));
    const watermarkStepX = Math.max(180, Math.round(width / 2.6));
    const watermarkStepY = Math.max(92, Math.round(height / 4.8));
    const watermarkBounds = Math.hypot(width, height);
    context.font = `900 ${watermarkFontSize}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(255,255,255,0.20)';
    context.strokeStyle = 'rgba(0,0,0,0.22)';
    context.lineWidth = Math.max(1, Math.min(width, height) / 360);
    for (let y = -watermarkBounds; y <= watermarkBounds; y += watermarkStepY) {
      for (let x = -watermarkBounds; x <= watermarkBounds; x += watermarkStepX) {
        context.strokeText(input.watermarkText, x, y);
        context.fillText(input.watermarkText, x, y);
      }
    }
    context.restore();

    const thumbnailName = input.file.name.replace(/\.[^.]+$/, '') || 'foto';
    return canvasToJpegFile(canvas, `${thumbnailName}-preview.jpg`, input.quality);
  } finally {
    bitmap.close();
  }
}

async function compressImage(input: Extract<UploadWorkerRequest, { type: 'compress-image' }>) {
  assertImageWorkerSupport();
  if (!input.file.type.startsWith('image')) return input.file;
  if (input.file.size <= Math.min(input.targetMaxBytes, input.clientMaxBytes)) return input.file;

  const bitmap = await createImageBitmap(input.file);
  try {
    const maxBytes = Math.min(input.clientMaxBytes, Math.max(input.targetMaxBytes, Math.floor(input.clientMaxBytes * 0.92)));
    const originalMaxSide = Math.max(bitmap.width, bitmap.height);
    const sideTargets = [
      Math.min(input.maxSide, originalMaxSide),
      1800,
      1500,
      1200,
      input.minSide,
    ].filter((value, index, values) => value >= input.minSide && values.indexOf(value) === index);

    for (const maxSide of sideTargets) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return input.file;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of input.qualities) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        if (blob.size <= maxBytes) {
          const compressedName = `${(input.file.name.replace(/\.[^.]+$/, '') || 'foto')}.jpg`;
          return new File([blob], compressedName, { type: 'image/jpeg' });
        }
      }
    }

    return input.file;
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<UploadWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'hash') {
      post({ id: message.id, ok: true, result: await calculateHash(message.file) });
      return;
    }

    if (message.type === 'image-thumbnail') {
      post({ id: message.id, ok: true, result: await generateImageThumbnail(message) });
      return;
    }

    post({ id: message.id, ok: true, result: await compressImage(message) });
  } catch (error) {
    post({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error || 'Worker upload processing failed.'),
    });
  }
};

export {};
