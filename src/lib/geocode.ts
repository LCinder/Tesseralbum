/**
 * Place search against Nominatim (OpenStreetMap).
 *
 * Free, no key, and CORS-enabled, which is what a browser-only app needs.
 * The price is a usage policy: at most one request per second, no bulk work,
 * and attribution. The caller debounces to respect the rate limit — see
 * `SEARCH_DEBOUNCE_MS`.
 *
 * A browser cannot set User-Agent, so Nominatim identifies us by Referer,
 * which it sends automatically. That is the documented arrangement for
 * browser apps.
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

/** Comfortably above Nominatim's one-per-second ceiling. */
export const SEARCH_DEBOUNCE_MS = 700;

export const ATTRIBUTION = "Búsqueda por OpenStreetMap / Nominatim";

export type Found = {
  /** Stable key for React lists; Nominatim ids are not always present. */
  key: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  /** The full "Kioto, Prefectura de Kioto, Japón" line, to tell twins apart. */
  label: string;
};

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  county?: string;
  state?: string;
  province?: string;
  country?: string;
  country_code?: string;
};

type NominatimResult = {
  place_id?: number;
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  addresstype?: string;
  address?: NominatimAddress;
};

/**
 * Turns one Nominatim hit into our shape, or `null` when it is unusable.
 *
 * Exported for its tests: the field cascade is the fiddly part. Nominatim
 * names the settlement differently depending on how big it is — `city` for
 * Kyoto, `village` for a hamlet — and a landmark like Machu Picchu has none
 * of them, only a top-level `name`.
 */
export function normalize(raw: NominatimResult): Found | null {
  const address = raw.address ?? {};

  const city =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.hamlet ??
    raw.name;

  const country = address.country;
  const countryCode = address.country_code;

  const lat = Number(raw.lat);
  const lng = Number(raw.lon);

  // Without any of these the entry cannot become a place, and guessing would
  // put a wrong pin on the map later.
  if (!city || !country || !countryCode) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    key: String(raw.place_id ?? `${lat},${lng}`),
    city,
    country,
    countryCode: countryCode.toUpperCase(),
    lat,
    lng,
    label: raw.display_name ?? `${city}, ${country}`,
  };
}

/** Drops repeats that differ only in Nominatim bookkeeping. */
function dedupe(found: Found[]): Found[] {
  const seen = new Set<string>();
  return found.filter((place) => {
    const id = `${place.city}|${place.country}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export class GeocodeError extends Error {}

/**
 * Searches for a place. Pass an `AbortSignal` so a stale request cannot
 * deliver its answer after a newer one — otherwise fast typing shows results
 * for a query the user already replaced.
 */
export async function search(
  query: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Found[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  // Spanish names, to match what the app shows the reader.
  url.searchParams.set("accept-language", "es");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new GeocodeError(
      `La búsqueda de lugares respondió ${response.status}.`,
    );
  }

  const body = (await response.json()) as NominatimResult[];
  if (!Array.isArray(body)) return [];

  return dedupe(
    body
      .map(normalize)
      .filter((place): place is Found => place !== null),
  );
}
