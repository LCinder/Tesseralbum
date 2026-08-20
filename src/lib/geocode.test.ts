import assert from "node:assert/strict";
import test from "node:test";
import { normalize } from "./geocode";

// Shapes captured from real Nominatim responses, not invented.

test("a city comes through with its ISO code upper-cased", () => {
  const found = normalize({
    place_id: 1,
    name: "Kioto",
    display_name: "Kioto, Prefectura de Kioto, Japón",
    lat: "35.0115754",
    lon: "135.7681441",
    addresstype: "city",
    address: { city: "Kioto", country: "Japón", country_code: "jp" },
  });

  assert.equal(found?.city, "Kioto");
  assert.equal(found?.country, "Japón");
  assert.equal(found?.countryCode, "JP");
  assert.ok(Math.abs((found?.lat ?? 0) - 35.0115754) < 1e-6);
  assert.ok(Math.abs((found?.lng ?? 0) - 135.7681441) < 1e-6);
});

test("the settlement field cascade covers every size of place", () => {
  const base = { country: "España", country_code: "es" };

  for (const [key, expected] of [
    ["town", "Ronda"],
    ["village", "Albarracín"],
    ["municipality", "La Coruña"],
    ["hamlet", "Bárcena"],
  ] as const) {
    const found = normalize({
      lat: "40",
      lon: "-3",
      address: { ...base, [key]: expected },
    });
    assert.equal(found?.city, expected, `failed for ${key}`);
  }
});

test("a landmark with no settlement field falls back to its name", () => {
  // Machu Picchu really does come back with addresstype "tourism" and no
  // city/town/village at all.
  const found = normalize({
    name: "Machupicchu",
    lat: "-13.1631",
    lon: "-72.5450",
    addresstype: "tourism",
    address: { country: "Perú", country_code: "pe" },
  });

  assert.equal(found?.city, "Machupicchu");
  assert.equal(found?.countryCode, "PE");
});

test("results missing what a place needs are dropped, not guessed", () => {
  const coords = { lat: "40", lon: "-3" };

  assert.equal(normalize({ ...coords, address: {} }), null, "no city");
  assert.equal(
    normalize({ ...coords, name: "X", address: { country_code: "es" } }),
    null,
    "no country name",
  );
  assert.equal(
    normalize({ ...coords, name: "X", address: { country: "España" } }),
    null,
    "no country code",
  );
});

test("unparseable or out-of-range coordinates are refused", () => {
  const address = { city: "X", country: "España", country_code: "es" };

  assert.equal(normalize({ lat: "abc", lon: "-3", address }), null);
  assert.equal(normalize({ lon: "-3", address }), null);
  assert.equal(normalize({ lat: "91", lon: "0", address }), null);
  assert.equal(normalize({ lat: "0", lon: "181", address }), null);
  assert.equal(normalize({ lat: "-90", lon: "180", address })?.city, "X");
});

test("a result without place_id still gets a usable key", () => {
  const found = normalize({
    name: "X",
    lat: "1.5",
    lon: "2.5",
    address: { city: "X", country: "España", country_code: "es" },
  });

  assert.equal(found?.key, "1.5,2.5");
});
