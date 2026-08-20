"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ConsentRequired,
  requestToken,
  revokeToken,
  type Token,
} from "@/lib/google/gis";
import {
  openCatalog,
  removePlace,
  saveCatalog,
  type Catalog,
  type CatalogHandle,
  type FolderOutcome,
} from "@/lib/catalog";
import {
  clearAll,
  loadAccount,
  loadCatalog,
  loadToken,
  saveAccount,
  saveCatalogSnapshot,
  saveToken,
} from "@/lib/session-store";
import { readAccountEmail } from "@/lib/google/drive";

/**
 * The single source of truth for "are we connected to Drive".
 *
 * There is no server session and no cookie. What persists across reloads is a
 * token in localStorage, good for the hour Google granted it, plus the last
 * catalogue seen so the page can paint before Drive answers.
 *
 * When the stored token has expired, a silent request renews it: as long as
 * the browser still has a Google session and consent was granted once, that
 * costs the user nothing and shows no dialog. Only when Google needs to ask
 * something does the connect button appear.
 */

type Status = "loading" | "disconnected" | "connected" | "error";

type Session = {
  status: Status;
  error: string | null;
  catalog: Catalog | null;
  /** True while the catalogue on screen came from storage, not from Drive. */
  stale: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Always returns a live token, renewing it when it is about to lapse. */
  getToken: () => Promise<string>;
  /** Persists a new catalogue to Drive and updates the context. */
  commit: (next: Catalog) => Promise<void>;
  /** Deletes a place, tidying its Drive folder when it is safe to. */
  remove: (id: string) => Promise<FolderOutcome>;
  reload: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return session;
}

export function SessionProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState<CatalogHandle | null>(null);
  const [stale, setStale] = useState(false);

  // The token is a ref, not state: renewing it must not re-render the tree,
  // and callers always read it through getToken().
  const token = useRef<Token | null>(null);
  // Concurrent Drive calls would each kick off their own renewal, so the
  // in-flight promise is shared.
  const renewal = useRef<Promise<string> | null>(null);

  const fetchToken = useCallback(
    async (silent: boolean) => {
      // The hint only helps a silent renewal. On an explicit connect it is left
      // out on purpose, so someone with several accounts can pick another.
      const fresh = await requestToken(clientId, {
        silent,
        hint: silent ? loadAccount() : null,
      });
      token.current = fresh;
      saveToken(fresh);
      return fresh.value;
    },
    [clientId],
  );

  const getToken = useCallback(async () => {
    const current = token.current;
    if (current && current.expiresAt > Date.now()) return current.value;

    if (!renewal.current) {
      renewal.current = fetchToken(true).finally(() => {
        renewal.current = null;
      });
    }
    return renewal.current;
  }, [fetchToken]);

  const load = useCallback(async () => {
    const opened = await openCatalog(getToken);
    setHandle(opened);
    saveCatalogSnapshot(opened);

    // Learn the account for next time. A failure here costs an account
    // chooser later, not this session.
    void readAccountEmail(getToken)
      .then((email) => email && saveAccount(email))
      .catch(() => {});
    setStale(false);
    setStatus("connected");
    setError(null);
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Whatever was stored, so the page has something to show at once.
      const storedToken = loadToken();
      const storedCatalog = loadCatalog();

      if (storedCatalog && !cancelled) {
        token.current = storedToken;
        setHandle({
          rootId: storedCatalog.rootId,
          fileId: storedCatalog.fileId,
          catalog: storedCatalog.catalog,
        });
        // A still-valid token means this really is the connected state; the
        // catalogue is merely a moment behind, which `stale` says out loud.
        if (storedToken) {
          setStatus("connected");
          setStale(true);
        }
      } else if (storedToken && !cancelled) {
        token.current = storedToken;
      }

      // 2. Then reconcile with Drive. A stored token skips Google entirely.
      try {
        if (!storedToken) await fetchToken(true);
        if (cancelled) return;
        await load();
      } catch (cause) {
        if (cancelled) return;

        if (cause instanceof ConsentRequired) {
          // The stored catalogue is no use without a token to act on it.
          setStatus("disconnected");
          setStale(false);
        } else {
          setStatus("error");
          setError(describe(cause));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchToken, load]);

  const connect = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      await fetchToken(false);
      await load();
    } catch (cause) {
      setStatus("disconnected");
      setError(cause instanceof ConsentRequired ? null : describe(cause));
    }
  }, [fetchToken, load]);

  const disconnect = useCallback(async () => {
    const current = token.current?.value;
    token.current = null;
    setHandle(null);
    setStale(false);
    setStatus("disconnected");
    clearAll();
    if (current) await revokeToken(current);
  }, []);

  const commit = useCallback(
    async (next: Catalog) => {
      if (!handle) throw new Error("Not connected to Drive yet.");
      const saved = await saveCatalog(getToken, handle, next);
      setHandle(saved);
      saveCatalogSnapshot(saved);
    },
    [getToken, handle],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!handle) throw new Error("Not connected to Drive yet.");
      const { handle: next, folder } = await removePlace(getToken, handle, id);
      setHandle(next);
      saveCatalogSnapshot(next);
      return folder;
    },
    [getToken, handle],
  );

  const reload = useCallback(async () => {
    if (status === "connected") await load();
  }, [load, status]);

  return (
    <SessionContext.Provider
      value={{
        status,
        error,
        catalog: handle?.catalog ?? null,
        stale,
        connect,
        disconnect,
        getToken,
        commit,
        remove,
        reload,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Error inesperado.";
}
