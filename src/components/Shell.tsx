"use client";

import Link from "next/link";
import { useSession } from "@/components/SessionProvider";

/** Shared header and page width. */
export function Shell({ children }: { children: React.ReactNode }) {
  const { status, disconnect } = useSession();

  return (
    <>
      <header className="border-b border-rule">
        <div className="mx-auto flex w-full max-w-3xl items-baseline justify-between gap-4 px-6 py-5">
          <Link href="/" className="t-display text-lg font-bold tracking-tight">
            Tesseralbum
          </Link>

          <nav className="flex items-baseline gap-4">
            {status === "connected" && (
              <>
                <Link
                  href="/passport"
                  className="t-label text-ink-soft hover:text-accent hover:underline"
                >
                  Pasaporte
                </Link>
                <Link
                  href="/map"
                  className="t-label text-ink-soft hover:text-accent hover:underline"
                >
                  Mapa
                </Link>
                <Link
                  href="/admin"
                  className="t-label text-ink-soft hover:text-accent hover:underline"
                >
                  Pegatinas
                </Link>
                <button
                  type="button"
                  onClick={disconnect}
                  className="t-label cursor-pointer text-accent hover:underline"
                >
                  Desconectar
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl grow px-6 py-10">{children}</main>

      <footer className="mx-auto w-full max-w-3xl px-6 pb-10">
        <p className="t-label border-t border-rule pt-4 text-ink-soft">
          Fase 1 · escaneo y lugares
        </p>
      </footer>
    </>
  );
}

/** Section label with the hairline rule beside it. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="t-label mb-3 flex items-center gap-3 text-ink-soft">
      <span>{children}</span>
      <span className="h-px grow bg-rule" aria-hidden="true" />
    </p>
  );
}

/** The two states every page shares before it has data. */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const { status, error, connect } = useSession();

  if (status === "loading") {
    return (
      <p className="t-label text-ink-soft" role="status">
        Conectando con Drive…
      </p>
    );
  }

  if (status === "disconnected" || status === "error") {
    return (
      <>
        <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
          Conecta tu Drive
        </h1>
        <p className="mb-8 max-w-lg text-lg text-ink-soft">
          Las fotos viven en tu Google Drive y no salen de ahí. La app solo ve
          la carpeta que ella misma crea — el resto de tu Drive le es invisible.
        </p>

        {error && (
          <p
            role="alert"
            className="mb-6 max-w-lg border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={connect}
          className="t-display cursor-pointer rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          Conectar con Google
        </button>
      </>
    );
  }

  return <>{children}</>;
}
