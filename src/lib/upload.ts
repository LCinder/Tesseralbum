import { ROOT_FOLDER, THUMBS_FOLDER, type Place } from "@/lib/catalog";
import { makeThumbnail, thumbName } from "@/lib/thumbnail";
import {
  createFolder,
  ensurePath,
  findByHash,
  listChildren,
  startResumableUpload,
  update,
  uploadFileChunks,
  uploadSmallFile,
  type TokenSource,
} from "@/lib/google/drive";
import type { MediaFile } from "@/lib/media";
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
): Promise<TripFolder> {
  const yearId = await ensurePath(getToken, [
    ROOT_FOLDER,
    place.country,
    yearLabel(span),
  ]);

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

    await update(getToken, sibling.id, {
      appProperties: spanToProperties(widened),
    });

    return { id: sibling.id, name: sibling.name, span: widened, reused: true };
  }

  const name = disambiguate(
    monthLabel(span),
    siblings.map((sibling) => sibling.name),
  );

  const created = await createFolder(getToken, yearId, name);
  await update(getToken, created.id, {
    appProperties: spanToProperties(span),
  });

  return { id: created.id, name, span, reused: false };
}

/** What the app records about a photo, on the photo itself. */
function propertiesFor(item: MediaFile, place: Place, slug: string) {
  const properties: Record<string, string> = {
    placeId: place.id,
    tagSlug: slug,
    kind: item.kind,
    dateSource: item.dateSource,
  };

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
 * Makes a thumbnail, stores it, and points the original at it.
 *
 * The id goes on the *original* rather than the thumbnail carrying a back
 * reference, so listing photos already yields their thumbnails: no extra query
 * when the gallery opens, which is the whole point of doing this at all.
 *
 * Never throws. A browser that cannot decode the file — HEIC in Chrome, an
 * unusual codec — simply gets no thumbnail, and the viewer falls back the way
 * it did before.
 */
async function attachThumbnail(
  getToken: TokenSource,
  item: MediaFile,
  fileId: string,
  thumbsFolderId: string | null,
): Promise<void> {
  if (!thumbsFolderId) return;

  try {
    const blob = await makeThumbnail(item.file, item.kind);
    if (!blob) return;

    const thumb = await uploadSmallFile(getToken, blob, {
      name: thumbName(item.file.name),
      parentId: thumbsFolderId,
    });

    await update(getToken, fileId, { appProperties: { thumbId: thumb.id } });
  } catch {
    // A missing thumbnail costs a slower first view, nothing more.
  }
}

/**
 * Uploads a batch, reporting after every step.
 *
 * One file at a time on purpose: parallel uploads would race on the folder
 * rename and give Drive several concurrent sessions to shepherd, for a gain
 * nobody notices on a home connection.
 */
export async function uploadBatch(
  getToken: TokenSource,
  {
    media,
    place,
    slug,
    onProgress,
    signal,
  }: {
    media: MediaFile[];
    place: Place;
    slug: string;
    onProgress: (progress: Progress) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const span = spanOf(media.map((item) => item.takenAt));
  if (!span) {
    throw new Error(
      "Ninguna de las fotos tiene fecha, así que no se puede decidir la carpeta del viaje.",
    );
  }

  const states = new Map<string, ItemState>(
    media.map((item) => [itemKey(item), { status: "pending" } as ItemState]),
  );

  const report = (folder: TripFolder | null) =>
    onProgress({ folder, states: new Map(states) });

  report(null);

  const folder = await resolveTripFolder(getToken, place, span);
  report(folder);

  // Resolved once for the batch. If it cannot be created the upload still goes
  // ahead — thumbnails are an optimisation, not a requirement.
  let thumbsId: string | null = null;
  try {
    thumbsId = await ensurePath(getToken, [ROOT_FOLDER, THUMBS_FOLDER]);
  } catch {
    thumbsId = null;
  }

  for (const item of media) {
    if (signal?.aborted) return;

    const key = itemKey(item);

    try {
      // Skipping a duplicate costs one query; uploading one costs the whole
      // file twice over.
      if (item.sha256) {
        states.set(key, { status: "hashing" });
        report(folder);

        const existing = await findByHash(getToken, item.sha256);
        if (existing) {
          states.set(key, { status: "duplicate", existingId: existing.id });
          report(folder);
          continue;
        }
      }

      states.set(key, { status: "uploading", sent: 0 });
      report(folder);

      const session = await startResumableUpload(
        getToken,
        {
          name: item.file.name,
          parentId: folder.id,
          appProperties: propertiesFor(item, place, slug),
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

      // Best effort, and deliberately after the photo is safe: a thumbnail is
      // a preview, and failing an upload over one would be losing a photo to
      // save a picture of it.
      await attachThumbnail(getToken, item, uploaded.id, thumbsId);

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
