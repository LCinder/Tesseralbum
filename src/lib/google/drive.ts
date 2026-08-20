/**
 * Drive REST client, called straight from the browser.
 *
 * Everything runs under the `drive.file` scope, which means the app can only
 * ever see files it created itself. That is the whole security model: there is
 * no way for this code to read the rest of your Drive, even by accident, and
 * Google does not put us through the restricted-scope review.
 *
 * The consequence to remember: a folder you create by hand at
 * drive.google.com is invisible here. The app has to build its own tree.
 */

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  appProperties?: Record<string, string>;
  /**
   * Google's own generated thumbnail. Short-lived and served from a different
   * host, so it is a fast path rather than something to rely on — see
   * `DriveImage`, which falls back to an authenticated download.
   */
  thumbnailLink?: string;
  size?: string;
};

/** Fields worth asking for when listing media rather than folders. */
const MEDIA_FIELDS =
  "id,name,mimeType,appProperties,thumbnailLink,size";

/**
 * Downloads a file's bytes.
 *
 * The reliable way to show a private image in the browser: this is the Drive
 * API host, which accepts our bearer token and allows cross-origin requests.
 * The cost is the whole file, so it is the fallback and not the first choice.
 */
export async function downloadBlob(
  getToken: TokenSource,
  fileId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Blob> {
  const url = new URL(`${FILES}/${fileId}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await call(getToken, url.toString(), { signal });
  return response.blob();
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** Provides a live token; the session refreshes it behind our back. */
export type TokenSource = () => Promise<string>;

async function call(
  getToken: TokenSource,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    // Drive puts the useful part in a JSON body; the status alone says little.
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      // Non-JSON error body. The status text will have to do.
    }
    throw new DriveError(response.status, detail);
  }

  return response;
}

/**
 * Escapes a value for a Drive `q` query, where the delimiter is a quote.
 *
 * Exported for its tests. Country and souvenir names really do contain
 * apostrophes — "Sant'Angelo", "L'Hospitalet", "Côte d'Ivoire" — and an
 * unescaped one terminates the string early and produces either a nonsense
 * query or a syntax error from Drive.
 */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function findChild(
  getToken: TokenSource,
  parentId: string,
  name: string,
  { folder }: { folder: boolean },
): Promise<DriveFile | null> {
  const q = [
    `name = ${quote(name)}`,
    `${quote(parentId)} in parents`,
    "trashed = false",
    folder ? `mimeType = ${quote(FOLDER_MIME)}` : `mimeType != ${quote(FOLDER_MIME)}`,
  ].join(" and ");

  const url = new URL(FILES);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType,appProperties)");
  url.searchParams.set("pageSize", "10");
  // Files the app created may sit in a Shared Drive if the user moved them.
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await call(getToken, url.toString());
  const body = (await response.json()) as { files?: DriveFile[] };
  return body.files?.[0] ?? null;
}

export async function createFolder(
  getToken: TokenSource,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  const url = new URL(FILES);
  url.searchParams.set("fields", "id,name,mimeType");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await call(getToken, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });

  return (await response.json()) as DriveFile;
}

/**
 * Finds a folder or creates it, walking a path segment by segment.
 *
 * Not atomic: two tabs doing this at once can each create a folder with the
 * same name, because Drive allows duplicate names. Only the editor writes, and
 * only occasionally, so the exposure is small — but it is real, and worth
 * knowing before it produces a mystery duplicate.
 */
export async function ensurePath(
  getToken: TokenSource,
  segments: string[],
  { from = "root" }: { from?: string } = {},
): Promise<string> {
  let parentId = from;

  for (const segment of segments) {
    const existing = await findChild(getToken, parentId, segment, {
      folder: true,
    });
    parentId = existing
      ? existing.id
      : (await createFolder(getToken, parentId, segment)).id;
  }

  return parentId;
}

/** Everything the app can see inside a folder. */
export async function listChildren(
  getToken: TokenSource,
  parentId: string,
  { foldersOnly = false }: { foldersOnly?: boolean } = {},
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(FILES);
    url.searchParams.set(
      "q",
      [
        `${quote(parentId)} in parents`,
        "trashed = false",
        foldersOnly ? `mimeType = ${quote(FOLDER_MIME)}` : "",
      ]
        .filter(Boolean)
        .join(" and "),
    );
    url.searchParams.set(
      "fields",
      `nextPageToken, files(${foldersOnly ? "id,name,mimeType,appProperties" : MEDIA_FIELDS})`,
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await call(getToken, url.toString());
    const body = (await response.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };

    files.push(...(body.files ?? []));
    // Page tokens are sequential, so this cannot be parallelised — the reason
    // a map over thousands of photos eventually wants a local index.
    pageToken = body.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * A handful of photos from one place, for a preview.
 *
 * One small query per place instead of listing the whole archive and grouping
 * it client-side. These are independent, so a caller can run them in parallel
 * — unlike the page tokens of a full listing, which are sequential.
 */
export async function listByPlace(
  getToken: TokenSource,
  placeId: string,
  { limit = 3, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<DriveFile[]> {
  const url = new URL(FILES);
  url.searchParams.set(
    "q",
    `appProperties has { key='placeId' and value=${quote(placeId)} } and mimeType != ${quote(FOLDER_MIME)} and trashed = false`,
  );
  url.searchParams.set("fields", `files(${MEDIA_FIELDS})`);
  url.searchParams.set("pageSize", String(limit));
  // Newest first, so a preview shows the most recent trip rather than whatever
  // Drive happens to return.
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await call(getToken, url.toString(), { signal });
  const body = (await response.json()) as { files?: DriveFile[] };
  return body.files ?? [];
}

/** Finds a file the app uploaded earlier with this exact content hash. */
export async function findByHash(
  getToken: TokenSource,
  sha256: string,
): Promise<DriveFile | null> {
  const url = new URL(FILES);
  url.searchParams.set(
    "q",
    `appProperties has { key='sha256' and value=${quote(sha256)} } and trashed = false`,
  );
  url.searchParams.set("fields", "files(id,name,mimeType,appProperties)");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await call(getToken, url.toString());
  const body = (await response.json()) as { files?: DriveFile[] };
  return body.files?.[0] ?? null;
}

/** Renames a file or folder, and optionally rewrites its app properties. */
export async function update(
  getToken: TokenSource,
  fileId: string,
  changes: { name?: string; appProperties?: Record<string, string> },
): Promise<DriveFile> {
  const url = new URL(`${FILES}/${fileId}`);
  url.searchParams.set("fields", "id,name,mimeType,appProperties");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await call(getToken, url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });

  return (await response.json()) as DriveFile;
}

/** Whether a folder has anything in it that the app can see. */
export async function isEmpty(
  getToken: TokenSource,
  folderId: string,
): Promise<boolean> {
  const url = new URL(FILES);
  url.searchParams.set("q", `${quote(folderId)} in parents and trashed = false`);
  url.searchParams.set("fields", "files(id)");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await call(getToken, url.toString());
  const body = (await response.json()) as { files?: DriveFile[] };
  return (body.files?.length ?? 0) === 0;
}

/**
 * Moves a file or folder to Drive's bin.
 *
 * Deliberately not `DELETE`, which is permanent and unrecoverable. Trashed
 * items sit in the bin for 30 days, so a misclick here costs a restore rather
 * than a holiday's worth of photos.
 */
export async function trash(
  getToken: TokenSource,
  fileId: string,
): Promise<void> {
  const url = new URL(`${FILES}/${fileId}`);
  url.searchParams.set("supportsAllDrives", "true");

  await call(getToken, url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/**
 * Chunk size for resumable uploads.
 *
 * Google requires a multiple of 256 KB for every chunk but the last, and
 * recommends at least 8 MB so the per-request overhead stays small. Most
 * photos fit in one chunk, which is the point.
 */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export type UploadTarget = {
  name: string;
  parentId: string;
  appProperties?: Record<string, string>;
};

/**
 * Opens a resumable upload session and returns the URL to push bytes to.
 *
 * This is the piece that makes a browser-only app possible: Vercel caps a
 * request body at 4.5 MB, which one phone photo already brushes against. Here
 * the server authorises nothing and sees nothing — the browser talks straight
 * to Google.
 *
 * The returned URL carries its own authorisation, so the chunk PUTs that
 * follow need no bearer token. It is single-use and short-lived.
 */
export async function startResumableUpload(
  getToken: TokenSource,
  target: UploadTarget,
  file: File,
): Promise<string> {
  const url = new URL(UPLOAD);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await call(getToken, url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Content-Type": file.type || "application/octet-stream",
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify({
      name: target.name,
      parents: [target.parentId],
      // Set here rather than PATCHed afterwards: one request fewer, and the
      // file is never briefly present without its metadata.
      appProperties: target.appProperties,
    }),
  });

  const session = response.headers.get("Location");
  if (!session) {
    throw new DriveError(
      response.status,
      "Google no devolvió la URL de sesión de subida.",
    );
  }

  return session;
}

/**
 * Pushes a file to an open session, chunk by chunk.
 *
 * Reports progress after each chunk rather than continuously: `fetch` exposes
 * no upload progress, and pulling in XMLHttpRequest for a finer bar is not
 * worth it while a photo is a single chunk anyway.
 */
export async function uploadFileChunks(
  sessionUrl: string,
  file: File,
  {
    onProgress,
    signal,
  }: { onProgress?: (sent: number) => void; signal?: AbortSignal } = {},
): Promise<DriveFile> {
  let sent = 0;

  // A zero-byte file still needs one request, or the session never completes.
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const end = Math.min(sent + CHUNK_BYTES, file.size);
    const chunk = file.slice(sent, end);
    const last = end >= file.size;

    const range = file.size === 0
      ? "bytes */0"
      : `bytes ${sent}-${end - 1}/${file.size}`;

    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": range },
      body: chunk,
      signal,
    });

    // 308 means "chunk stored, send the next one". Anything else in the 2xx
    // range on a non-final chunk would be Google changing its mind.
    if (response.status === 308) {
      sent = end;
      onProgress?.(sent);
      continue;
    }

    if (response.ok) {
      sent = end;
      onProgress?.(sent);
      if (!last) {
        throw new DriveError(
          response.status,
          "Google cerró la subida antes de recibir el fichero completo.",
        );
      }
      return (await response.json()) as DriveFile;
    }

    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      // Not JSON; the status text will do.
    }
    throw new DriveError(response.status, detail);
  } while (sent < file.size);

  throw new DriveError(0, "La subida terminó sin respuesta de Google.");
}

export async function readJson<T>(
  getToken: TokenSource,
  fileId: string,
): Promise<T> {
  const url = new URL(`${FILES}/${fileId}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await call(getToken, url.toString());
  return (await response.json()) as T;
}

/** Creates a JSON file, or overwrites it in place when `fileId` is given. */
export async function writeJson(
  getToken: TokenSource,
  data: unknown,
  target: { fileId: string } | { parentId: string; name: string },
): Promise<DriveFile> {
  const body = JSON.stringify(data, null, 2);
  const updating = "fileId" in target;

  const url = new URL(updating ? `${UPLOAD}/${target.fileId}` : UPLOAD);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,mimeType");
  url.searchParams.set("supportsAllDrives", "true");

  const metadata = updating
    ? {}
    : { name: target.name, parents: [target.parentId] };

  // Multipart upload: metadata part, then the bytes, in one request.
  const boundary = `sv${crypto.randomUUID().replace(/-/g, "")}`;
  const payload = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    body,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await call(getToken, url.toString(), {
    method: updating ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: payload,
  });

  return (await response.json()) as DriveFile;
}
