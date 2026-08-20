import assert from "node:assert/strict";
import test from "node:test";
import type { Place } from "./catalog";
import { boundsOf, countriesOf, overlapping } from "./map";

function place(
  id: string,
  city: string,
  country: string,
  lat: number,
  lng: number,
): Place {
  return { id, city, country, countryCode: country.slice(0, 2).toUpperCase(), lat, lng };
}

const KIOTO = place("kioto-japon", "Kioto", "Japón", 35.0116, 135.7681);
const DUBLIN = place("dublin-irlanda", "Dublín", "Irlanda", 53.3498, -6.2603);
const CORK = place("cork-irlanda", "Cork", "Irlanda", 51.8985, -8.4756);

test("bounds enclose every place with a margin", () => {
  const bounds = boundsOf([KIOTO, DUBLIN])!;

  assert.ok(bounds.south < 35.0116);
  assert.ok(bounds.north > 53.3498);
  assert.ok(bounds.west < -6.2603);
  assert.ok(bounds.east > 135.7681);
});

test("a single place gets a box wide enough to show its surroundings", () => {
  // A zero-size box makes fitBounds zoom to maximum, landing the viewer on a
  // street corner instead of a city.
  const bounds = boundsOf([KIOTO])!;

  // 0.79 and not 0.8: the padding is exactly 0.4 either side, and adding then
  // subtracting it lands a hair under in floating point.
  assert.ok(bounds.north - bounds.south >= 0.79);
  assert.ok(bounds.east - bounds.west >= 0.79);
});

test("bounds never leave the globe", () => {
  const bounds = boundsOf([
    place("a", "A", "X", -90, -180),
    place("b", "B", "Y", 90, 180),
  ])!;

  assert.equal(bounds.south, -90);
  assert.equal(bounds.north, 90);
  assert.equal(bounds.west, -180);
  assert.equal(bounds.east, 180);
});

test("no places means no bounds, so the caller can show the world", () => {
  assert.equal(boundsOf([]), null);
});

test("far-apart places are never reported as overlapping", () => {
  assert.equal(overlapping([KIOTO, DUBLIN], 4).size, 0);
});

test("two cities in one country are separate pins, only flagged as crowded", () => {
  // Dublín and Cork must stay two pins: each leads to a different album, so
  // merging them would hide a destination behind a number.
  // 160 km apart: one marker hides the other on a map of Europe, but they
  // separate as soon as you zoom into Ireland.
  assert.equal(overlapping([DUBLIN, CORK], 4).size, 2, "collide zoomed out");
  assert.equal(overlapping([DUBLIN, CORK], 9).size, 0, "apart when zoomed in");
});

test("a lone place is never crowded", () => {
  assert.equal(overlapping([KIOTO], 1).size, 0);
  assert.equal(overlapping([], 10).size, 0);
});

test("countries are listed once each, alphabetically", () => {
  assert.deepEqual(countriesOf([DUBLIN, KIOTO, CORK]), ["Irlanda", "Japón"]);
});

test("no places means no countries", () => {
  assert.deepEqual(countriesOf([]), []);
});
