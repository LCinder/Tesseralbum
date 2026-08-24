/**
 * A local cache of thumbnails, in IndexedDB.
 *
 * Without this, every visit to an album re-downloads every image: Drive's own
 * thumbnail links expire, and the fallback path fetches whole originals. A
 * blob keyed by file id survives reloads and costs one lookup.
 *
 * Everything here fails soft. A browser in private mode, a full disk or a
 * user who cleared site data should mean "no cache", not "no album".
 */

const DB_NAME = "tesseralbum";
const DB_VERSION = 1;
const STORE = "thumbs";

/** Cached copies past this age are re-fetched, in case the file changed. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Entry = {
  fileId: string;
  blob: Blob;
  storedAt: number;
};

let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;

  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "fileId" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // Firefox in private mode leaves the request pending rather than
      // erroring, which would hang the first render.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return opening;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }

        try {
          const tx = db.transaction(STORE, mode);
          const request = run(tx.objectStore(STORE));

          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** A cached thumbnail, or `null` when there is none or it is stale. */
export async function readThumb(fileId: string): Promise<Blob | null> {
  const entry = await transact<Entry>("readonly", (store) => store.get(fileId));

  if (!entry) return null;
  if (Date.now() - entry.storedAt > MAX_AGE_MS) return null;

  return entry.blob;
}

export async function writeThumb(fileId: string, blob: Blob): Promise<void> {
  await transact("readwrite", (store) =>
    store.put({ fileId, blob, storedAt: Date.now() } satisfies Entry),
  );
}

/** Drops everything, for when the user wants the space back. */
export async function clearThumbs(): Promise<void> {
  await transact("readwrite", (store) => store.clear());
}

/** Rough size of the cache, for showing what clearing would free. */
export async function cacheSize(): Promise<{ count: number; bytes: number }> {
  const entries = await transact<Entry[]>("readonly", (store) =>
    store.getAll(),
  );

  if (!entries) return { count: 0, bytes: 0 };

  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0),
  };
}
