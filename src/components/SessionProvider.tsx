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
  removeSouvenir,
  saveCatalog,
  type Catalog,
  type CatalogHandle,
  type FolderOutcome,
} from "@/lib/catalog";

/**
 * The single source of truth for "are we connected to Drive".
 *
 * There is no server session and no cookie. On mount it tries a silent token
 * request: if the browser still has a Google session and consent was granted
 * before, the user is straight in with no popup and no click. Otherwise the UI
 * shows a connect button.
 */

type Status = "loading" | "disconnected" | "connected" | "error";

type Session = {
  status: Status;
  error: string | null;
  catalog: Catalog | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Always returns a live token, renewing it when it is about to lapse. */
  getToken: () => Promise<string>;
  /** Persists a new catalogue to Drive and updates the context. */
  commit: (next: Catalog) => Promise<void>;
  /** Deletes a sticker, tidying its Drive folder when it is safe to. */
  remove: (slug: string) => Promise<FolderOutcome>;
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

  // The token is a ref, not state: renewing it must not re-render the tree,
  // and callers always read it through getToken().
  const token = useRef<Token | null>(null);
  // Concurrent Drive calls would each kick off their own renewal, so the
  // in-flight promise is shared.
  const renewal = useRef<Promise<string> | null>(null);

  const fetchToken = useCallback(
    async (silent: boolean) => {
      const fresh = await requestToken(clientId, { silent });
      token.current = fresh;
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
    setStatus("connected");
    setError(null);
  }, [getToken]);

  // Silent reconnect on mount. Failing here is the normal path for a first
  // visit, not an error worth showing.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fetchToken(true);
        if (cancelled) return;
        await load();
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ConsentRequired) {
          setStatus("disconnected");
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
    setStatus("disconnected");
    if (current) await revokeToken(current);
  }, []);

  const commit = useCallback(
    async (next: Catalog) => {
      if (!handle) throw new Error("Not connected to Drive yet.");
      setHandle(await saveCatalog(getToken, handle, next));
    },
    [getToken, handle],
  );

  const remove = useCallback(
    async (slug: string) => {
      if (!handle) throw new Error("Not connected to Drive yet.");
      const { handle: next, folder } = await removeSouvenir(
        getToken,
        handle,
        slug,
      );
      setHandle(next);
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
