import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_CATALOG,
  SLUG_PATTERN,
  findSouvenir,
  newSlug,
  placeId,
  souvenirsOfPlace,
  withNewSouvenir,
  withoutSouvenir,
} from "./catalog";

const KYOTO = {
  city: "Kioto",
  country: "Japón",
  countryCode: "jp",
  lat: 35.0116,
  lng: 135.7681,
};

test("place ids survive accents and spaces", () => {
  assert.equal(placeId("Kioto", "Japón"), "kioto-japon");
  assert.equal(placeId("São Paulo", "Brasil"), "sao-paulo-brasil");
  assert.equal(placeId("A Coruña", "España"), "a-coruna-espana");
});

test("generated slugs match the pattern that validates them", () => {
  for (let i = 0; i < 200; i += 1) {
    assert.ok(SLUG_PATTERN.test(newSlug()), "slug should validate");
  }
});

test("a new souvenir creates its place and normalises the country code", () => {
  const { catalog, souvenir } = withNewSouvenir(EMPTY_CATALOG, KYOTO);

  assert.equal(catalog.places.length, 1);
  assert.equal(catalog.places[0].countryCode, "JP");
  assert.equal(souvenir.placeId, "kioto-japon");
  assert.ok(souvenir.active);
});

test("a second souvenir from the same city reuses the place", () => {
  const first = withNewSouvenir(EMPTY_CATALOG, KYOTO);
  const second = withNewSouvenir(first.catalog, KYOTO);

  assert.equal(second.catalog.places.length, 1);
  assert.equal(second.catalog.souvenirs.length, 2);
  assert.notEqual(second.souvenir.slug, first.souvenir.slug);
  assert.equal(souvenirsOfPlace(second.catalog, "kioto-japon").length, 2);
});

test("lookup finds an active souvenir and refuses everything else", () => {
  const { catalog, souvenir } = withNewSouvenir(EMPTY_CATALOG, KYOTO);

  const hit = findSouvenir(catalog, souvenir.slug);
  assert.equal(hit?.place.city, "Kioto");

  assert.equal(findSouvenir(catalog, "MAYUSCULAS"), null);
  assert.equal(findSouvenir(catalog, "corto"), null);
  assert.equal(findSouvenir(catalog, ""), null);
  // Vowels are outside the alphabet, so this is well-formed junk.
  assert.equal(findSouvenir(catalog, "aeiouaeiou"), null);
});

test("a deactivated souvenir stops resolving", () => {
  const { catalog, souvenir } = withNewSouvenir(EMPTY_CATALOG, KYOTO);
  const disabled = {
    ...catalog,
    souvenirs: catalog.souvenirs.map((s) => ({ ...s, active: false })),
  };

  assert.equal(findSouvenir(disabled, souvenir.slug), null);
  assert.equal(souvenirsOfPlace(disabled, "kioto-japon").length, 0);
});

test("a souvenir whose place vanished does not resolve half-way", () => {
  const { catalog, souvenir } = withNewSouvenir(EMPTY_CATALOG, KYOTO);
  const orphaned = { ...catalog, places: [] };

  assert.equal(findSouvenir(orphaned, souvenir.slug), null);
});


test("removing the only souvenir of a place drops the place too", () => {
  const { catalog, souvenir } = withNewSouvenir(EMPTY_CATALOG, KYOTO);
  const result = withoutSouvenir(catalog, souvenir.slug);

  assert.equal(result?.catalog.souvenirs.length, 0);
  assert.equal(result?.catalog.places.length, 0, "orphan place left behind");
  assert.equal(result?.placeDropped, true);
  assert.equal(result?.countryStillUsed, false);
});

test("removing one of two souvenirs keeps the place", () => {
  const first = withNewSouvenir(EMPTY_CATALOG, KYOTO);
  const second = withNewSouvenir(first.catalog, KYOTO);

  const result = withoutSouvenir(second.catalog, second.souvenir.slug);

  assert.equal(result?.catalog.souvenirs.length, 1);
  assert.equal(result?.catalog.places.length, 1);
  assert.equal(result?.placeDropped, false);
  assert.equal(result?.countryStillUsed, true);
});

test("a country folder shared by two cities survives losing one", () => {
  // Dublín and Cork both file their photos under Irlanda, so deleting Cork
  // must not take the folder — and the photos — with it.
  const dublin = withNewSouvenir(EMPTY_CATALOG, {
    city: "Dublín",
    country: "Irlanda",
    countryCode: "ie",
    lat: 53.3498,
    lng: -6.2603,
  });
  const cork = withNewSouvenir(dublin.catalog, {
    city: "Cork",
    country: "Irlanda",
    countryCode: "ie",
    lat: 51.8985,
    lng: -8.4756,
  });

  const result = withoutSouvenir(cork.catalog, cork.souvenir.slug);

  assert.equal(result?.placeDropped, true, "Cork itself is gone");
  assert.equal(result?.countryStillUsed, true, "but Irlanda is still in use");
  assert.equal(result?.catalog.places.length, 1);
});

test("the last city of a country releases its folder", () => {
  const dublin = withNewSouvenir(EMPTY_CATALOG, {
    city: "Dublín",
    country: "Irlanda",
    countryCode: "ie",
    lat: 53.3498,
    lng: -6.2603,
  });

  const result = withoutSouvenir(dublin.catalog, dublin.souvenir.slug);

  assert.equal(result?.countryStillUsed, false);
  assert.equal(result?.place.country, "Irlanda");
});

test("deleting something that is not there changes nothing", () => {
  const { catalog } = withNewSouvenir(EMPTY_CATALOG, KYOTO);

  assert.equal(withoutSouvenir(catalog, "bcdfghjkmn"), null);
  assert.equal(withoutSouvenir(EMPTY_CATALOG, "bcdfghjkmn"), null);
});

test("a souvenir whose place already vanished is not deletable", () => {
  // Refusing beats half-deleting: the caller cannot decide about the folder
  // without knowing the country.
  const { catalog, souvenir } = withNewSouvenir(EMPTY_CATALOG, KYOTO);
  const orphaned = { ...catalog, places: [] };

  assert.equal(withoutSouvenir(orphaned, souvenir.slug), null);
});
