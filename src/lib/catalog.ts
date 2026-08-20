import {
  ensurePath,
  findChild,
  isEmpty,
  readJson,
  trash,
  writeJson,
  type TokenSource,
} from "@/lib/google/drive";
import { forget } from "@/lib/memo";

/**
 * The catalogue: the places you have chips for.
 *
 * It lives as a JSON file inside the app's own Drive folder. Photo metadata
 * does *not* live here — that rides along on each file's `appProperties`, so
 * uploads never contend over a shared index.
 *
 * One place, one chip, one URL. An earlier design let several chips point at
 * the same place, which meant a `souvenirs` array beside `places` and a join
 * on every lookup for a distinction nobody wanted: going back to a city is
 * told apart by the dates of its photos, not by carrying a second magnet.
 */

export const ROOT_FOLDER = "Tesseralbum";

/**
 * Where our own thumbnails live, beside the country folders.
 *
 * Named here rather than in the uploader because readers need it too: a
 * thumbnail is an image/jpeg like any other, so anything sweeping the archive
 * has to know to leave this folder out of the count.
 */
export const THUMBS_FOLDER = ".thumbs";
const CATALOG_NAME = "souvenirs.json";

export type Place = {
  id: string;
  /** The code in the chip's URL. */
  slug: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  active: boolean;
  createdAt: string;
};

export type Catalog = {
  version: 2;
  places: Place[];
};

export const EMPTY_CATALOG: Catalog = { version: 2, places: [] };

/**
 * Slug alphabet with no vowels and no ambiguous glyphs, so a code read aloud
 * or copied by hand does not get garbled.
 *
 * Under the Drive-permissions model this is an identifier, not a secret —
 * holding it grants nothing. It stays opaque for a different reason: so a chip
 * can be reassigned to another place without reprogramming it.
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

/** The shape written by the version that kept chips in their own array. */
type LegacyCatalog = {
  places?: (Partial<Place> & { id?: string })[];
  souvenirs?: {
    slug?: string;
    placeId?: string;
    active?: boolean;
    createdAt?: string;
  }[];
};

/**
 * Reads either shape, always returning the current one.
 *
 * When several old chips pointed at one place, the **oldest** wins: that is
 * the chip most likely to be stuck on a souvenir already, and its URL must
 * keep resolving. The others stop working, which is the unavoidable cost of
 * collapsing the model — and better than picking arbitrarily.
 */
export function migrate(raw: LegacyCatalog): Catalog {
  const rawPlaces = Array.isArray(raw.places) ? raw.places : [];

  // Already the current shape: every place carries its own slug.
  if (rawPlaces.length > 0 && rawPlaces.every((place) => place.slug)) {
    return { version: 2, places: rawPlaces.filter(isPlace) };
  }

  const oldest = new Map<string, { slug: string; createdAt: string }>();

  for (const souvenir of Array.isArray(raw.souvenirs) ? raw.souvenirs : []) {
    if (!souvenir.slug || !souvenir.placeId || souvenir.active === false) {
      continue;
    }

    const createdAt = souvenir.createdAt ?? "";
    const current = oldest.get(souvenir.placeId);
    if (!current || createdAt < current.createdAt) {
      oldest.set(souvenir.placeId, { slug: souvenir.slug, createdAt });
    }
  }

  const places: Place[] = [];

  for (const place of rawPlaces) {
    if (!place.id || !place.city || !place.country) continue;

    const chip = oldest.get(place.id);
    // A place whose chips were all deactivated has no way in; giving it a
    // fresh slug would silently invalidate whatever is on the physical chip.
    if (!chip && !place.slug) continue;

    places.push({
      id: place.id,
      slug: place.slug ?? chip!.slug,
      city: place.city,
      country: place.country,
      countryCode: (place.countryCode ?? "").toUpperCase(),
      lat: Number(place.lat) || 0,
      lng: Number(place.lng) || 0,
      active: place.active ?? true,
      createdAt: place.createdAt ?? chip?.createdAt ?? new Date().toISOString(),
    });
  }

  return { version: 2, places };
}

function isPlace(value: Partial<Place>): value is Place {
  return Boolean(value.id && value.slug && value.city && value.country);
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

  const raw = await readJson<LegacyCatalog>(getToken, existing.id);

  return { rootId, fileId: existing.id, catalog: migrate(raw) };
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

export function findPlaceBySlug(catalog: Catalog, slug: string): Place | null {
  if (!SLUG_PATTERN.test(slug)) return null;
  return (
    catalog.places.find((place) => place.slug === slug && place.active) ?? null
  );
}

export function sortedPlaces(catalog: Catalog): Place[] {
  return [...catalog.places]
    .filter((place) => place.active)
    .sort(
      (a, b) =>
        a.country.localeCompare(b.country) || a.city.localeCompare(b.city),
    );
}

/**
 * Registers a place, or hands back the one already registered.
 *
 * Reusing the existing entry is the point: a city you have been to before
 * already has a chip out in the world, and minting a second URL for it would
 * leave you with two codes for one album and no way to know which is on which
 * magnet. Returning again is recorded by the photos' dates, not by a new chip.
 */
export function withPlace(
  catalog: Catalog,
  input: {
    city: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  },
): { catalog: Catalog; place: Place; created: boolean } {
  const id = placeId(input.city, input.country);
  const existing = catalog.places.find((place) => place.id === id);

  if (existing) {
    // Reactivating rather than duplicating, so a place deleted and added again
    // keeps the code that is already stuck on the souvenir.
    if (existing.active) return { catalog, place: existing, created: false };

    const revived = { ...existing, active: true };
    return {
      catalog: {
        ...catalog,
        places: catalog.places.map((place) =>
          place.id === id ? revived : place,
        ),
      },
      place: revived,
      created: false,
    };
  }

  const taken = new Set(catalog.places.map((place) => place.slug));
  let slug = newSlug();
  while (taken.has(slug)) slug = newSlug();

  const place: Place = {
    id,
    slug,
    city: input.city,
    country: input.country,
    countryCode: input.countryCode.toUpperCase(),
    lat: input.lat,
    lng: input.lng,
    active: true,
    createdAt: new Date().toISOString(),
  };

  return {
    catalog: { ...catalog, places: [...catalog.places, place] },
    place,
    created: true,
  };
}

/**
 * Removes a place, and reports whether its country folder still has a reason
 * to exist: two places can share one (Dublín and Cork both live under
 * Irlanda), so dropping one must not take the folder with it.
 */
export function withoutPlace(
  catalog: Catalog,
  id: string,
): {
  catalog: Catalog;
  removed: Place;
  countryStillUsed: boolean;
} | null {
  const removed = catalog.places.find((place) => place.id === id);
  if (!removed) return null;

  const places = catalog.places.filter((place) => place.id !== id);

  return {
    catalog: { ...catalog, places },
    removed,
    countryStillUsed: places.some(
      (place) => place.country === removed.country && place.active,
    ),
  };
}

/** What happened to the country folder when a place was deleted. */
export type FolderOutcome =
  | { kind: "none" }
  | { kind: "trashed"; country: string }
  | { kind: "kept-not-empty"; country: string }
  | { kind: "kept-still-used"; country: string };

/**
 * Deletes a place from the catalogue and tidies Drive behind it.
 *
 * The rule for the folder is deliberately cautious: it only goes to the bin
 * when no other place needs it *and* it holds nothing. A folder with photos in
 * it is left alone and the caller is told, because deleting an entry is a
 * bookkeeping act and losing a holiday's photos to it would be a disaster
 * disguised as tidiness.
 */
export async function removePlace(
  getToken: TokenSource,
  handle: CatalogHandle,
  id: string,
): Promise<{ handle: CatalogHandle; folder: FolderOutcome }> {
  const result = withoutPlace(handle.catalog, id);
  if (!result) throw new Error("Ese lugar ya no está en el catálogo.");

  const { catalog, removed, countryStillUsed } = result;

  // A deleted place changes what the folder and archive listings should say.
  forget(`place:${id}`);
  forget(`preview:${id}`);
  forget("folders");
  forget("everything");

  // The catalogue goes first: if the folder step fails, the place is still
  // gone and a retry is harmless, rather than the reverse.
  const saved = await saveCatalog(getToken, handle, catalog);

  let folder: FolderOutcome = { kind: "none" };

  if (countryStillUsed) {
    folder = { kind: "kept-still-used", country: removed.country };
  } else {
    const existing = await findChild(getToken, handle.rootId, removed.country, {
      folder: true,
    });

    if (existing) {
      if (await isEmpty(getToken, existing.id)) {
        await trash(getToken, existing.id);
        folder = { kind: "trashed", country: removed.country };
      } else {
        folder = { kind: "kept-not-empty", country: removed.country };
      }
    }
  }

  return { handle: saved, folder };
}
