export type ResumableUploadItemStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'paused' | 'skipped';

export type ResumableUploadFileHandle = {
  getFile: () => Promise<File>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export type ResumableUploadManifestItem = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  status: ResumableUploadItemStatus;
  attempts: number;
  stage: string | null;
  error: string;
  uploadedAt: string | null;
  handle?: ResumableUploadFileHandle | null;
};

export type ResumableUploadManifest = {
  photographerId: string;
  eventInput: string;
  checkpointInput: string;
  selectedEventId: string;
  updatedAt: string;
  items: ResumableUploadManifestItem[];
};

export type ResumablePickedFile = {
  file: File;
  handle?: ResumableUploadFileHandle | null;
};

const dbName = 'funpace-resumable-upload';
const dbVersion = 1;
const storeName = 'upload-sessions';
const fallbackStorageKey = 'funpace:photographer-upload-session:v2';

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption?: boolean;
  }) => Promise<ResumableUploadFileHandle[]>;
};

function manifestKey(photographerId: string) {
  return `photographer:${photographerId}`;
}

function isBrowserStorageAvailable() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openUploadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowserStorageAvailable()) {
      reject(new Error('IndexedDB indisponivel neste navegador.'));
      return;
    }

    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onerror = () => reject(request.error || new Error('Nao foi possivel abrir IndexedDB.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function runStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openUploadDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request: IDBRequest<T> | void;

    transaction.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Falha na transacao IndexedDB.'));
    };

    request = callback(store);
  }));
}

function readFallbackManifest(photographerId: string): ResumableUploadManifest | null {
  try {
    const raw = localStorage.getItem(fallbackStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumableUploadManifest;
    if (parsed.photographerId !== photographerId || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeFallbackManifest(manifest: ResumableUploadManifest) {
  localStorage.setItem(fallbackStorageKey, JSON.stringify({
    ...manifest,
    items: manifest.items.map(({ handle, ...item }) => item),
  }));
}

export function createResumableFileSignature(file: Pick<File, 'name' | 'size' | 'lastModified'>) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function readUploadResumeManifest(photographerId: string): Promise<ResumableUploadManifest | null> {
  try {
    const manifest = await runStore<ResumableUploadManifest>('readonly', (store) => store.get(manifestKey(photographerId)));
    if (manifest?.photographerId === photographerId && Array.isArray(manifest.items) && manifest.items.length > 0) {
      return manifest;
    }
  } catch {
    // Fallback below keeps older browsers working.
  }

  return readFallbackManifest(photographerId);
}

export async function writeUploadResumeManifest(manifest: ResumableUploadManifest) {
  const resumableItems = manifest.items.filter((item) => item.status !== 'done' && item.status !== 'skipped');
  if (resumableItems.length === 0) {
    await clearUploadResumeManifest(manifest.photographerId);
    return;
  }

  try {
    await runStore('readwrite', (store) => store.put(manifest, manifestKey(manifest.photographerId)));
  } catch {
    writeFallbackManifest(manifest);
  }
}

export async function clearUploadResumeManifest(photographerId?: string) {
  try {
    await runStore('readwrite', (store) => {
      if (photographerId) store.delete(manifestKey(photographerId));
      else store.clear();
    });
  } catch {
    // Ignore and still clear fallback.
  }

  localStorage.removeItem(fallbackStorageKey);
}

export async function pickResumableUploadFiles(): Promise<ResumablePickedFile[]> {
  const picker = window as FilePickerWindow;
  if (!picker.showOpenFilePicker) return [];

  const handles = await picker.showOpenFilePicker({
    multiple: true,
    excludeAcceptAllOption: false,
    types: [{
      description: 'Fotos e videos',
      accept: {
        'image/*': ['.jpg', '.jpeg', '.png', '.webp'],
        'video/*': ['.mp4', '.mov', '.webm'],
      },
    }],
  });

  const picked: ResumablePickedFile[] = [];
  for (const handle of handles) {
    const file = await handle.getFile();
    picked.push({ file, handle });
  }
  return picked;
}

export async function restoreFilesFromManifest(manifest: ResumableUploadManifest): Promise<ResumablePickedFile[]> {
  const restored: ResumablePickedFile[] = [];
  for (const item of manifest.items) {
    if (!item.handle || item.status === 'done' || item.status === 'skipped') continue;

    try {
      const permission = await item.handle.queryPermission?.({ mode: 'read' });
      if (permission !== 'granted') {
        const requested = await item.handle.requestPermission?.({ mode: 'read' });
        if (requested !== 'granted') continue;
      }
      const file = await item.handle.getFile();
      if (createResumableFileSignature(file) === createResumableFileSignature(item)) {
        restored.push({ file, handle: item.handle });
      }
    } catch {
      // A moved/deleted file simply remains pending for manual reselection.
    }
  }
  return restored;
}

export function supportsFileSystemUploadHandles() {
  return typeof window !== 'undefined' && Boolean((window as FilePickerWindow).showOpenFilePicker);
}
