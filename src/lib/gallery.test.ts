import assert from "node:assert/strict";
import test from "node:test";
import { byDateThenName, byTripDate, type Shot, type Trip } from "./gallery";

const on = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

const trip = (
  name: string,
  year: string,
  span: { from: Date; to: Date } | null,
): Trip => ({ folderId: name, name, year, span, shots: [] });

const shot = (name: string, takenAt: Date | null): Shot => ({
  id: name,
  name,
  mimeType: "image/jpeg",
  takenAt,
  dateSource: takenAt ? "exif" : "none",
  lat: null,
  lng: null,
  geoSource: "tag",
  bytes: null,
});

const order = <T extends { name: string }>(items: T[], by: (a: T, b: T) => number) =>
  [...items].sort(by).map((item) => item.name);

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
