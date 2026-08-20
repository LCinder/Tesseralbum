"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DriveImage } from "@/components/DriveImage";
import { MapView } from "@/components/MapView";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { sortedPlaces, type Place } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";
import { listByPlace } from "@/lib/google/drive";
import { countriesOf, type Preview } from "@/lib/map";

/** How many photos a pin previews before you commit to opening the album. */
const PREVIEW_COUNT = 3;

export default function MapPage() {
  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Atlas />
      </SessionGate>
    </Shell>
  );
}

function Atlas() {
  const { catalog } = useSession();
  const [selected, setSelected] = useState<Place | null>(null);

  if (!catalog) return null;

  const places = sortedPlaces(catalog);

  if (places.length === 0) {
    return (
      <>
        <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
          Mapa
        </h1>
        <p className="max-w-lg text-lg text-ink-soft">
          Todavía no hay ningún lugar.{" "}
          <Link href="/" className="text-accent underline">
            Da de alta tu primera pegatina
          </Link>{" "}
          y aparecerá aquí.
        </p>
      </>
    );
  }

  const countries = countriesOf(places);

  return (
    <>
      <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
        Mapa
      </h1>

      <p className="mb-6 max-w-lg text-ink-soft">
        {places.length} {places.length === 1 ? "lugar" : "lugares"} en{" "}
        {countries.length} {countries.length === 1 ? "país" : "países"}. Pulsa
        un punto para asomarte, y de ahí al álbum.
      </p>

      <MapView
        places={places}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
      />

      {selected ? (
        <PlaceCard
          key={selected.id}
          place={selected}
          onClose={() => setSelected(null)}
        />
      ) : (
        <p className="mt-6 text-[0.95rem] text-ink-soft">
          {countries.join(" · ")}
        </p>
      )}
    </>
  );
}

/**
 * The peek at a place: a few photos and a way into its album.
 *
 * Fetched on selection rather than up front, so opening the map costs one
 * catalogue read that is already in memory — not a sweep of every photo in
 * every country.
 */
function PlaceCard({ place, onClose }: { place: Place; onClose: () => void }) {
  const { getToken } = useSession();
  // Remounted per place via a key, so this starts empty on every selection
  // without an effect having to reset it.
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const files = await listByPlace(getToken, place.id, {
          limit: PREVIEW_COUNT,
          signal: controller.signal,
        });
        if (cancelled) return;

        setPreviews(
          files.map((file) => ({
            id: file.id,
            name: file.name,
            thumbnailLink: file.thumbnailLink,
            mimeType: file.mimeType,
          })),
        );
      } catch (cause) {
        if (cancelled) return;
        setProblem(
          cause instanceof Error
            ? cause.message
            : "No se pudieron leer las fotos.",
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken, place.id]);

  return (
    <div className="mt-8">
      <SectionLabel>{place.country}</SectionLabel>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="t-display text-2xl font-bold">{place.city}</h2>
        <div className="flex items-baseline gap-4">
          <Link
            href={`/place/${place.id}`}
            className="t-label text-accent hover:underline"
          >
            Ver álbum
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="t-label cursor-pointer text-ink-soft hover:underline"
          >
            Cerrar
          </button>
        </div>
      </div>

      {problem && (
        <p role="alert" className="text-sm text-accent">
          {problem}
        </p>
      )}

      {!problem && previews === null && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: PREVIEW_COUNT }, (_, i) => (
            <div
              key={i}
              className="aspect-square w-full animate-pulse bg-surface-2"
            />
          ))}
        </div>
      )}

      {previews?.length === 0 && (
        <p className="text-ink-soft">
          Ninguna foto todavía. Escanea el souvenir de {place.city} para subir
          las primeras.
        </p>
      )}

      {previews && previews.length > 0 && (
        <Link href={`/place/${place.id}`} className="block">
          <ul className="grid grid-cols-3 gap-2">
            {previews.map((preview) => (
              <li key={preview.id}>
                <DriveImage
                  fileId={preview.id}
                  thumbnailLink={preview.thumbnailLink}
                  alt={preview.name}
                  className="aspect-square w-full bg-surface-2 object-cover"
                />
              </li>
            ))}
          </ul>
        </Link>
      )}
    </div>
  );
}
