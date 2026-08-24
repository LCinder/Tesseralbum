"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { DateRepair } from "@/components/DateRepair";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { StoragePanel } from "@/components/StoragePanel";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { sortedPlaces, type FolderOutcome, type Place } from "@/lib/catalog";
import { ChipWriter } from "@/components/ChipWriter";
import { isConfigured, placeUrl } from "@/lib/env";

/**
 * Managing stickers that already exist: their URLs, and deleting them.
 *
 * Creating one lives on the home page instead — it is the first thing a fresh
 * account needs, and it does not belong behind a management screen.
 */
export default function AdminPage() {
  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Registry />
      </SessionGate>
    </Shell>
  );
}

function Registry() {
  const { catalog } = useSession();
  const [note, setNote] = useState<string | null>(null);

  if (!catalog) return null;

  const places = sortedPlaces(catalog);

  if (places.length === 0) {
    return (
      <>
        <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
          Lugares
        </h1>
        <p className="mb-6 max-w-lg text-lg text-ink-soft">
          Todavía no hay ninguna.
        </p>
        <p>
          <Link href="/" className="text-accent underline">
            Crear la primera
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
        Lugares
      </h1>
      <p className="mb-10 max-w-lg text-lg text-ink-soft">
        La URL de cada una es lo que va grabado en su chip. Para crear una
        nueva, ve a{" "}
        <Link href="/" className="text-accent underline">
          tus lugares
        </Link>
        .
      </p>

      {note && (
        <p
          role="status"
          className="mb-8 border-l-[3px] border-teal bg-teal-bg px-4 py-3 text-[0.95rem]"
        >
          {note}
        </p>
      )}

      <SectionLabel>{places.length} en el catálogo</SectionLabel>

      <ul className="border-t border-rule">
        {places.map((place) => (
          <Row key={place.id} place={place} onDeleted={setNote} />
        ))}
      </ul>

      <div className="mt-12">
        <DateRepair />
      </div>

      <div className="mt-12">
        <StoragePanel />
      </div>
    </>
  );
}

function Row({
  place,
  onDeleted,
}: {
  place: Place;
  onDeleted: (note: string) => void;
}) {
  const { remove } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = placeUrl(place.slug, origin);

  async function doDelete() {
    setBusy(true);
    setProblem(null);
    try {
      onDeleted(describeOutcome(await remove(place.id)));
    } catch (cause) {
      setBusy(false);
      setConfirming(false);
      setProblem(
        cause instanceof Error ? cause.message : "No se pudo borrar en Drive.",
      );
    }
  }

  return (
    <li className="border-b border-rule py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <p className="t-display font-semibold">
            {place.city}
            <span className="ml-2 font-normal text-ink-soft">
              {place.country}
            </span>
          </p>
          <p className="mt-0.5 font-mono text-xs text-ink-soft">
            /t/{place.slug} ·{" "}
            {new Date(place.createdAt).toLocaleDateString("es")}
          </p>
        </div>

        <div className="flex items-baseline gap-4">
          <Link
            href={`/t/${place.slug}`}
            className="t-label shrink-0 text-accent hover:underline"
          >
            Ver álbum
          </Link>
          <CopyButton value={url} />
          <ChipWriter slug={place.slug} />
          {!confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="t-label shrink-0 cursor-pointer text-ink-soft hover:text-accent hover:underline"
            >
              Borrar
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mt-3 border-l-[3px] border-accent bg-accent-bg px-4 py-3">
          <p className="mb-3 text-[0.95rem]">
            Se borra el lugar del catálogo. Si <strong>{place.country}</strong>{" "}
            se queda sin ninguno y su carpeta está vacía, la carpeta va a la
            papelera de Drive. <strong>Si tiene fotos, no se toca.</strong>
          </p>
          <p className="mb-3 text-[0.9rem] text-ink-soft">
            El chip que lleve esta URL dejará de resolver. Puedes reaprovecharlo
            dando de alta otro lugar y regrabándolo.
          </p>
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={doDelete}
              disabled={busy}
              className="t-label cursor-pointer font-semibold text-accent hover:underline disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Borrando…" : "Sí, borrar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="t-label cursor-pointer text-ink-soft hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-2 text-sm text-accent">
          {problem}
        </p>
      )}
    </li>
  );
}

function describeOutcome(folder: FolderOutcome): string {
  switch (folder.kind) {
    case "trashed":
      return `Lugar borrado. La carpeta ${folder.country} estaba vacía y ha ido a la papelera de Drive, de donde puedes recuperarla durante 30 días.`;
    case "kept-not-empty":
      return `Lugar borrado. La carpeta ${folder.country} tiene contenido, así que la he dejado intacta — bórrala tú desde Drive si quieres.`;
    case "kept-still-used":
      return `Lugar borrado. La carpeta ${folder.country} sigue en uso por otro lugar, así que no se toca.`;
    case "none":
      return "Lugar borrado. No había ninguna carpeta que retirar.";
  }
}
