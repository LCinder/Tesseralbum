import {
  ensurePath,
  findChild,
  isEmpty,
  readJson,
  trash,
  writeJson,
  type TokenSource,
} from "@/lib/google/drive";
import { tripPath, type DateSpan } from "@/lib/trips";

/**
 * The catalogue: which souvenir points at which place.
 *
 * This is the one piece of shared state the app needs, and it lives as a JSON
 * file inside the app's own Drive folder. It replaces what used to be four
 * Postgres tables. Photo metadata does *not* live here — that rides along on
 * each file's `appProperties`, so uploads never contend over a shared index.
 */

export const ROOT_FOLDER = "Tesseralbum";
const CATALOG_NAME = "souvenirs.json";

export type Place = {
  id: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
};

export type Souvenir = {
  slug: string;
  placeId: string;
  active: boolean;
  createdAt: string;
};

export type Catalog = {
  version: 1;
  places: Place[];
  souvenirs: Souvenir[];
};

export const EMPTY_CATALOG: Catalog = {
  version: 1,
  places: [],
  souvenirs: [],
};

/**
 * Slug alphabet with no vowels and no ambiguous glyphs, so a code read aloud
 * or copied by hand does not get garbled.
 *
 * Under the Drive-permissions model this is an identifier, not a secret —
 * holding it grants nothing. It stays opaque for a different reason: so a
 * sticker can be reassigned to another souvenir without reprogramming the chip.
 */
const ALPHABET = "23456789bcdfghjkmnpqrstvwxyz";
const SLUG_LENGTH = 10;

export function newSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export const SLUG_PATTERN = new RegExp(`^[${ALPHABET}]{${SLUG_LENGTH}}$`);

/** A stable, readable id built from the place itself. */
export function placeId(city: string, country: string): string {
  // NFD splits "o" into a bare letter plus a combining accent. Comparing code
  // points drops the accents without putting invisible characters in the
  // source, where an editor or a pipe can silently mangle them.
  const strip = (text: string) =>
    [...text.normalize("NFD")]
      .filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x0300 || code > 0x036f;
      })
      .join("")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${strip(city)}-${strip(country)}`;
}

export type CatalogHandle = {
  rootId: string;
  /** Absent until the catalogue has been written for the first time. */
  fileId: string | null;
  catalog: Catalog;
};

/**
 * Opens the catalogue, creating the app's folder if this is a first run.
 *
 * Deliberately does not create the JSON file when it is missing: a fresh
 * account should be able to look around without the app writing to Drive
 * before being asked to.
 */
export async function openCatalog(
  getToken: TokenSource,
): Promise<CatalogHandle> {
  const rootId = await ensurePath(getToken, [ROOT_FOLDER]);
  const existing = await findChild(getToken, rootId, CATALOG_NAME, {
    folder: false,
  });

  if (!existing) {
    return { rootId, fileId: null, catalog: EMPTY_CATALOG };
  }

  const raw = await readJson<Partial<Catalog>>(getToken, existing.id);

  return {
    rootId,
    fileId: existing.id,
    catalog: {
      version: 1,
      places: Array.isArray(raw.places) ? raw.places : [],
      souvenirs: Array.isArray(raw.souvenirs) ? raw.souvenirs : [],
    },
  };
}

export async function saveCatalog(
  getToken: TokenSource,
  handle: CatalogHandle,
  catalog: Catalog,
): Promise<CatalogHandle> {
  const written = await writeJson(
    getToken,
    catalog,
    handle.fileId
      ? { fileId: handle.fileId }
      : { parentId: handle.rootId, name: CATALOG_NAME },
  );

  return { ...handle, fileId: written.id, catalog };
}

export function findSouvenir(
  catalog: Catalog,
  slug: string,
): { souvenir: Souvenir; place: Place } | null {
  if (!SLUG_PATTERN.test(slug)) return null;

  const souvenir = catalog.souvenirs.find((s) => s.slug === slug && s.active);
  if (!souvenir) return null;

  const place = catalog.places.find((p) => p.id === souvenir.placeId);
  if (!place) return null;

  return { souvenir, place };
}

export function sortedPlaces(catalog: Catalog): Place[] {
  return [...catalog.places].sort(
    (a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city),
  );
}

export function souvenirsOfPlace(catalog: Catalog, id: string): Souvenir[] {
  return catalog.souvenirs.filter((s) => s.placeId === id && s.active);
}

/**
 * Adds a place and a souvenir in one step, reusing the place when it is
 * already known — that is the normal case for a second souvenir from the
 * same city.
 */
export function withNewSouvenir(
  catalog: Catalog,
  input: {
    city: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  },
): { catalog: Catalog; souvenir: Souvenir } {
  const id = placeId(input.city, input.country);

  const places = catalog.places.some((p) => p.id === id)
    ? catalog.places
    : [
        ...catalog.places,
        {
          id,
          city: input.city,
          country: input.country,
          countryCode: input.countryCode.toUpperCase(),
          lat: input.lat,
          lng: input.lng,
        },
      ];

  const taken = new Set(catalog.souvenirs.map((s) => s.slug));
  let slug = newSlug();
  while (taken.has(slug)) slug = newSlug();

  const souvenir: Souvenir = {
    slug,
    placeId: id,
    active: true,
    createdAt: new Date().toISOString(),
  };

  return {
    catalog: { ...catalog, places, souvenirs: [...catalog.souvenirs, souvenir] },
    souvenir,
  };
}

/**
 * Removes a souvenir, and the place with it when nothing else points there.
 *
 * Also reports whether the country folder still has a reason to exist: two
 * places can share one country folder (Dublín and Cork both live under
 * Irlanda), so dropping one must not take the folder with it.
 */
export function withoutSouvenir(
  catalog: Catalog,
  slug: string,
): {
  catalog: Catalog;
  removed: Souvenir;
  place: Place;
  placeDropped: boolean;
  countryStillUsed: boolean;
} | null {
  const removed = catalog.souvenirs.find((s) => s.slug === slug);
  if (!removed) return null;

  const place = catalog.places.find((p) => p.id === removed.placeId);
  if (!place) return null;

  const souvenirs = catalog.souvenirs.filter((s) => s.slug !== slug);
  const placeDropped = !souvenirs.some((s) => s.placeId === removed.placeId);

  const places = placeDropped
    ? catalog.places.filter((p) => p.id !== removed.placeId)
    : catalog.places;

  const countryStillUsed = places.some((p) => p.country === place.country);

  return {
    catalog: { ...catalog, places, souvenirs },
    removed,
    place,
    placeDropped,
    countryStillUsed,
  };
}

/** What happened to the country folder when a souvenir was deleted. */
export type FolderOutcome =
  | { kind: "none" }
  | { kind: "trashed"; country: string }
  | { kind: "kept-not-empty"; country: string }
  | { kind: "kept-still-used"; country: string };

/**
 * Deletes a souvenir from the catalogue and tidies Drive behind it.
 *
 * The rule for the folder is deliberately cautious: it only goes to the bin
 * when no other place needs it *and* it holds nothing. A folder with photos in
 * it is left alone and the caller is told, because deleting a sticker is a
 * bookkeeping act and losing a holiday's photos to it would be a disaster
 * disguised as tidiness.
 */
export async function removeSouvenir(
  getToken: TokenSource,
  handle: CatalogHandle,
  slug: string,
): Promise<{ handle: CatalogHandle; folder: FolderOutcome }> {
  const result = withoutSouvenir(handle.catalog, slug);
  if (!result) throw new Error("Ese lugar ya no está en el catálogo.");

  const { catalog, place, countryStillUsed } = result;

  // The catalogue goes first: if the folder step fails, the sticker is still
  // gone and a retry is harmless, rather than the reverse.
  const saved = await saveCatalog(getToken, handle, catalog);

  let folder: FolderOutcome = { kind: "none" };

  if (countryStillUsed) {
    folder = { kind: "kept-still-used", country: place.country };
  } else {
    const existing = await findChild(getToken, handle.rootId, place.country, {
      folder: true,
    });

    if (existing) {
      if (await isEmpty(getToken, existing.id)) {
        await trash(getToken, existing.id);
        folder = { kind: "trashed", country: place.country };
      } else {
        folder = { kind: "kept-not-empty", country: place.country };
      }
    }
  }

  return { handle: saved, folder };
}

/**
 * Where a trip's files go: Tesseralbum/Irlanda/2025/Septiembre-Octubre.
 *
 * The span comes from the photos, never from a form — see `src/lib/trips.ts`.
 * That is what makes a second visit to the same place file itself separately
 * without anyone naming anything.
 */
export async function ensureTripFolder(
  getToken: TokenSource,
  place: Place,
  span: DateSpan,
): Promise<string> {
  return ensurePath(getToken, [ROOT_FOLDER, ...tripPath(place.country, span)]);
}
