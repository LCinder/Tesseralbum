/**
 * Where a trip's photos land in Drive.
 *
 *   Tesseralbum/Irlanda/2025/Septiembre-Octubre/
 *
 * Nothing here is typed in by hand. The country comes from the souvenir that
 * was scanned; the year and the months are read off the photos themselves.
 * Travelling to the same place again produces a different folder because the
 * dates differ — which is why a souvenir needs no name to tell two visits
 * apart.
 */

/**
 * Written out rather than taken from `Intl`, which lower-cases month names and
 * varies with the runtime's locale data. A folder name has to be identical
 * every time or the next upload creates a second folder beside the first.
 */
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export function monthName(month: number): string {
  const name = MONTHS[month];
  if (!name) throw new RangeError(`Mes fuera de rango: ${month}`);
  return name;
}

export type DateSpan = { from: Date; to: Date };

/** Earliest and latest capture date in a batch, ignoring photos with none. */
export function spanOf(dates: (Date | null | undefined)[]): DateSpan | null {
  const times = dates
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime())
    .filter(Number.isFinite);

  if (times.length === 0) return null;

  return {
    from: new Date(Math.min(...times)),
    to: new Date(Math.max(...times)),
  };
}

/** Anything with a date and some idea of where the date came from. */
export type Dated = { takenAt: Date | null; dateSource: string };

/**
 * Which date sources are worth basing a folder name on.
 *
 * EXIF is what the camera wrote; a date in the filename is what the camera
 * wrote into the filename. `file` is `File.lastModified`, which copying,
 * syncing, exporting or downloading all reset to *now* — so a photo from last
 * November arrives claiming today, and one such photo is enough to stretch a
 * trip across nine months and name its folder "Noviembre-Agosto".
 */
const TRUSTED_SOURCES = new Set(["exif", "name", "manual"]);

/** Whether a date from this source is worth basing a folder name on. */
export function isTrustedDate(dateSource: string): boolean {
  return TRUSTED_SOURCES.has(dateSource);
}

function usableDates<T extends Dated>(items: T[]): T[] {
  const dated = items.filter(
    (item) =>
      item.takenAt instanceof Date && Number.isFinite(item.takenAt.getTime()),
  );

  const trusted = dated.filter((item) => TRUSTED_SOURCES.has(item.dateSource));

  // Trusted dates win outright when any exist. Only when the whole batch has
  // none does a file date become better than nothing.
  return trusted.length > 0 ? trusted : dated;
}

/**
 * The items no trip was drawn from: no date at all, or one too weak to use.
 *
 * They are still uploaded — they ride along with the largest cluster — but the
 * interface says so out loud rather than letting a folder be named after a
 * timestamp that copying a file invented. Weak dates are only listed here when
 * something better exists; a batch with nothing but file dates uses them, and
 * calling them ignored would be untrue.
 */
export function undatedFor<T extends Dated>(items: T[]): T[] {
  const usable = new Set(usableDates(items));
  return items.filter((item) => !usable.has(item));
}

/**
 * The span drawn only from dates the camera wrote, or null when there are none.
 *
 * Unlike `clusterTrips` this never falls back to file dates: its job is to be
 * the yardstick a weak date is measured against, and a yardstick made of the
 * same bad material would measure nothing.
 */
export function trustedSpan<T extends Dated>(items: T[]): DateSpan | null {
  return spanOf(
    items
      .filter((item) => TRUSTED_SOURCES.has(item.dateSource))
      .map((item) => item.takenAt),
  );
}

/**
 * Whether the rest of the trip proves an item's date wrong.
 *
 * Only ever true of a weak date. The same fortnight of slack the trip grouping
 * uses: a file date a few days outside the trip is plausibly the real thing —
 * a photo taken on the way home — while one months outside is the copy date
 * masquerading as a capture date.
 */
export function contradicts(span: DateSpan, item: Dated): boolean {
  if (!item.takenAt) return false;
  if (TRUSTED_SOURCES.has(item.dateSource)) return false;

  const when = item.takenAt.getTime();
  const slack = SAME_TRIP_GAP_DAYS * DAY;

  return when < span.from.getTime() - slack || when > span.to.getTime() + slack;
}

/**
 * Splits a selection into the trips it actually contains.
 *
 * Picking a year of photos at once used to produce a single folder spanning the
 * lot — "Noviembre-Abril" for two separate journeys. Photos cluster in time on
 * their own, so the gap between them is the seam: the same threshold that
 * decides whether a later upload joins an existing trip.
 *
 * Items whose date cannot be trusted ride along with the largest cluster, which
 * is the best guess available and one the interface states out loud rather than
 * making quietly.
 */
export function clusterTrips<T extends Dated>(
  items: T[],
): { span: DateSpan; items: T[] }[] {
  const usable = usableDates(items);
  if (usable.length === 0) return [];

  const sorted = [...usable].sort(
    (a, b) => (a.takenAt as Date).getTime() - (b.takenAt as Date).getTime(),
  );

  const clusters: T[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = (sorted[i - 1].takenAt as Date).getTime();
    const current = (sorted[i].takenAt as Date).getTime();

    if (current - previous > SAME_TRIP_GAP_DAYS * DAY)
      clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }

  const grouped = clusters.map((members) => ({
    span: spanOf(members.map((member) => member.takenAt)) as DateSpan,
    items: members,
  }));

  // Everything left over: no date at all, or a date too weak to cluster on.
  const placed = new Set(usable);
  const leftovers = items.filter((item) => !placed.has(item));

  if (leftovers.length > 0) {
    const biggest = grouped.reduce((best, candidate) =>
      candidate.items.length > best.items.length ? candidate : best,
    );
    biggest.items.push(...leftovers);
  }

  return grouped;
}

/**
 * The month part of the folder name: "Septiembre" for a trip inside one month,
 * "Septiembre-Octubre" when it straddles two.
 *
 * A long trip is named by its ends, not every month in between — "Junio-Agosto"
 * rather than "Junio-Julio-Agosto".
 */
export function monthLabel({ from, to }: DateSpan): string {
  const start = monthName(from.getMonth());
  const end = monthName(to.getMonth());

  const sameMonth =
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear();

  return sameMonth ? start : `${start}-${end}`;
}

/**
 * The year folder. Taken from the *start* of the trip, so a New Year's trip
 * lives in one place instead of being split across two year folders — it shows
 * up as 2025/Diciembre-Enero.
 */
export function yearLabel({ from }: DateSpan): string {
  return String(from.getFullYear());
}

/** Path segments below the app root: country, year, months. */
export function tripPath(country: string, span: DateSpan): string[] {
  return [country, yearLabel(span), monthLabel(span)];
}

/**
 * How far apart two batches can sit and still count as the same trip.
 *
 * Uploading a trip in several goes must not scatter it across folders, while
 * a genuine second visit has to get its own. Two weeks separates "I forgot to
 * upload the last day" from "I went back".
 */
export const SAME_TRIP_GAP_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

/** Whether a new batch belongs to a trip already on disk. */
export function belongsToSameTrip(
  existing: DateSpan,
  incoming: DateSpan,
): boolean {
  // Overlapping ranges are obviously one trip. Otherwise measure the gap
  // between the near ends.
  const gap = Math.max(
    0,
    incoming.from.getTime() - existing.to.getTime(),
    existing.from.getTime() - incoming.to.getTime(),
  );

  return gap <= SAME_TRIP_GAP_DAYS * DAY;
}

/** The span a folder covers once a new batch is merged into it. */
export function mergeSpans(a: DateSpan, b: DateSpan): DateSpan {
  return {
    from: new Date(Math.min(a.from.getTime(), b.from.getTime())),
    to: new Date(Math.max(a.to.getTime(), b.to.getTime())),
  };
}

/**
 * Keeps a folder name unique among its siblings.
 *
 * Two separate trips can land in the same month — the 1st to the 5th and then
 * the 25th to the 30th are 20 days apart, so they are not the same trip, yet
 * both want to be called "Septiembre". Drive permits duplicate names, which
 * would leave two identical folders and no way to tell them apart.
 */
export function disambiguate(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${name} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }

  // Ninety-nine trips to one country in one month is not a real case, but
  // silently reusing a name would be worse than an obviously odd one.
  return `${name} (${Date.now()})`;
}

/** Stored on the trip folder so a later batch can recognise it. */
export type SpanProperties = {
  tripFrom: string;
  tripTo: string;
};

export function spanToProperties({ from, to }: DateSpan): SpanProperties {
  return { tripFrom: from.toISOString(), tripTo: to.toISOString() };
}

/**
 * Reads a span back off a folder's properties. Returns `null` for anything
 * unparseable, so a folder created by hand — or by an older version — is
 * treated as "not one of ours" instead of poisoning the comparison.
 */
export function spanFromProperties(
  properties: Record<string, string> | undefined,
): DateSpan | null {
  if (!properties) return null;

  const from = new Date(properties.tripFrom ?? "");
  const to = new Date(properties.tripTo ?? "");

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return null;
  }
  if (from.getTime() > to.getTime()) return null;

  return { from, to };
}
