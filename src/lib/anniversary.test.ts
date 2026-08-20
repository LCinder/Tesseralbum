import assert from "node:assert/strict";
import test from "node:test";
import { anniversariesOn, yearsAgoLabel } from "./anniversary";
import type { TripRecord } from "./passport";

const on = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

let counter = 0;

function trip(from: Date | null, to?: Date): TripRecord {
  counter += 1;
  return {
    placeId: "kioto-japon",
    folderId: `folder-${counter}`,
    name: "Noviembre",
    year: String(from?.getFullYear() ?? ""),
    span: from ? { from, to: to ?? from } : null,
    photoCount: 10,
  };
}

test("a trip a year ago today is an anniversary", () => {
  const found = anniversariesOn(
    on(2026, 11, 20),
    [trip(on(2025, 11, 18), on(2025, 11, 26))],
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].yearsAgo, 1);
  assert.equal(found[0].dayOfTrip, 3, "20 Nov is the third day");
  assert.equal(found[0].tripLength, 9);
});

test("a date outside the trip is not an anniversary", () => {
  const found = anniversariesOn(
    on(2026, 11, 30),
    [trip(on(2025, 11, 18), on(2025, 11, 26))],
  );

  assert.deepEqual(found, []);
});

test("the first and last days both count", () => {
  const journey = [trip(on(2025, 11, 18), on(2025, 11, 26))];

  assert.equal(anniversariesOn(on(2026, 11, 18), journey)[0].dayOfTrip, 1);
  assert.equal(anniversariesOn(on(2026, 11, 26), journey)[0].dayOfTrip, 9);
});

test("this year's trip is not an anniversary of itself", () => {
  const found = anniversariesOn(
    on(2026, 4, 5),
    [trip(on(2026, 4, 1), on(2026, 4, 9))],
  );

  assert.deepEqual(found, []);
});

test("a trip still to come is never an anniversary", () => {
  const found = anniversariesOn(on(2026, 5, 1), [trip(on(2027, 5, 1))]);
  assert.deepEqual(found, []);
});

test("several years show as several years", () => {
  const found = anniversariesOn(on(2026, 3, 14), [trip(on(2021, 3, 14))]);

  assert.equal(found[0].yearsAgo, 5);
});

test("the most recent anniversary comes first", () => {
  const found = anniversariesOn(on(2026, 7, 4), [
    trip(on(2019, 7, 4)),
    trip(on(2025, 7, 4)),
    trip(on(2022, 7, 4)),
  ]);

  assert.deepEqual(
    found.map((a) => a.yearsAgo),
    [1, 4, 7],
  );
});

test("a New Year trip matches each of its days in the right year", () => {
  // 28 December 2024 to 4 January 2025 spans two years: its January days are
  // one year closer to today than its December ones.
  const journey = [trip(on(2024, 12, 28), on(2025, 1, 4))];

  const december = anniversariesOn(on(2026, 12, 30), journey);
  assert.equal(december.length, 1, "30 Dec matches, two years on");
  assert.equal(december[0].yearsAgo, 2);
  assert.equal(december[0].dayOfTrip, 3);

  const january = anniversariesOn(on(2026, 1, 2), journey);
  assert.equal(january.length, 1, "2 Jan matches");
  assert.equal(january[0].yearsAgo, 1, "2 Jan 2025 was one year before 2026");
  assert.equal(january[0].dayOfTrip, 6);
});

test("a trip with no dates can have no anniversary", () => {
  assert.deepEqual(anniversariesOn(on(2026, 6, 1), [trip(null)]), []);
  assert.deepEqual(anniversariesOn(on(2026, 6, 1), []), []);
});

test("29 February does not drift onto the 28th in an ordinary year", () => {
  // Matching by calendar date rather than by elapsed days is what keeps this
  // honest: "365 days ago" would land on the wrong date one year in four.
  const leapTrip = [trip(on(2024, 2, 29))];

  assert.deepEqual(anniversariesOn(on(2025, 2, 28), leapTrip), []);
  assert.equal(anniversariesOn(on(2028, 2, 29), leapTrip)[0].yearsAgo, 4);
});

test("the time of day never decides a match", () => {
  const journey = [trip(on(2025, 6, 10))];

  for (const hour of [0, 8, 23]) {
    const today = new Date(2026, 5, 10, hour, 45);
    assert.equal(anniversariesOn(today, journey).length, 1, `at ${hour}h`);
  }
});

test("the label reads like a person would say it", () => {
  assert.equal(yearsAgoLabel(1), "Hace un año");
  assert.equal(yearsAgoLabel(2), "Hace 2 años");
  assert.equal(yearsAgoLabel(11), "Hace 11 años");
});
