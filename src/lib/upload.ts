import { THUMBS_FOLDER, type Place } from "@/lib/catalog";
import { makeThumbnail, thumbName } from "@/lib/thumbnail";
import {
  createFolder,
  ensurePath,
  findByHashes,
  listChildren,
  startResumableUpload,
  update,
  uploadFileChunks,
  uploadSmallFile,
  type TokenSource,
} from "@/lib/google/drive";
import type { MediaFile } from "@/lib/media";
import { forget } from "@/lib/memo";
import {
  belongsToSameTrip,
  disambiguate,
  mergeSpans,
  monthLabel,
  spanFromProperties,
  spanOf,
  spanToProperties,
  yearLabel,
  type DateSpan,
} from "@/lib/trips";

/**
 * Uploading a batch to Drive.
 *
 * Two jobs: work out which folder this batch belongs in, and push the bytes
 * there. The folder decision is the subtle half — a batch can be the tail of
 * a trip already on disk, or the start of a new visit to the same country.
 */

export type TripFolder = {
  id: string;
  name: string;
  span: DateSpan;
  /** True when this batch joined a folder that already existed. */
  reused: boolean;
  /** Set when joining widened the span enough to change the folder name. */
  renamedFrom?: string;
};

/**
 * Finds the folder this batch belongs to, creating or widening it as needed.
 *
 * Walks the year folder's children looking for a trip whose stored span is
 * close enough to be the same journey. Folders without our span properties are
 * skipped rather than guessed at, so anything made by hand in Drive is left
 * out of the comparison.
 */
export async function resolveTripFolder(
  getToken: TokenSource,
  place: Place,
  span: DateSpan,
  rootId: string,
): Promise<TripFolder> {
  // Starting from the known root: the catalogue already resolved it when the
  // session opened, and looking it up again is a wasted request every batch.
  const yearId = await ensurePath(
    getToken,
    [place.country, yearLabel(span)],
    { from: rootId },
  );

  const siblings = await listChildren(getToken, yearId, { foldersOnly: true });

  for (const sibling of siblings) {
    const existing = spanFromProperties(sibling.appProperties);
    if (!existing) continue;
    if (!belongsToSameTrip(existing, span)) continue;

    const widened = mergeSpans(existing, span);
    const wanted = monthLabel(widened);

    // A trip that grew from September into October has to be renamed, or its
    // folder keeps claiming to be shorter than it is.
    if (wanted !== sibling.name) {
      const taken = siblings
        .filter((other) => other.id !== sibling.id)
        .map((other) => other.name);

      const name = disambiguate(wanted, taken);
      await update(getToken, sibling.id, {
        name,
        appProperties: spanToProperties(widened),
      });

      return {
        id: sibling.id,
        name,
        span: widened,
        reused: true,
        renamedFrom: sibling.name,
      };
    }

    // Only when the batch actually reached outside what the folder already
    // covered. Uploading the middle of a trip you have already filed changes
    // nothing, and writing the same dates back costs a request to say so.
    const grew =
      widened.from.getTime() !== existing.from.getTime() ||
      widened.to.getTime() !== existing.to.getTime();

    if (grew) {
      await update(getToken, sibling.id, {
        appProperties: spanToProperties(widened),
      });
    }

    return { id: sibling.id, name: sibling.name, span: widened, reused: true };
  }

  const name = disambiguate(
    monthLabel(span),
    siblings.map((sibling) => sibling.name),
  );

  // Dates set at creation rather than patched on after: two steps for one
  // folder, every new trip.
  const created = await createFolder(
    getToken,
    yearId,
    name,
    spanToProperties(span),
  );

  return { id: created.id, name, span, reused: false };
}

/** What the app records about a photo, on the photo itself. */
function propertiesFor(
  item: MediaFile,
  place: Place,
  slug: string,
  thumbId: string | null,
) {
  const properties: Record<string, string> = {
    placeId: place.id,
    tagSlug: slug,
    kind: item.kind,
    dateSource: item.dateSource,
  };

  if (thumbId) properties.thumbId = thumbId;
  if (item.sha256) properties.sha256 = item.sha256;
  if (item.takenAt) properties.takenAt = item.takenAt.toISOString();

  // Falling back to the souvenir's coordinates is what keeps a photo on the
  // map when its EXIF was stripped — by WhatsApp, or by iOS on sharing. The
  // pin is then approximate, and `geoSource` is what lets the map say so
  // instead of feigning precision.
  properties.lat = String(item.lat ?? place.lat);
  properties.lng = String(item.lng ?? place.lng);
  properties.geoSource = item.geoSource === "exif" ? "exif" : "tag";

  return properties;
}

export type ItemState =
  | { status: "pending" }
  | { status: "hashing" }
  | { status: "duplicate"; existingId: string }
  | { status: "uploading"; sent: number }
  | { status: "done"; fileId: string }
  | { status: "failed"; reason: string };

export type Progress = {
  folder: TripFolder | null;
  states: Map<string, ItemState>;
};

/** Stable key for an item, matching what the preview table uses. */
export function itemKey(item: MediaFile): string {
  return `${item.file.name}-${item.file.size}`;
}

/**
 * Makes a thumbnail and stores it, returning its id for the original to carry.
 *
 * Done *before* the photo rather than after, so the id can go in at creation.
 * Patching it on afterwards cost an extra request per file — a hundred wasted
 * calls on a fifty-photo trip.
 *
 * The trade is an orphaned thumbnail if the photo upload then fails: a few
 * tens of kilobytes, against a request saved every single time it works.
 *
 * Never throws. A browser that cannot decode the file — HEIC in Chrome, an
 * unusual codec — simply gets no thumbnail, and the viewer falls back the way
 * it did before.
 */
async function makeAndStoreThumbnail(
  getToken: TokenSource,
  item: MediaFile,
  thumbsFolderId: string | null,
): Promise<string | null> {
  if (!thumbsFolderId) return null;

  try {
    const blob = await makeThumbnail(item.file, item.kind);
    if (!blob) return null;

    const thumb = await uploadSmallFile(getToken, blob, {
      name: thumbName(item.file.name),
      parentId: thumbsFolderId,
    });

    return thumb.id;
  } catch {
    // A missing thumbnail costs a slower first view, nothing more.
    return null;
  }
}

/**
 * Uploads a batch, reporting after every step.
 *
 * One file at a time. Nothing forces this any more — the folder is resolved
 * once before the loop, so there is no rename left to race on — but running
 * several at once buys wall-clock time, not fewer requests, and costs a much
 * fiddlier progress and cancel story.
 */
export async function uploadBatch(
  getToken: TokenSource,
  {
    media,
    place,
    slug,
    rootId,
    onProgress,
    signal,
    span: filedUnder,
  }: {
    media: MediaFile[];
    place: Place;
    slug: string;
    rootId: string;
    onProgress: (progress: Progress) => void;
    signal?: AbortSignal;
    /**
     * The span to file under, when it is not the one this media implies.
     *
     * Retrying the three photos that failed out of fifty must land them in
     * the same trip as the forty-seven that worked, so the caller passes the
     * whole batch's span rather than letting the survivors redraw the trip
     * around themselves.
     */
    span?: DateSpan;
  },
): Promise<void> {
  const span = filedUnder ?? spanOf(media.map((item) => item.takenAt));
  if (!span) {
    throw new Error(
      "Ninguna de las fotos tiene fecha, así que no se puede decidir la carpeta del viaje.",
    );
  }

  // Whatever this batch does, the cached listings are about to be wrong.
  // Forgetting up front rather than at the end covers a cancelled or failed
  // run too, which may still have uploaded some of the files.
  forget(`place:${place.id}`);
  forget(`preview:${place.id}`);
  forget("folders");
  forget("everything");

  const states = new Map<string, ItemState>(
    media.map((item) => [itemKey(item), { status: "pending" } as ItemState]),
  );

  const report = (folder: TripFolder | null) =>
    onProgress({ folder, states: new Map(states) });

  report(null);

  const folder = await resolveTripFolder(getToken, place, span, rootId);
  report(folder);

  // Resolved once for the batch. If it cannot be created the upload still goes
  // ahead — thumbnails are an optimisation, not a requirement.
  let thumbsId: string | null = null;
  try {
    thumbsId = await ensurePath(getToken, [THUMBS_FOLDER], { from: rootId });
  } catch {
    thumbsId = null;
  }

  // Every hash at once, before the loop. Asked file by file this was one
  // query per photo — fifty round trips spent before a single byte moved.
  for (const item of media) {
    if (item.sha256) states.set(itemKey(item), { status: "hashing" });
  }
  report(folder);

  const known = await findByHashes(
    getToken,
    media.map((item) => item.sha256).filter((hash): hash is string => !!hash),
    { signal },
  );

  for (const item of media) {
    if (signal?.aborted) return;

    const key = itemKey(item);

    try {
      const alreadyThere = item.sha256 ? known.get(item.sha256) : undefined;
      if (alreadyThere) {
        states.set(key, { status: "duplicate", existingId: alreadyThere });
        report(folder);
        continue;
      }

      states.set(key, { status: "uploading", sent: 0 });
      report(folder);

      // Before the photo, so its id can go in at creation rather than costing
      // a second request to patch on afterwards.
      const thumbId = await makeAndStoreThumbnail(getToken, item, thumbsId);

      const session = await startResumableUpload(
        getToken,
        {
          name: item.file.name,
          parentId: folder.id,
          appProperties: propertiesFor(item, place, slug, thumbId),
        },
        item.file,
      );

      const uploaded = await uploadFileChunks(session, item.file, {
        signal,
        onProgress: (sent) => {
          states.set(key, { status: "uploading", sent });
          report(folder);
        },
      });

      states.set(key, { status: "done", fileId: uploaded.id });
      report(folder);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;

      states.set(key, {
        status: "failed",
        reason: cause instanceof Error ? cause.message : "Error desconocido.",
      });
      report(folder);
      // Carrying on is deliberate: one corrupt file should not strand the
      // rest of the trip.
    }
  }
}
