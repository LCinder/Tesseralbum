import assert from "node:assert/strict";
import test from "node:test";
import {
  boundsOf,
  cellSize,
  clusterPins,
  filterByYear,
  yearsOf,
  type Pin,
} from "./map";

let counter = 0;

function pin(
  lat: number,
  lng: number,
  extra: Partial<Pin> = {},
): Pin {
  counter += 1;
  return {
    id: `pin-${counter}`,
    name: `IMG_${String(counter).padStart(4, "0")}.jpg`,
    lat,
    lng,
    geoSource: "exif",
    takenAt: null,
    placeId: "kioto-japon",
    mimeType: "image/jpeg",
    ...extra,
  };
}

test("photos taken in the same spot become one cluster", () => {
  const clusters = clusterPins(
    [pin(35.0116, 135.7681), pin(35.0117, 135.7682), pin(35.0118, 135.7683)],
    12,
  );

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].pins.length, 3);
});

test("photos in different cities stay apart", () => {
  const clusters = clusterPins(
    [pin(35.0116, 135.7681), pin(53.3498, -6.2603)],
    5,
  );

  assert.equal(clusters.length, 2);
});

test("zooming in splits a cluster that zooming out merges", () => {
  // Two spots ~20 km apart: one pin far out, two pins up close.
  const spots = [pin(35.0, 135.0), pin(35.2, 135.2)];

  assert.equal(clusterPins(spots, 3).length, 1, "merged when far out");
  assert.equal(clusterPins(spots, 12).length, 2, "split when zoomed in");
});

test("a cluster sits at the centre of its photos", () => {
  // Both inside one cell at this zoom, which the length assertion pins down —
  // otherwise a changed cell size would make this test check nothing.
  const clusters = clusterPins([pin(35.0, 135.0), pin(35.01, 135.01)], 8);

  assert.equal(clusters.length, 1, "should be one cluster");
  assert.ok(Math.abs(clusters[0].lat - 35.005) < 1e-9);
  assert.ok(Math.abs(clusters[0].lng - 135.005) < 1e-9);
});

test("cluster keys are stable for the same input and zoom", () => {
  const spots = [pin(35.01, 135.76), pin(35.02, 135.77)];

  const first = clusterPins(spots, 9).map((c) => c.key);
  // Reversing the input must not change the keys, or markers get recreated
  // and the map flickers on every re-render.
  const second = clusterPins(spots.slice().reverse(), 9).map((c) => c.key);

  assert.deepEqual(first.slice().sort(), second.slice().sort());
});

test("cluster keys differ between zoom levels", () => {
  const spots = [pin(35.01, 135.76)];
  assert.notEqual(clusterPins(spots, 5)[0].key, clusterPins(spots, 12)[0].key);
});

test("a cluster is approximate only when every photo in it is", () => {
  const exact = pin(35.01, 135.76, { geoSource: "exif" });
  const fromTag = pin(35.011, 135.761, { geoSource: "tag" });

  assert.equal(clusterPins([fromTag], 12)[0].approximate, true);
  assert.equal(clusterPins([exact, fromTag], 12)[0].approximate, false);
});

test("photos inside a cluster are ordered by date, undated last", () => {
  const later = pin(35.01, 135.76, { takenAt: new Date(2025, 9, 7) });
  const undated = pin(35.011, 135.761, { takenAt: null });
  const earlier = pin(35.012, 135.762, { takenAt: new Date(2025, 8, 29) });

  const [cluster] = clusterPins([later, undated, earlier], 12);

  assert.deepEqual(
    cluster.pins.map((p) => p.id),
    [earlier.id, later.id, undated.id],
  );
});

test("clusters come back biggest first", () => {
  const clusters = clusterPins(
    [pin(0, 0), pin(0.001, 0.001), pin(50, 50)],
    12,
  );

  assert.equal(clusters[0].pins.length, 2);
  assert.equal(clusters[1].pins.length, 1);
});

test("an empty set clusters into nothing", () => {
  assert.deepEqual(clusterPins([], 10), []);
});

test("cell size shrinks as zoom grows", () => {
  assert.ok(cellSize(3) > cellSize(10));
  assert.ok(cellSize(10) > 0);
});

test("years are listed newest first, without repeats", () => {
  const pins = [
    pin(0, 0, { takenAt: new Date(2024, 5, 1) }),
    pin(0, 0, { takenAt: new Date(2025, 9, 7) }),
    pin(0, 0, { takenAt: new Date(2024, 11, 25) }),
    pin(0, 0, { takenAt: null }),
  ];

  assert.deepEqual(yearsOf(pins), [2025, 2024]);
});

test("filtering by year keeps only that year; null keeps everything", () => {
  const pins = [
    pin(0, 0, { takenAt: new Date(2024, 5, 1) }),
    pin(0, 0, { takenAt: new Date(2025, 9, 7) }),
    pin(0, 0, { takenAt: null }),
  ];

  assert.equal(filterByYear(pins, 2025).length, 1);
  assert.equal(filterByYear(pins, 2024).length, 1);
  assert.equal(filterByYear(pins, 2023).length, 0);
  assert.equal(filterByYear(pins, null).length, 3, "undated included");
});

test("bounds enclose every pin with a margin", () => {
  const bounds = boundsOf([pin(35, 135), pin(53, -6)]);

  assert.ok(bounds!.south < 35);
  assert.ok(bounds!.north > 53);
  assert.ok(bounds!.west < -6);
  assert.ok(bounds!.east > 135);
});

test("a single pin gets a box with real extent", () => {
  // A zero-size box makes fitBounds zoom to maximum, which is disorienting.
  const bounds = boundsOf([pin(35.0116, 135.7681)])!;

  assert.ok(bounds.north > bounds.south);
  assert.ok(bounds.east > bounds.west);
});

test("bounds never leave the globe", () => {
  const bounds = boundsOf([pin(-90, -180), pin(90, 180)])!;

  assert.equal(bounds.south, -90);
  assert.equal(bounds.north, 90);
  assert.equal(bounds.west, -180);
  assert.equal(bounds.east, 180);
});

test("no pins means no bounds, so the caller can show the world", () => {
  assert.equal(boundsOf([]), null);
});
