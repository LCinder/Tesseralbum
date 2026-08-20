import { ROOT_FOLDER, type Place } from "@/lib/catalog";
import {
  FOLDER_MIME,
  findChild,
  listChildren,
  type DriveFile,
  type TokenSource,
} from "@/lib/google/drive";
import { spanFromProperties, type DateSpan } from "@/lib/trips";

/**
 * Reading the album back out of Drive.
 *
 * Deliberately uses `findChild` rather than `ensurePath`: looking at a place
 * that has no photos yet must not create folders as a side effect of being
 * viewed.
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
 * Photos are filtered by the `placeId` they carry, because a country folder is
 * shared: Dublín and Cork both file under Irlanda, and one trip folder can
 * hold photos from both if two stickers were scanned along the way.
 */
export async function listTrips(
  getToken: TokenSource,
  place: Place,
): Promise<Trip[]> {
  const country = await findChild(getToken, "root", ROOT_FOLDER, {
    folder: true,
  }).then((root) =>
    root ? findChild(getToken, root.id, place.country, { folder: true }) : null,
  );

  if (!country) return [];

  const years = await listChildren(getToken, country.id, { foldersOnly: true });
  const trips: Trip[] = [];

  for (const year of years) {
    const folders = await listChildren(getToken, year.id, {
      foldersOnly: true,
    });

    for (const folder of folders) {
      const children = await listChildren(getToken, folder.id);

      const shots = children
        .filter((file) => file.mimeType !== FOLDER_MIME)
        .filter((file) => file.appProperties?.placeId === place.id)
        .map(toShot)
        .sort(byDateThenName);

      if (shots.length === 0) continue;

      trips.push({
        folderId: folder.id,
        name: folder.name,
        year: year.name,
        span: spanFromProperties(folder.appProperties),
        shots,
      });
    }
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
