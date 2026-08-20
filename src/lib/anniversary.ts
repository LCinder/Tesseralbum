import type { TripRecord } from "@/lib/passport";
import { daysInSpan } from "@/lib/passport";

/**
 * "A year ago today you were in Kyoto."
 *
 * The souvenir lives on a shelf at home, so scanning happens months after the
 * trip — this app is for remembering, not for travelling. Something that finds
 * you, rather than waiting to be searched, is the difference between a store
 * of files and an album.
 */

export type Anniversary = {
  trip: TripRecord;
  /** Whole years since the trip: 1 for last year, 2 the year before. */
  yearsAgo: number;
  /** Which day of the trip today matches, 1-based, for a longer journey. */
  dayOfTrip: number;
  tripLength: number;
};

/**
 * Whether today falls on the same calendar day as some day of a past trip.
 *
 * Matching by month and day rather than by elapsed time, because that is what
 * an anniversary is: leap years and time zones must not shift it, and "365
 * days ago" lands on the wrong date one year in four.
 */
export function anniversariesOn(
  today: Date,
  trips: TripRecord[],
): Anniversary[] {
  const found: Anniversary[] = [];

  for (const trip of trips) {
    if (!trip.span) continue;

    const match = matchingDay(today, trip.span);
    if (!match) continue;

    found.push({
      trip,
      yearsAgo: match.yearsAgo,
      dayOfTrip: match.dayOfTrip,
      tripLength: daysInSpan(trip.span),
    });
  }

  // The most recent first: last year is a sharper memory than five years ago.
  return found.sort((a, b) => a.yearsAgo - b.yearsAgo);
}

/**
 * Which day of the trip shares today's date, and how long ago it was.
 *
 * The age is measured from the **matching day**, not from the trip's start.
 * A journey from 28 December 2024 to 4 January 2025 spans two years, so on
 * 2 January 2026 the right answer is "a year ago" — its January days are a
 * year closer to today than its December ones.
 */
function matchingDay(
  today: Date,
  span: { from: Date; to: Date },
): { dayOfTrip: number; yearsAgo: number } | null {
  const month = today.getMonth();
  const day = today.getDate();

  const cursor = new Date(
    span.from.getFullYear(),
    span.from.getMonth(),
    span.from.getDate(),
  );
  const last = new Date(
    span.to.getFullYear(),
    span.to.getMonth(),
    span.to.getDate(),
  );

  let dayOfTrip = 1;

  while (cursor <= last) {
    const yearsAgo = today.getFullYear() - cursor.getFullYear();

    // Zero would make the trip you are on right now an anniversary of itself,
    // and a negative one would celebrate a trip you have not taken.
    if (
      yearsAgo >= 1 &&
      cursor.getMonth() === month &&
      cursor.getDate() === day
    ) {
      return { dayOfTrip, yearsAgo };
    }

    cursor.setDate(cursor.getDate() + 1);
    dayOfTrip += 1;
  }

  return null;
}

/** How to say it: "Hace un año", "Hace 3 años". */
export function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "Hace un año" : `Hace ${yearsAgo} años`;
}
