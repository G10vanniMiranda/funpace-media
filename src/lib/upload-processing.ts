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

type UploadWorkerPayload =
  | { type: 'hash'; file: File }
  | {
      type: 'image-thumbnail';
      file: File;
      maxSide: number;
      quality: number;
      watermarkText: string;
    }
  | {
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

let uploadWorker: Worker | null = null;
let nextWorkerMessageId = 1;
const pendingWorkerMessages = new Map<number, {
  resolve: (value: string | File | null) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();

function supportsUploadWorker() {
  return typeof Worker !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    Boolean(crypto.subtle);
}

function getUploadWorker() {
  if (!supportsUploadWorker()) {
    throw new Error('Upload worker unavailable.');
  }

  if (!uploadWorker) {
    uploadWorker = new Worker(new URL('../workers/upload-processing.worker.ts', import.meta.url), { type: 'module' });
    uploadWorker.onmessage = (event: MessageEvent<UploadWorkerResponse>) => {
      const message = event.data;
      const pending = pendingWorkerMessages.get(message.id);
      if (!pending) return;

      window.clearTimeout(pending.timeout);
      pendingWorkerMessages.delete(message.id);

      if (!message.ok) {
        pending.reject(new Error('error' in message ? message.error : 'Upload worker failed.'));
        return;
      }
      pending.resolve(message.result);
    };
    uploadWorker.onerror = (event) => {
      const error = new Error(event.message || 'Upload worker failed.');
      for (const [id, pending] of pendingWorkerMessages.entries()) {
        window.clearTimeout(pending.timeout);
        pending.reject(error);
        pendingWorkerMessages.delete(id);
      }
      uploadWorker?.terminate();
      uploadWorker = null;
    };
  }

  return uploadWorker;
}

function runUploadWorker<T extends string | File | null>(
  request: UploadWorkerPayload,
  timeoutMs = 60_000,
): Promise<T> {
  const worker = getUploadWorker();
  const id = nextWorkerMessageId;
  nextWorkerMessageId += 1;

  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingWorkerMessages.delete(id);
      reject(new Error('Upload worker timeout.'));
    }, timeoutMs);

    pendingWorkerMessages.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timeout,
    });
    worker.postMessage({ ...request, id });
  });
}

export async function calculateFileSha256InWorker(file: File, fallback: (file: File) => Promise<string>) {
  try {
    return await runUploadWorker<string>({ type: 'hash', file }, 120_000);
  } catch {
    return fallback(file);
  }
}

export async function generateImageThumbnailInWorker(
  file: File,
  options: { maxSide: number; quality: number; watermarkText: string },
  fallback: (file: File) => Promise<File | null>,
) {
  if (!file.type.startsWith('image')) return null;

  try {
    return await runUploadWorker<File | null>({
      type: 'image-thumbnail',
      file,
      maxSide: options.maxSide,
      quality: options.quality,
      watermarkText: options.watermarkText,
    }, 90_000);
  } catch {
    return fallback(file);
  }
}

export async function prepareImageForUploadInWorker(
  file: File,
  options: {
    clientMaxBytes: number;
    targetMaxBytes: number;
    maxSide: number;
    minSide: number;
    qualities: number[];
  },
  fallback: (file: File) => Promise<File>,
) {
  if (!file.type.startsWith('image')) return file;

  try {
    return await runUploadWorker<File>({
      type: 'compress-image',
      file,
      clientMaxBytes: options.clientMaxBytes,
      targetMaxBytes: options.targetMaxBytes,
      maxSide: options.maxSide,
      minSide: options.minSide,
      qualities: options.qualities,
    }, 120_000);
  } catch {
    return fallback(file);
  }
}
