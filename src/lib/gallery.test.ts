import assert from "node:assert/strict";
import test from "node:test";
import {
  byDateThenName,
  byTripDate,
  withNeighbourDates,
  type Shot,
  type Trip,
} from "./gallery";
import type { Provenance } from "./media";

const on = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

const trip = (
  name: string,
  year: string,
  span: { from: Date; to: Date } | null,
): Trip => ({ folderId: name, name, year, span, shots: [] });

const shot = (
  name: string,
  takenAt: Date | null,
  dateSource: Provenance = takenAt ? "exif" : "none",
): Shot => ({
  id: name,
  name,
  mimeType: "image/jpeg",
  takenAt,
  dateSource,
  lat: null,
  lng: null,
  geoSource: "tag",
  bytes: null,
});

const order = <T extends { name: string }>(
  items: T[],
  by: (a: T, b: T) => number,
) => [...items].sort(by).map((item) => item.name);

test("an album runs from the oldest trip to the newest", () => {
  const trips = [
    trip("Marzo", "2026", { from: on(2026, 3, 2), to: on(2026, 3, 9) }),
    trip("Noviembre", "2024", { from: on(2024, 11, 18), to: on(2024, 11, 26) }),
    trip("Septiembre-Octubre", "2025", {
      from: on(2025, 9, 29),
      to: on(2025, 10, 7),
    }),
  ];

  assert.deepEqual(order(trips, byTripDate), [
    "Noviembre",
    "Septiembre-Octubre",
    "Marzo",
  ]);
});

test("two trips in one year are ordered by when they started", () => {
  const trips = [
    trip("Octubre", "2025", { from: on(2025, 10, 3), to: on(2025, 10, 6) }),
    trip("Febrero", "2025", { from: on(2025, 2, 1), to: on(2025, 2, 4) }),
  ];

  assert.deepEqual(order(trips, byTripDate), ["Febrero", "Octubre"]);
});

test("a folder we cannot date trails the trips we can", () => {
  const trips = [
    trip("Fotos sueltas", "2025", null),
    trip("Abril", "2025", { from: on(2025, 4, 1), to: on(2025, 4, 3) }),
  ];

  assert.deepEqual(order(trips, byTripDate), ["Abril", "Fotos sueltas"]);
});

test("a trip outside any year folder trails the years", () => {
  const trips = [
    trip("Suelto", "", null),
    trip("Enero", "2024", { from: on(2024, 1, 1), to: on(2024, 1, 2) }),
  ];

  assert.deepEqual(order(trips, byTripDate), ["Enero", "Suelto"]);
});

test("photos inside a trip run oldest first", () => {
  const shots = [
    shot("c.jpg", on(2025, 10, 7)),
    shot("a.jpg", on(2025, 9, 29)),
    shot("b.jpg", on(2025, 10, 1)),
  ];

  assert.deepEqual(order(shots, byDateThenName), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("photos with no date go last instead of to the front", () => {
  const shots = [
    shot("sin-fecha.jpg", null),
    shot("con-fecha.jpg", on(2025, 9, 29)),
  ];

  assert.deepEqual(order(shots, byDateThenName), [
    "con-fecha.jpg",
    "sin-fecha.jpg",
  ]);
});

test("two photos taken in the same second keep a stable order", () => {
  const same = on(2025, 9, 29);
  const shots = [shot("IMG_2.jpg", same), shot("IMG_1.jpg", same)];

  assert.deepEqual(order(shots, byDateThenName), ["IMG_1.jpg", "IMG_2.jpg"]);
});

test("photos sharing a date fall back to a human reading of the number", () => {
  // A burst, or a folder copied in one go so every file has the same mtime.
  // Alphabetical order puts IMG_10 before IMG_2, which reads as shuffled.
  const same = on(2025, 9, 29);
  const shots = [
    shot("IMG_10.jpg", same),
    shot("IMG_2.jpg", same),
    shot("IMG_1.jpg", same),
    shot("IMG_20.jpg", same),
  ];

  assert.deepEqual(order(shots, byDateThenName), [
    "IMG_1.jpg",
    "IMG_2.jpg",
    "IMG_10.jpg",
    "IMG_20.jpg",
  ]);
});

test("a photo copied later takes the date of the trip around it", () => {
  // The reported case: the album put "20/8/2026" in the corner of a photo
  // taken in November, because that is the day the file was copied. The
  // photos either side of it knew better.
  const shots = [
    shot("a.jpg", on(2025, 11, 18)),
    shot("b.jpg", on(2025, 11, 22)),
    shot("copiada.jpg", on(2026, 8, 20), "file"),
  ];

  const cleaned = withNeighbourDates(shots);
  const copied = cleaned.find((one) => one.name === "copiada.jpg");

  assert.equal(copied?.takenAt?.getMonth(), 10);
  assert.equal(copied?.takenAt?.getFullYear(), 2025);
  assert.equal(copied?.dateSource, "nearby");
  assert.equal(cleaned.length, 3, "the photo itself is still in the album");
});

test("a lone photo with only a copy date keeps it, having nothing to borrow", () => {
  // One photo, no neighbours, no camera date anywhere. There is nothing to
  // correct it with, and inventing a date would be worse than the honest
  // wrong one the filesystem gave.
  const shots = [shot("c.jpg", on(2026, 8, 20), "file")];

  const cleaned = withNeighbourDates(shots);

  assert.equal(cleaned[0].takenAt?.getTime(), on(2026, 8, 20).getTime());
  assert.equal(cleaned[0].dateSource, "file");
});

test("two trips uploaded together are not collapsed into one", () => {
  // An even split of file dates is two journeys, so neither half is
  // rewritten to look like the other.
  const shots = [
    shot("a1.jpg", on(2025, 4, 2), "file"),
    shot("a2.jpg", on(2025, 4, 3), "file"),
    shot("b1.jpg", on(2025, 11, 18), "file"),
    shot("b2.jpg", on(2025, 11, 19), "file"),
  ];

  const cleaned = withNeighbourDates(shots);

  assert.deepEqual(
    cleaned.map((one) => one.takenAt?.getMonth()),
    [3, 3, 10, 10],
  );
});

test("the photos with real dates come through untouched", () => {
  const shots = [
    shot("a.jpg", on(2025, 11, 18)),
    shot("copiada.jpg", on(2026, 8, 20), "file"),
  ];

  const kept = withNeighbourDates(shots).find((one) => one.name === "a.jpg");

  assert.equal(kept?.takenAt?.getTime(), on(2025, 11, 18).getTime());
  assert.equal(kept?.dateSource, "exif");
});

test("a trip with no camera dates keeps what it has", () => {
  // Nothing to measure against. Every photo may well have been copied, but
  // guessing that would leave a whole trip with no dates at all.
  const shots = [
    shot("a.jpg", on(2026, 8, 20), "file"),
    shot("b.jpg", on(2026, 8, 20), "file"),
  ];

  const cleaned = withNeighbourDates(shots);

  assert.equal(cleaned[0].takenAt?.getTime(), on(2026, 8, 20).getTime());
  assert.equal(cleaned[1].takenAt?.getTime(), on(2026, 8, 20).getTime());
});

test("a photo stripped of its date sorts last rather than out of order", () => {
  const shots = withNeighbourDates([
    shot("a.jpg", on(2025, 11, 18)),
    shot("copiada.jpg", on(2026, 8, 20), "file"),
    shot("b.jpg", on(2025, 11, 22)),
  ]).sort(byDateThenName);

  assert.deepEqual(
    shots.map((one) => one.name),
    ["a.jpg", "b.jpg", "copiada.jpg"],
  );
});
