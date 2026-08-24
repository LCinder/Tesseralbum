import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

/**
 * A minimal localStorage. Node has no DOM, and the point of these tests is the
 * validation around storage rather than the browser's implementation of it.
 *
 * A static import is safe even though this runs after it: session-store only
 * touches localStorage inside its functions, never at module load.
 */
const store = new Map<string, string>();

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

import {
  clearAll,
  loadAccount,
  loadCatalog,
  loadToken,
  saveAccount,
  saveCatalogSnapshot,
  saveToken,
  loadAnniversary,
  saveAnniversary,
} from "./session-store";

const CATALOG = {
  version: 2 as const,
  places: [
    {
      id: "kioto-japon",
      slug: "k7f3xqm2bd",
      city: "Kioto",
      country: "Japón",
      countryCode: "JP",
      lat: 35.0116,
      lng: 135.7681,
      active: true,
      createdAt: "2026-08-20T10:00:00.000Z",
    },
  ],
};

const HOUR = 60 * 60 * 1000;

beforeEach(() => store.clear());

test("a token survives a round trip", () => {
  const token = { value: "ya29.abc", expiresAt: Date.now() + HOUR };
  saveToken(token);

  assert.deepEqual(loadToken(), token);
});

test("an expired token is refused, and forgotten", () => {
  saveToken({ value: "ya29.old", expiresAt: Date.now() - 1 });

  assert.equal(loadToken(), null);
  // Left in place it would be retried on every reload for nothing.
  assert.equal(store.has("tesseralbum.token"), false);
});

test("a malformed token is refused rather than handed to Drive", () => {
  for (const junk of [
    "not json at all",
    JSON.stringify({ value: "ya29.abc" }),
    JSON.stringify({ expiresAt: Date.now() + HOUR }),
    JSON.stringify({ value: 42, expiresAt: Date.now() + HOUR }),
    JSON.stringify({ value: "ya29.abc", expiresAt: "mañana" }),
    JSON.stringify(null),
  ]) {
    store.set("tesseralbum.token", junk);
    assert.equal(loadToken(), null, junk);
  }
});

test("nothing stored means nothing loaded", () => {
  assert.equal(loadToken(), null);
  assert.equal(loadCatalog(), null);
  assert.equal(loadAccount(), null);
});

test("a catalogue snapshot survives a round trip", () => {
  saveCatalogSnapshot({
    rootId: "root123",
    fileId: "file456",
    catalog: CATALOG,
  });

  const loaded = loadCatalog();
  assert.equal(loaded?.rootId, "root123");
  assert.equal(loaded?.fileId, "file456");
  assert.deepEqual(loaded?.catalog.places, CATALOG.places);
});

test("a catalogue older than a month is dropped", () => {
  const thirtyOneDays = 31 * 24 * HOUR;

  store.set(
    "tesseralbum.catalog",
    JSON.stringify({
      rootId: "root123",
      fileId: null,
      catalog: CATALOG,
      storedAt: Date.now() - thirtyOneDays,
    }),
  );

  assert.equal(loadCatalog(), null);
});

test("a catalogue just inside a month is kept", () => {
  const twentyNineDays = 29 * 24 * HOUR;

  store.set(
    "tesseralbum.catalog",
    JSON.stringify({
      rootId: "root123",
      fileId: null,
      catalog: CATALOG,
      storedAt: Date.now() - twentyNineDays,
    }),
  );

  assert.notEqual(loadCatalog(), null);
});

test("a catalogue with the wrong shape is refused", () => {
  // Rendering half a catalogue would crash the page it was meant to speed up.
  for (const junk of [
    "{{{",
    JSON.stringify({
      rootId: "r",
      catalog: { places: "no" },
      storedAt: Date.now(),
    }),
    JSON.stringify({ rootId: "r", storedAt: Date.now() }),
    JSON.stringify({ catalog: CATALOG, storedAt: Date.now() }),
    JSON.stringify({ rootId: "r", catalog: CATALOG }),
  ]) {
    store.set("tesseralbum.catalog", junk);
    assert.equal(loadCatalog(), null, junk);
  }
});

test("the account hint round-trips", () => {
  saveAccount("alguien@gmail.com");
  assert.equal(loadAccount(), "alguien@gmail.com");
});

test("signing out leaves nothing behind", () => {
  saveToken({ value: "ya29.abc", expiresAt: Date.now() + HOUR });
  saveCatalogSnapshot({ rootId: "r", fileId: null, catalog: CATALOG });
  saveAccount("alguien@gmail.com");

  clearAll();

  assert.equal(store.size, 0);
  assert.equal(loadToken(), null);
  assert.equal(loadCatalog(), null);
  assert.equal(loadAccount(), null);
});

test("storage that throws is treated as no storage", () => {
  const working = globalThis.localStorage;

  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };

  // Private browsing must mean "start fresh", never "cannot start".
  assert.doesNotThrow(() => saveToken({ value: "x", expiresAt: Date.now() }));
  assert.equal(loadToken(), null);
  assert.doesNotThrow(() => clearAll());

  (globalThis as { localStorage: unknown }).localStorage = working;
});

test("today's answer is remembered, including a remembered no", () => {
  saveAnniversary("2026-8-20", { placeId: "kioto-japon" });
  assert.deepEqual(loadAnniversary("2026-8-20"), {
    value: { placeId: "kioto-japon" },
  });

  // A "no" has to be stored too, or the archive gets swept again on every
  // visit for the days when there is nothing to find — which is most of them.
  saveAnniversary("2026-8-21", null);
  assert.deepEqual(loadAnniversary("2026-8-21"), { value: null });
});

test("yesterday's answer is not today's", () => {
  saveAnniversary("2026-8-19", { placeId: "kioto-japon" });

  assert.equal(loadAnniversary("2026-8-20"), null);
});

test("signing out forgets the day's memory too", () => {
  saveAnniversary("2026-8-20", { placeId: "kioto-japon" });
  clearAll();

  assert.equal(loadAnniversary("2026-8-20"), null);
});
