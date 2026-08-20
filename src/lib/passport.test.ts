import assert from "node:assert/strict";
import test from "node:test";
import type { Place } from "./catalog";
import {
  buildPassport,
  daysInSpan,
  tripsFromListing,
  type TripRecord,
} from "./passport";

const on = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

function place(id: string, city: string, country: string, code: string): Place {
  return {
    id,
    slug: id.slice(0, 10).padEnd(10, "x"),
    city,
    country,
    countryCode: code,
    lat: 0,
    lng: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const KIOTO = place("kioto-japon", "Kioto", "Japón", "JP");
const OSAKA = place("osaka-japon", "Osaka", "Japón", "JP");
const DUBLIN = place("dublin-irlanda", "Dublín", "Irlanda", "IE");

let counter = 0;

function trip(
  placeId: string,
  year: string,
  span: { from: Date; to: Date } | null,
  photoCount: number,
): TripRecord {
  counter += 1;
  return {
    placeId,
    folderId: `folder-${counter}`,
    name: "Septiembre",
    year,
    span,
    photoCount,
  };
}

test("a trip counts its days the way a traveller does", () => {
  // 29 September to 7 October is nine days away, not eight.
  assert.equal(daysInSpan({ from: on(2025, 9, 29), to: on(2025, 10, 7) }), 9);
});

test("a day trip is one day, not zero", () => {
  const day = on(2025, 3, 14);
  assert.equal(daysInSpan({ from: day, to: day }), 1);
});

test("times of day do not add or drop a day", () => {
  // Landing at 23:00 and leaving at 06:00 the next morning is two days.
  const span = {
    from: new Date(2025, 4, 1, 23, 30),
    to: new Date(2025, 4, 2, 6, 15),
  };
  assert.equal(daysInSpan(span), 2);
});

test("an empty archive produces an empty passport, not zeros with a country", () => {
  const passport = buildPassport([], []);

  assert.deepEqual(passport.countries, []);
  assert.equal(passport.tripCount, 0);
  assert.equal(passport.photoCount, 0);
  assert.equal(passport.daysTravelling, 0);
  assert.equal(passport.firstVisit, null);
  assert.equal(passport.lastVisit, null);
});

test("two cities in one country make one passport entry", () => {
  const passport = buildPassport(
    [KIOTO, OSAKA],
    [
      trip(KIOTO.id, "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }, 40),
      trip(OSAKA.id, "2024", { from: on(2024, 11, 27), to: on(2024, 11, 30) }, 12),
    ],
  );

  assert.equal(passport.countries.length, 1);
  assert.deepEqual(passport.countries[0].cities, ["Kioto", "Osaka"]);
  assert.equal(passport.countries[0].trips, 2);
  assert.equal(passport.countries[0].photos, 52);
  assert.equal(passport.cityCount, 2);
});

test("a country's first and last visit span all of its trips", () => {
  const passport = buildPassport(
    [KIOTO],
    [
      trip(KIOTO.id, "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }, 10),
      trip(KIOTO.id, "2026", { from: on(2026, 4, 2), to: on(2026, 4, 9) }, 20),
    ],
  );

  const japan = passport.countries[0];
  assert.equal(japan.firstVisit?.getFullYear(), 2024);
  assert.equal(japan.lastVisit?.getFullYear(), 2026);
  assert.equal(japan.trips, 2);
});

test("countries are ordered by how often they were visited", () => {
  const passport = buildPassport(
    [KIOTO, DUBLIN],
    [
      trip(DUBLIN.id, "2025", { from: on(2025, 9, 29), to: on(2025, 10, 7) }, 5),
      trip(KIOTO.id, "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }, 5),
      trip(KIOTO.id, "2026", { from: on(2026, 4, 2), to: on(2026, 4, 9) }, 5),
    ],
  );

  assert.equal(passport.countries[0].country, "Japón");
  assert.equal(passport.countries[1].country, "Irlanda");
});

test("days travelling sums every trip", () => {
  const passport = buildPassport(
    [KIOTO, DUBLIN],
    [
      trip(KIOTO.id, "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }, 0),
      trip(DUBLIN.id, "2025", { from: on(2025, 9, 29), to: on(2025, 10, 7) }, 0),
    ],
  );

  assert.equal(passport.daysTravelling, 9 + 9);
});

test("a trip with no dates still counts, but adds no days", () => {
  // Photos stripped of their EXIF should not erase the trip from the record.
  const passport = buildPassport([KIOTO], [trip(KIOTO.id, "2024", null, 7)]);

  assert.equal(passport.tripCount, 1);
  assert.equal(passport.photoCount, 7);
  assert.equal(passport.daysTravelling, 0);
  assert.equal(passport.countries[0].firstVisit, null);
});

test("a trip whose place left the catalogue is left out entirely", () => {
  // Attributing it would put a country on the passport that cannot be named.
  const passport = buildPassport(
    [KIOTO],
    [
      trip(KIOTO.id, "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }, 10),
      trip("borrado-hace-tiempo", "2023", null, 99),
    ],
  );

  assert.equal(passport.tripCount, 1);
  assert.equal(passport.photoCount, 10, "orphan photos are not counted");
  assert.equal(passport.countries.length, 1);
});

test("years come back newest first with their totals", () => {
  const passport = buildPassport(
    [KIOTO, DUBLIN],
    [
      trip(KIOTO.id, "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }, 10),
      trip(DUBLIN.id, "2025", { from: on(2025, 9, 29), to: on(2025, 10, 7) }, 25),
      trip(KIOTO.id, "2025", { from: on(2025, 2, 1), to: on(2025, 2, 5) }, 5),
    ],
  );

  assert.deepEqual(passport.byYear, [
    { year: "2025", trips: 2, photos: 30 },
    { year: "2024", trips: 1, photos: 10 },
  ]);
});

test("a place with no trips is not a visited city", () => {
  // A sticker registered but never used is a plan, not a journey.
  const passport = buildPassport([KIOTO, DUBLIN], [trip(KIOTO.id, "2024", null, 3)]);

  assert.equal(passport.cityCount, 1);
  assert.equal(passport.countries.length, 1);
});

test("trips are rebuilt from a flat listing of folders and files", () => {
  const folders = [
    { id: "year25", name: "2025", parents: ["irlanda"] },
    {
      id: "sept",
      name: "Septiembre-Octubre",
      parents: ["year25"],
      appProperties: {
        tripFrom: on(2025, 9, 29).toISOString(),
        tripTo: on(2025, 10, 7).toISOString(),
      },
    },
  ];

  const media = [
    { parents: ["sept"], appProperties: { placeId: DUBLIN.id } },
    { parents: ["sept"], appProperties: { placeId: DUBLIN.id } },
    { parents: ["sept"], appProperties: { placeId: DUBLIN.id } },
  ];

  const [record] = tripsFromListing(folders, media);

  assert.equal(record.placeId, DUBLIN.id);
  assert.equal(record.name, "Septiembre-Octubre");
  assert.equal(record.year, "2025");
  assert.equal(record.photoCount, 3);
  assert.equal(record.span?.from.getTime(), on(2025, 9, 29).getTime());
});

test("one trip folder holding two cities becomes two records", () => {
  // Scanning the Dublín magnet and the Cork one on the same journey files both
  // under Irlanda/2025/Septiembre — but they are two albums.
  const folders = [
    { id: "year25", name: "2025", parents: ["irlanda"] },
    { id: "sept", name: "Septiembre", parents: ["year25"] },
  ];

  const media = [
    { parents: ["sept"], appProperties: { placeId: "dublin-irlanda" } },
    { parents: ["sept"], appProperties: { placeId: "dublin-irlanda" } },
    { parents: ["sept"], appProperties: { placeId: "cork-irlanda" } },
  ];

  const records = tripsFromListing(folders, media);

  assert.equal(records.length, 2);
  assert.equal(
    records.find((r) => r.placeId === "dublin-irlanda")?.photoCount,
    2,
  );
  assert.equal(records.find((r) => r.placeId === "cork-irlanda")?.photoCount, 1);
});

test("files without a parent or a place are skipped", () => {
  const folders = [{ id: "sept", name: "Septiembre", parents: ["year25"] }];

  const records = tripsFromListing(folders, [
    { appProperties: { placeId: "kioto-japon" } },
    { parents: ["sept"] },
    { parents: ["desconocida"], appProperties: { placeId: "kioto-japon" } },
  ]);

  assert.deepEqual(records, []);
});

test("a trip folder with no year parent still yields a record", () => {
  // Better a trip with a blank year than a trip silently missing from the
  // passport.
  const records = tripsFromListing(
    [{ id: "suelta", name: "Marzo" }],
    [{ parents: ["suelta"], appProperties: { placeId: KIOTO.id } }],
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].year, "");
});
