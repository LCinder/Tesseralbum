import type { Place } from "@/lib/catalog";
import { spanFromProperties, type DateSpan } from "@/lib/trips";

// Re-exported so the passport page keeps one import for everything it shows.
export { flagOf } from "@/lib/flags";

/**
 * What the archive adds up to.
 *
 * Every number here is derived from trips, never stored, so it cannot drift
 * out of step with what is actually in Drive. The point is a page that reads
 * like a record of travelling rather than a folder listing.
 */

export type TripRecord = {
  placeId: string;
  folderId: string;
  name: string;
  year: string;
  span: DateSpan | null;
  photoCount: number;
};

export type CountryEntry = {
  country: string;
  countryCode: string;
  cities: string[];
  trips: number;
  photos: number;
  firstVisit: Date | null;
  lastVisit: Date | null;
};

export type Passport = {
  countries: CountryEntry[];
  cityCount: number;
  tripCount: number;
  photoCount: number;
  /** Days spent travelling, counting each trip's span inclusively. */
  daysTravelling: number;
  firstVisit: Date | null;
  lastVisit: Date | null;
  /** Trips per year, newest first, for the little bar chart. */
  byYear: { year: string; trips: number; photos: number }[];
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Nights plus one: a trip from the 29th to the 7th is nine days, not eight.
 * Counting the way a traveller counts, not the way a subtraction does.
 */
export function daysInSpan(span: DateSpan): number {
  const from = startOfDay(span.from);
  const to = startOfDay(span.to);
  return Math.round((to - from) / DAY) + 1;
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function buildPassport(places: Place[], trips: TripRecord[]): Passport {
  const byId = new Map(places.map((place) => [place.id, place]));
  const countries = new Map<string, CountryEntry>();
  const years = new Map<string, { trips: number; photos: number }>();

  let photoCount = 0;
  let daysTravelling = 0;
  let firstVisit: Date | null = null;
  let lastVisit: Date | null = null;

  for (const trip of trips) {
    const place = byId.get(trip.placeId);
    // A trip whose place left the catalogue cannot be attributed, and guessing
    // would put a country on the passport that was never visited.
    if (!place) continue;

    photoCount += trip.photoCount;
    if (trip.span) daysTravelling += daysInSpan(trip.span);

    const yearly = years.get(trip.year) ?? { trips: 0, photos: 0 };
    yearly.trips += 1;
    yearly.photos += trip.photoCount;
    years.set(trip.year, yearly);

    const entry = countries.get(place.country) ?? {
      country: place.country,
      countryCode: place.countryCode,
      cities: [],
      trips: 0,
      photos: 0,
      firstVisit: null,
      lastVisit: null,
    };

    entry.trips += 1;
    entry.photos += trip.photoCount;
    if (!entry.cities.includes(place.city)) entry.cities.push(place.city);

    if (trip.span) {
      entry.firstVisit = earlier(entry.firstVisit, trip.span.from);
      entry.lastVisit = later(entry.lastVisit, trip.span.to);
      firstVisit = earlier(firstVisit, trip.span.from);
      lastVisit = later(lastVisit, trip.span.to);
    }

    countries.set(place.country, entry);
  }

  for (const entry of countries.values()) {
    entry.cities.sort((a, b) => a.localeCompare(b));
  }

  return {
    countries: [...countries.values()].sort(
      (a, b) => b.trips - a.trips || a.country.localeCompare(b.country),
    ),
    // Only cities that were actually travelled to: a sticker with no photos
    // yet is a plan, not a visit.
    cityCount: new Set(
      trips
        .filter((trip) => byId.has(trip.placeId))
        .map((trip) => trip.placeId),
    ).size,
    tripCount: trips.filter((trip) => byId.has(trip.placeId)).length,
    photoCount,
    daysTravelling,
    firstVisit,
    lastVisit,
    byYear: [...years.entries()]
      .map(([year, counts]) => ({ year, ...counts }))
      .sort((a, b) => b.year.localeCompare(a.year)),
  };
}

function earlier(current: Date | null, candidate: Date): Date {
  return current === null || candidate < current ? candidate : current;
}

function later(current: Date | null, candidate: Date): Date {
  return current === null || candidate > current ? candidate : current;
}

/**
 * Reconstructs every trip from two flat listings.
 *
 * Drive gives files their parent folder id, and trip folders carry their date
 * span in appProperties — so grouping photos by parent recovers the whole
 * archive without walking the tree.
 *
 * Photos are attributed by the `placeId` they carry, not by which folder they
 * sit in: a country folder is shared, so one trip to Ireland can hold photos
 * from both Dublín and Cork.
 */
export function tripsFromListing(
  folders: {
    id: string;
    name: string;
    appProperties?: Record<string, string>;
    parents?: string[];
  }[],
  media: { appProperties?: Record<string, string>; parents?: string[] }[],
): TripRecord[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  // folderId + placeId, since one trip folder can serve two cities.
  const counts = new Map<
    string,
    { folderId: string; placeId: string; photos: number }
  >();

  for (const file of media) {
    const folderId = file.parents?.[0];
    const placeId = file.appProperties?.placeId;
    if (!folderId || !placeId) continue;

    const key = `${folderId}::${placeId}`;
    const entry = counts.get(key) ?? { folderId, placeId, photos: 0 };
    entry.photos += 1;
    counts.set(key, entry);
  }

  const records: TripRecord[] = [];

  for (const { folderId, placeId, photos } of counts.values()) {
    const folder = byId.get(folderId);
    if (!folder) continue;

    // The year folder is the trip folder's parent, and its name is the year.
    const yearFolder = folder.parents?.[0]
      ? byId.get(folder.parents[0])
      : undefined;

    records.push({
      placeId,
      folderId,
      name: folder.name,
      year: yearFolder?.name ?? "",
      span: spanFromProperties(folder.appProperties),
      photoCount: photos,
    });
  }

  return records;
}
