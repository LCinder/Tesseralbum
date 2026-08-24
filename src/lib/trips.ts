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
 *
 * A `manual` date was typed in by the traveller and a `nearby` one was taken
 * from the photos either side of it, which is the neighbours' own date and no
 * weaker for having been passed along.
 */
const TRUSTED_SOURCES = new Set(["exif", "name", "manual", "nearby"]);

/** Whether a date from this source is worth basing a folder name on. */
export function isTrustedDate(dateSource: string): boolean {
  return TRUSTED_SOURCES.has(dateSource);
}

/** Whether an item carries a date that can be read at all. */
function hasDate<T extends Dated>(item: T): boolean {
  return (
    item.takenAt instanceof Date && Number.isFinite(item.takenAt.getTime())
  );
}

/**
 * Groups dated items by the gaps between them, oldest first.
 *
 * The seam is the same fortnight that decides whether a later upload joins a
 * trip already on disk, so a batch is split exactly where a second visit
 * would have been given its own folder.
 */
function clustersOf<T extends Dated>(dated: T[]): T[][] {
  if (dated.length === 0) return [];

  const sorted = [...dated].sort(
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

  return clusters;
}

function usableDates<T extends Dated>(items: T[]): T[] {
  const dated = items.filter(hasDate);
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
 * The items whose dates are solid enough to date the others from.
 *
 * A camera date, a date read off a filename or one the traveller typed in is
 * an anchor outright. When a batch has none of those, filesystem timestamps
 * are all there is — and they are not uniformly wrong: they agree with each
 * other for every file that was left alone, and disagree only where one was
 * copied, exported or forwarded, which stamps it with the day that happened.
 * So the group most of them fall into is the trip, and the strays are copies.
 *
 * Only when it really is most of them. An even split between two groups is two
 * journeys uploaded together, not one journey with stragglers, and picking a
 * winner there would quietly move half the photos to the wrong month.
 */
function anchorsIn<T extends Dated>(items: T[]): Set<T> {
  const dated = items.filter(hasDate);
  if (dated.length === 0) return new Set();

  const trusted = dated.filter((item) => TRUSTED_SOURCES.has(item.dateSource));
  if (trusted.length > 0) return new Set(trusted);

  const clusters = clustersOf(dated);
  if (clusters.length <= 1) return new Set(dated);

  const biggest = clusters.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best,
  );

  return biggest.length * 2 > dated.length ? new Set(biggest) : new Set(dated);
}

/** Something dated that also has a name, so its neighbours can be found. */
export type Sequenced = Dated & { name: string };

/**
 * The date each unanchored item should borrow, taken from the photos beside it.
 *
 * Photos come off a camera in order and are named in that order, so the file
 * either side of one that lost its date was almost certainly taken minutes
 * from it. That neighbour's date is a far better answer than the day the file
 * happened to be copied, and it costs nothing to look.
 *
 * Returns only the items it can answer for, so a caller applies the dates in
 * whatever shape its own records take. An item with no anchor anywhere in the
 * batch is left out rather than given an invented date.
 */
export function inferDates<T extends Sequenced>(items: T[]): Map<T, Date> {
  const inferred = new Map<T, Date>();

  const anchors = anchorsIn(items);
  if (anchors.size === 0 || anchors.size === items.length) return inferred;

  // The order the camera produced them, which is what makes two files
  // neighbours. Numeric, or IMG_10 would sit before IMG_2.
  const order = [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );

  const before: number[] = new Array(order.length).fill(-1);
  const after: number[] = new Array(order.length).fill(-1);

  let last = -1;
  for (let i = 0; i < order.length; i += 1) {
    before[i] = last;
    if (anchors.has(order[i])) last = i;
  }

  last = -1;
  for (let i = order.length - 1; i >= 0; i -= 1) {
    after[i] = last;
    if (anchors.has(order[i])) last = i;
  }

  for (let i = 0; i < order.length; i += 1) {
    const item = order[i];
    if (anchors.has(item)) continue;

    // The closer of the two neighbours by position in the sequence, and the
    // one before it when they are equally close: a photo tends to belong with
    // what came before it rather than what interrupted it.
    const back = before[i] < 0 ? Infinity : i - before[i];
    const forward = after[i] < 0 ? Infinity : after[i] - i;

    if (back === Infinity && forward === Infinity) continue;

    const source = order[back <= forward ? before[i] : after[i]];
    inferred.set(item, source.takenAt as Date);
  }

  return inferred;
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

  const clusters = clustersOf(usable);

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
