const DB_NAME = "sluggr-fs";
const STORE = "kv";
const HANDLE_KEY = "tokenFileHandle";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function idbGetTokenHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(HANDLE_KEY);
      r.onsuccess = () => resolve((r.result as FileSystemFileHandle) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function idbSetTokenHandle(
  handle: FileSystemFileHandle
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClearTokenHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function readTextFromHandle(
  handle: FileSystemFileHandle
): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

type WritableFileHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  createWritable?: () => Promise<FileSystemWritableFileStream>;
};

export async function writeTextToHandle(
  handle: FileSystemFileHandle,
  text: string
): Promise<void> {
  const h = handle as WritableFileHandle;
  if (h.queryPermission && h.requestPermission) {
    let perm = await h.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      perm = await h.requestPermission({ mode: "readwrite" });
    }
    if (perm !== "granted") {
      throw new Error("Write permission denied");
    }
  }
  const writable = await h.createWritable!();
  await writable.write(text);
  await writable.close();
}

const PICKER_TYPES = [
  {
    description: "Sluggr token",
    accept: {
      "application/octet-stream": [".sluggr"],
      "application/json": [".json"],
      "text/plain": [".txt"],
    },
  },
];

export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
}

export async function pickTokenFileWithPicker(): Promise<FileSystemFileHandle> {
  const picker = window.showOpenFilePicker;
  if (!picker) throw new Error("File System Access API unavailable");
  const handles = await picker.call(window, {
    types: PICKER_TYPES,
    excludeAcceptAllOption: false,
    multiple: false,
  });
  const h = handles[0];
  if (!h) throw new Error("No file selected");
  return h;
}

/** Opens the native file chooser; resolve with the first selected file (no write-back path). */
export function pickTokenFileLegacyInput(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sluggr,.json,.txt,application/octet-stream,application/json";
    input.style.display = "none";

    const cleanup = () => {
      if (input.parentNode) document.body.removeChild(input);
    };

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onWindowFocus);
      fn();
    };

    const onWindowFocus = () => {
      window.setTimeout(() => {
        finish(() => {
          if (input.files?.[0]) {
            const f = input.files[0];
            cleanup();
            resolve(f);
          } else {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
          }
        });
      }, 400);
    };
    window.addEventListener("focus", onWindowFocus);

    input.onchange = () => {
      finish(() => {
        const f = input.files?.[0];
        cleanup();
        if (f) resolve(f);
        else reject(new DOMException("Aborted", "AbortError"));
      });
    };

    document.body.appendChild(input);
    input.click();
  });
}

export function silentDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
