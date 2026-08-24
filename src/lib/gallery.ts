import { type Place } from "@/lib/catalog";
import {
  listAllFolders,
  listByPlace,
  type DriveFile,
  type TokenSource,
} from "@/lib/google/drive";
import { dateFromName, type Provenance } from "@/lib/media";
import { memo } from "@/lib/memo";
import {
  contradicts,
  spanFromProperties,
  trustedSpan,
  type DateSpan,
} from "@/lib/trips";

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
  /** How much the date can be trusted — see `pickDate`. */
  dateSource: Provenance;
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

/**
 * The date to sort a photo by, and how much it can be trusted.
 *
 * Reading the name here as well as at upload time is what repairs an album
 * that is already in Drive. Photos uploaded before the name was consulted
 * carry `dateSource: "file"` — the day the file was written, which for
 * anything forwarded is not the day it was taken, and is what leaves a trip
 * shuffled. The name still says otherwise, and re-reading it costs nothing
 * and touches nothing.
 *
 * An EXIF date is never second-guessed: it is the camera's own answer.
 */
function dateOf(
  file: DriveFile,
  properties: Record<string, string>,
): { takenAt: Date | null; dateSource: Provenance } {
  const stored = properties.takenAt ? new Date(properties.takenAt) : null;
  const usable = stored && Number.isFinite(stored.getTime()) ? stored : null;
  const source = (properties.dateSource ?? "none") as Provenance;

  // The camera's own answer, or the traveller's: neither is second-guessed.
  if ((source === "exif" || source === "manual") && usable) {
    return { takenAt: usable, dateSource: source };
  }

  const named = dateFromName(file.name);
  if (named) return { takenAt: named, dateSource: "name" };

  return { takenAt: usable, dateSource: usable ? source : "none" };
}

/**
 * The same reading, for a file on its own.
 *
 * Used by the date repair, which works folder by folder across the whole
 * archive and has no album to build.
 */
export function shotDate(file: DriveFile): {
  takenAt: Date | null;
  dateSource: Provenance;
} {
  return dateOf(file, file.appProperties ?? {});
}

function toShot(file: DriveFile): Shot {
  const properties = file.appProperties ?? {};

  const { takenAt, dateSource } = dateOf(file, properties);
  const lat = Number(properties.lat);
  const lng = Number(properties.lng);

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    thumbnailLink: file.thumbnailLink,
    thumbId: properties.thumbId,
    takenAt,
    dateSource,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    geoSource: properties.geoSource ?? "none",
    bytes: file.size ? Number(file.size) : null,
  };
}

/**
 * Drops a date the rest of the trip contradicts.
 *
 * A photo with no EXIF and no date in its name falls back to the day the file
 * was written, which for anything copied, exported or forwarded is the day it
 * was copied. Showing that is worse than showing nothing: the album states, in
 * the corner of the thumbnail, that a photo from last November was taken this
 * month. Nothing can recover the real date — but the trip it sits in already
 * says roughly when, and an empty corner does not lie.
 *
 * Judged against the trip's own camera dates rather than the folder's stored
 * span, because that span is the thing that was wrong: this has to be right
 * before the folder is repaired, and stay right after.
 */
export function withoutFalseDates(shots: Shot[]): Shot[] {
  const trusted = trustedSpan(shots);
  if (!trusted) return shots;

  return shots.map((shot) =>
    contradicts(trusted, shot)
      ? { ...shot, takenAt: null, dateSource: "none" as const }
      : shot,
  );
}

/**
 * Every trip that has photos for this place, oldest first.
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
      shots: withoutFalseDates(shots).sort(byDateThenName),
    });
  }

  return trips.sort(byTripDate);
}

/**
 * Trips run oldest first, like the pages of an album rather than a feed.
 *
 * Within a year the span decides; folders without one fall back to their name
 * so the order is at least stable. Anything the app cannot date — a folder
 * made by hand in Drive, a year folder that has since been moved — trails the
 * dated trips instead of being scattered among them.
 */
export function byTripDate(a: Trip, b: Trip): number {
  if (a.year !== b.year) {
    if (!a.year) return 1;
    if (!b.year) return -1;
    return a.year.localeCompare(b.year);
  }

  const at = a.span?.from.getTime() ?? Number.POSITIVE_INFINITY;
  const bt = b.span?.from.getTime() ?? Number.POSITIVE_INFINITY;

  // Two undated folders subtract to NaN, which is falsy, so the name decides.
  return at - bt || a.name.localeCompare(b.name);
}

/**
 * The tie-break, and the reason a burst of photos used to come out shuffled.
 *
 * Plain `localeCompare` is alphabetical, so `IMG_10` sorts before `IMG_2`.
 * Whenever the dates match — a burst, a second's precision, or a whole folder
 * copied at once so every file carries the same mtime — that ordering is the
 * only one left, and it reads as random.
 */
function byName(a: Shot, b: Shot): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/** Oldest photo first, so a trip reads forwards. */
export function byDateThenName(a: Shot, b: Shot): number {
  const at = a.takenAt?.getTime();
  const bt = b.takenAt?.getTime();

  // Photos without a date go last rather than being scattered by whatever
  // order Drive happened to return.
  if (at === undefined && bt === undefined) return byName(a, b);
  if (at === undefined) return 1;
  if (bt === undefined) return -1;

  return at - bt || byName(a, b);
}

export function isVideo(shot: Shot): boolean {
  return shot.mimeType.startsWith("video/");
}

/** Whether the browser can be expected to render this at all. */
export function isDisplayable(shot: Shot): boolean {
  return !["image/heic", "image/heif"].includes(shot.mimeType.toLowerCase());
}
