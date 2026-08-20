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

  return { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) };
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
    from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();

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
