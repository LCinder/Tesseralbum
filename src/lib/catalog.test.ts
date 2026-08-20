import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_CATALOG,
  SLUG_PATTERN,
  findPlaceBySlug,
  migrate,
  newSlug,
  placeId,
  sortedPlaces,
  withPlace,
  withoutPlace,
} from "./catalog";

const KYOTO = {
  city: "Kioto",
  country: "Japón",
  countryCode: "jp",
  lat: 35.0116,
  lng: 135.7681,
};

const CORK = {
  city: "Cork",
  country: "Irlanda",
  countryCode: "ie",
  lat: 51.8985,
  lng: -8.4756,
};

const DUBLIN = {
  city: "Dublín",
  country: "Irlanda",
  countryCode: "ie",
  lat: 53.3498,
  lng: -6.2603,
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

test("a new place gets a slug and normalises its country code", () => {
  const { catalog, place, created } = withPlace(EMPTY_CATALOG, KYOTO);

  assert.ok(created);
  assert.equal(catalog.places.length, 1);
  assert.equal(place.countryCode, "JP");
  assert.equal(place.id, "kioto-japon");
  assert.ok(SLUG_PATTERN.test(place.slug));
  assert.ok(place.active);
});

test("registering a place again returns the URL it already has", () => {
  // The chip for that city is already stuck on a souvenir somewhere. A second
  // code would leave one album with two ways in and no way to tell which is
  // on which magnet.
  const first = withPlace(EMPTY_CATALOG, KYOTO);
  const second = withPlace(first.catalog, KYOTO);

  assert.equal(second.created, false);
  assert.equal(second.place.slug, first.place.slug);
  assert.equal(second.catalog.places.length, 1);
});

test("the same city entered with different spacing is still the same place", () => {
  const first = withPlace(EMPTY_CATALOG, KYOTO);
  const second = withPlace(first.catalog, { ...KYOTO, city: "kioto" });

  assert.equal(second.created, false);
  assert.equal(second.catalog.places.length, 1);
});

test("two cities in one country are two places", () => {
  const first = withPlace(EMPTY_CATALOG, DUBLIN);
  const second = withPlace(first.catalog, CORK);

  assert.ok(second.created);
  assert.equal(second.catalog.places.length, 2);
  assert.notEqual(second.place.slug, first.place.slug);
});

test("lookup finds an active place and refuses everything else", () => {
  const { catalog, place } = withPlace(EMPTY_CATALOG, KYOTO);

  assert.equal(findPlaceBySlug(catalog, place.slug)?.city, "Kioto");

  assert.equal(findPlaceBySlug(catalog, "MAYUSCULAS"), null);
  assert.equal(findPlaceBySlug(catalog, "corto"), null);
  assert.equal(findPlaceBySlug(catalog, ""), null);
  // Vowels are outside the alphabet, so this is well-formed junk.
  assert.equal(findPlaceBySlug(catalog, "aeiouaeiou"), null);
});

test("a deactivated place stops resolving and stops being listed", () => {
  const { catalog, place } = withPlace(EMPTY_CATALOG, KYOTO);
  const disabled = {
    ...catalog,
    places: catalog.places.map((p) => ({ ...p, active: false })),
  };

  assert.equal(findPlaceBySlug(disabled, place.slug), null);
  assert.equal(sortedPlaces(disabled).length, 0);
});

test("re-adding a deactivated place revives its original code", () => {
  // Whatever is on the physical chip has to keep working.
  const { catalog, place } = withPlace(EMPTY_CATALOG, KYOTO);
  const disabled = {
    ...catalog,
    places: catalog.places.map((p) => ({ ...p, active: false })),
  };

  const again = withPlace(disabled, KYOTO);

  assert.equal(again.created, false);
  assert.equal(again.place.slug, place.slug);
  assert.ok(again.place.active);
  assert.equal(again.catalog.places.length, 1);
});

test("deleting the last place of a country releases its folder", () => {
  const { catalog, place } = withPlace(EMPTY_CATALOG, KYOTO);
  const result = withoutPlace(catalog, place.id);

  assert.equal(result?.catalog.places.length, 0);
  assert.equal(result?.countryStillUsed, false);
});

test("a country folder shared by two cities survives losing one", () => {
  // Dublín and Cork both file their photos under Irlanda, so deleting Cork
  // must not take the folder — and the photos — with it.
  const dublin = withPlace(EMPTY_CATALOG, DUBLIN);
  const cork = withPlace(dublin.catalog, CORK);

  const result = withoutPlace(cork.catalog, cork.place.id);

  assert.equal(result?.countryStillUsed, true, "Irlanda is still in use");
  assert.equal(result?.catalog.places.length, 1);
  assert.equal(result?.removed.city, "Cork");
});

test("deleting something that is not there changes nothing", () => {
  const { catalog } = withPlace(EMPTY_CATALOG, KYOTO);

  assert.equal(withoutPlace(catalog, "no-existe"), null);
  assert.equal(withoutPlace(EMPTY_CATALOG, "no-existe"), null);
});

test("places are listed by country, then city", () => {
  const a = withPlace(EMPTY_CATALOG, KYOTO);
  const b = withPlace(a.catalog, DUBLIN);
  const c = withPlace(b.catalog, CORK);

  assert.deepEqual(
    sortedPlaces(c.catalog).map((place) => place.city),
    ["Cork", "Dublín", "Kioto"],
  );
});

// --- Reading what the previous shape wrote --------------------------------

test("an old catalogue folds its chips into their places", () => {
  const catalog = migrate({
    places: [
      {
        id: "kioto-japon",
        city: "Kioto",
        country: "Japón",
        countryCode: "JP",
        lat: 35.0116,
        lng: 135.7681,
      },
    ],
    souvenirs: [
      {
        slug: "k7f3xqm2bd",
        placeId: "kioto-japon",
        active: true,
        createdAt: "2026-08-20T10:00:00.000Z",
      },
    ],
  });

  assert.equal(catalog.version, 2);
  assert.equal(catalog.places.length, 1);
  assert.equal(catalog.places[0].slug, "k7f3xqm2bd");
});

test("when several old chips shared a place, the oldest keeps working", () => {
  // That is the one most likely to be stuck on a souvenir already.
  const catalog = migrate({
    places: [
      {
        id: "kioto-japon",
        city: "Kioto",
        country: "Japón",
        countryCode: "JP",
        lat: 35.0116,
        lng: 135.7681,
      },
    ],
    souvenirs: [
      {
        slug: "segundochip",
        placeId: "kioto-japon",
        active: true,
        createdAt: "2026-08-20T12:00:00.000Z",
      },
      {
        slug: "primerochip",
        placeId: "kioto-japon",
        active: true,
        createdAt: "2026-08-20T09:00:00.000Z",
      },
    ],
  });

  assert.equal(catalog.places.length, 1);
  assert.equal(catalog.places[0].slug, "primerochip");
});

test("an old place whose chips were all deactivated is dropped", () => {
  // Minting it a fresh slug would silently invalidate the physical chip.
  const catalog = migrate({
    places: [
      { id: "kioto-japon", city: "Kioto", country: "Japón", countryCode: "JP" },
    ],
    souvenirs: [
      {
        slug: "k7f3xqm2bd",
        placeId: "kioto-japon",
        active: false,
        createdAt: "2026-08-20T10:00:00.000Z",
      },
    ],
  });

  assert.equal(catalog.places.length, 0);
});

test("a current catalogue passes through untouched", () => {
  const { catalog } = withPlace(EMPTY_CATALOG, KYOTO);
  const again = migrate(catalog);

  assert.deepEqual(again.places, catalog.places);
});

test("an empty or unrecognisable catalogue reads as empty", () => {
  assert.deepEqual(migrate({}).places, []);
  assert.deepEqual(migrate({ places: [], souvenirs: [] }).places, []);
  // Entries missing what a place needs cannot be guessed at.
  assert.deepEqual(migrate({ places: [{ id: "solo-id" }] }).places, []);
});
