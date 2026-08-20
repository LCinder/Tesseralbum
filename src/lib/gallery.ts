import { type Place } from "@/lib/catalog";
import {
  listAllFolders,
  listByPlace,
  type DriveFile,
  type TokenSource,
} from "@/lib/google/drive";
import { memo } from "@/lib/memo";
import { spanFromProperties, type DateSpan } from "@/lib/trips";

/**
 * Reading the album back out of Drive.
 *
 * Nothing here creates anything: looking at a place with no photos yet must
 * not leave folders behind as a side effect of having been viewed.
 */

export type Shot = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  /** Our own 400px copy, when the upload managed to make one. */
  thumbId?: string;
  takenAt: Date | null;
  lat: number | null;
  lng: number | null;
  geoSource: string;
  bytes: number | null;
};

export type Trip = {
  folderId: string;
  /** "Septiembre-Octubre" */
  name: string;
  year: string;
  span: DateSpan | null;
  shots: Shot[];
};

function toShot(file: DriveFile): Shot {
  const properties = file.appProperties ?? {};

  const takenAt = properties.takenAt ? new Date(properties.takenAt) : null;
  const lat = Number(properties.lat);
  const lng = Number(properties.lng);

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    thumbnailLink: file.thumbnailLink,
    thumbId: properties.thumbId,
    takenAt: takenAt && Number.isFinite(takenAt.getTime()) ? takenAt : null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    geoSource: properties.geoSource ?? "none",
    bytes: file.size ? Number(file.size) : null,
  };
}

/**
 * Every trip that has photos for this place, newest first.
 *
 * Two queries, run at once, rather than a walk down country → year → trip →
 * files. That walk was strictly sequential — each level needed the ids from
 * the one above — so a place with three trips cost eight round trips before
 * anything could render, which on a phone is over a second of waiting.
 *
 * Photos carry their `placeId`, so asking for them directly skips the tree
 * entirely; the folders supply the names and dates. It is also what keeps
 * Dublín and Cork apart when both filed under Irlanda on the same journey.
 */
export async function listTrips(
  getToken: TokenSource,
  place: Place,
): Promise<Trip[]> {
  // Memoised so navigating away and back does not re-list what has not
  // changed. The folder listing is shared with every other place, which is
  // why it gets its own key.
  const [files, folders] = await Promise.all([
    memo(`place:${place.id}`, () => listByPlace(getToken, place.id)),
    memo("folders", () => listAllFolders(getToken)),
  ]);

  if (files.length === 0) return [];

  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  // Grouped by the folder each photo sits in, which is its trip.
  const grouped = new Map<string, Shot[]>();

  for (const file of files) {
    const folderId = file.parents?.[0];
    if (!folderId) continue;

    const shots = grouped.get(folderId);
    if (shots) shots.push(toShot(file));
    else grouped.set(folderId, [toShot(file)]);
  }

  const trips: Trip[] = [];

  for (const [folderId, shots] of grouped) {
    const folder = byId.get(folderId);
    // A photo whose folder is gone cannot be placed in a trip, and inventing
    // one would put a journey on the page that does not exist in Drive.
    if (!folder) continue;

    const yearFolder = folder.parents?.[0]
      ? byId.get(folder.parents[0])
      : undefined;

    trips.push({
      folderId,
      name: folder.name,
      year: yearFolder?.name ?? "",
      span: spanFromProperties(folder.appProperties),
      shots: shots.sort(byDateThenName),
    });
  }

  // Newest trip first. Within a year, the span decides; folders without one
  // fall back to their name so the order is at least stable.
  return trips.sort((a, b) => {
    const byYear = b.year.localeCompare(a.year);
    if (byYear !== 0) return byYear;

    const at = a.span?.from.getTime() ?? 0;
    const bt = b.span?.from.getTime() ?? 0;
    return bt - at || a.name.localeCompare(b.name);
  });
}

function byDateThenName(a: Shot, b: Shot): number {
  const at = a.takenAt?.getTime();
  const bt = b.takenAt?.getTime();

  // Photos without a date go last rather than being scattered by whatever
  // order Drive happened to return.
  if (at === undefined && bt === undefined) return a.name.localeCompare(b.name);
  if (at === undefined) return 1;
  if (bt === undefined) return -1;

  return at - bt || a.name.localeCompare(b.name);
}

export function isVideo(shot: Shot): boolean {
  return shot.mimeType.startsWith("video/");
}

/** Whether the browser can be expected to render this at all. */
export function isDisplayable(shot: Shot): boolean {
  return !["image/heic", "image/heif"].includes(shot.mimeType.toLowerCase());
}
