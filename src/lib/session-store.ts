import type { Catalog } from "@/lib/catalog";
import type { Token } from "@/lib/google/gis";

/**
 * What survives a reload.
 *
 * Without this every refresh starts from nothing: no token, no catalogue, and
 * a round trip to Google before the page can show anything. With it, a reload
 * inside the token's hour is instant and involves Google not at all.
 *
 * On storing an access token in localStorage: it is scoped to `drive.file`,
 * lives one hour, and never leaves the user's own browser. The exposure is
 * XSS, which would equally be able to mint a fresh token by calling the same
 * GIS client the page already holds — so persisting it does not widen the
 * blast radius, it only removes a round trip.
 *
 * Every function fails soft: a browser in private mode, a full disk or a
 * user who cleared site data must mean "start fresh", never "cannot start".
 */

const TOKEN_KEY = "tesseralbum.token";
const ACCOUNT_KEY = "tesseralbum.account";
const CATALOG_KEY = "tesseralbum.catalog";

/**
 * How long a restored catalogue may be shown before it is refreshed.
 *
 * It is only ever a first paint: the real one is fetched right after, so this
 * is about how stale a glimpse may be, not how stale the data gets.
 */
const CATALOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. Losing the cache is not an error.
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do, and nothing worth telling the user.
  }
}

/** A stored token that is still good, or `null`. */
export function loadToken(): Token | null {
  const stored = read<Token>(TOKEN_KEY);
  if (!stored) return null;

  if (
    typeof stored.value !== "string" ||
    typeof stored.expiresAt !== "number" ||
    stored.expiresAt <= Date.now()
  ) {
    drop(TOKEN_KEY);
    return null;
  }

  return stored;
}

export function saveToken(token: Token): void {
  write(TOKEN_KEY, token);
}

export function clearToken(): void {
  drop(TOKEN_KEY);
}

type StoredCatalog = {
  rootId: string;
  fileId: string | null;
  catalog: Catalog;
  storedAt: number;
};

/**
 * The last catalogue seen, for painting the page before Drive answers.
 *
 * Returned even when the token has expired: the places and stickers are the
 * user's own data, and showing them while reconnecting beats an empty screen.
 */
export function loadCatalog(): StoredCatalog | null {
  const stored = read<StoredCatalog>(CATALOG_KEY);
  if (!stored) return null;

  const usable =
    stored.catalog &&
    Array.isArray(stored.catalog.places) &&
    Array.isArray(stored.catalog.souvenirs) &&
    typeof stored.rootId === "string" &&
    typeof stored.storedAt === "number" &&
    Date.now() - stored.storedAt < CATALOG_MAX_AGE_MS;

  if (!usable) {
    drop(CATALOG_KEY);
    return null;
  }

  return stored;
}

export function saveCatalogSnapshot(snapshot: {
  rootId: string;
  fileId: string | null;
  catalog: Catalog;
}): void {
  write(CATALOG_KEY, { ...snapshot, storedAt: Date.now() });
}

/**
 * The account last connected, used as a hint so Google can renew without
 * showing an account chooser. Only an email address, and only the user's own.
 */
export function loadAccount(): string | null {
  return read<string>(ACCOUNT_KEY);
}

export function saveAccount(email: string): void {
  write(ACCOUNT_KEY, email);
}

/** Signing out must leave nothing behind. */
export function clearAll(): void {
  drop(TOKEN_KEY);
  drop(CATALOG_KEY);
  drop(ACCOUNT_KEY);
}
