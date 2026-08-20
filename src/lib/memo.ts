/**
 * A short-lived cache for Drive listings, in memory.
 *
 * Navigating album → map → album re-listed the same files every time, at 100
 * quota units a listing. Within one sitting that is pure waste: the archive
 * does not change while you are reading it.
 *
 * In memory rather than IndexedDB on purpose. It should make *navigation*
 * free, not survive a reload — a reload is exactly when someone expects to see
 * what another device uploaded, and a listing kept across sessions would show
 * them yesterday's album instead.
 */

/** Long enough to cover a browsing session, short enough to stay honest. */
const TTL_MS = 5 * 60 * 1000;

type Entry = { value: unknown; storedAt: number; inFlight?: Promise<unknown> };

const entries = new Map<string, Entry>();

/**
 * Runs `load` unless its answer is already known, or already on its way.
 *
 * Sharing the in-flight promise matters as much as the cache itself: a page
 * whose components each ask for the same listing on mount would otherwise
 * fire the same query three times before any of them returned.
 */
export async function memo<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = entries.get(key);

  if (existing) {
    if (existing.inFlight) return existing.inFlight as Promise<T>;
    if (Date.now() - existing.storedAt < TTL_MS) return existing.value as T;
  }

  const inFlight = load()
    .then((value) => {
      entries.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .catch((cause) => {
      // A failure must not be remembered, or one flaky moment suppresses the
      // real answer for five minutes.
      entries.delete(key);
      throw cause;
    });

  entries.set(key, { value: undefined, storedAt: 0, inFlight });

  return inFlight;
}

/**
 * Forgets what is no longer true.
 *
 * Called after an upload or a delete: the alternative is showing a stale album
 * for five minutes right after the user changed it, which is the one moment
 * they are certain to notice.
 */
export function forget(prefix?: string): void {
  if (!prefix) {
    entries.clear();
    return;
  }

  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
