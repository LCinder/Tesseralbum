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
};

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
