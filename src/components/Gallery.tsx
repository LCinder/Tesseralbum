"use client";

import { useEffect, useState } from "react";
import { DriveImage } from "@/components/DriveImage";
import { SectionLabel } from "@/components/Shell";
import { TripNotes } from "@/components/TripNotes";
import { useSession } from "@/components/SessionProvider";
import { ROOT_FOLDER, type Place } from "@/lib/catalog";
import {
  isDisplayable,
  isVideo,
  listTrips,
  type Shot,
  type Trip,
} from "@/lib/gallery";

/**
 * The album for one place, grouped by the trips Drive already holds.
 *
 * Reading is a walk down the folder tree — country, year, trip, files — and
 * the page tokens are sequential, so this gets slower as the archive grows.
 * That is the crossover where a local index earns its place; for now the
 * simple thing is the right thing.
 */
export function Gallery({ place }: { place: Place }) {
  const { getToken } = useSession();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Bumping this re-runs the effect, which is how "Reintentar" works without
  // a second code path that could drift from the first.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // `cancelled` guards against writing state after the component is gone —
    // easy to hit here, since a walk down the folder tree takes a while and
    // the user can navigate away mid-read.
    let cancelled = false;

    (async () => {
      try {
        const found = await listTrips(getToken, place);
        if (cancelled) return;
        setTrips(found);
        setProblem(null);
      } catch (cause) {
        if (cancelled) return;
        setProblem(
          cause instanceof Error ? cause.message : "No se pudo leer el álbum.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, place, attempt]);

  const retry = () => {
    setTrips(null);
    setProblem(null);
    setAttempt((n) => n + 1);
  };

  if (problem) {
    return (
      <>
        <SectionLabel>Fotos</SectionLabel>
        <p
          role="alert"
          className="mb-4 border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
        >
          {problem}
        </p>
        <button
          type="button"
          onClick={retry}
          className="t-label cursor-pointer text-accent hover:underline"
        >
          Reintentar
        </button>
      </>
    );
  }

  if (!trips) {
    return (
      <>
        <SectionLabel>Fotos</SectionLabel>
        <p className="t-label text-ink-soft" role="status">
          Leyendo tu Drive…
        </p>
      </>
    );
  }

  if (trips.length === 0) {
    return (
      <>
        <SectionLabel>Fotos</SectionLabel>
        <p className="mb-10 max-w-lg text-ink-soft">
          Todavía ninguna. Escanea el souvenir de {place.city} y sube las
          primeras — irán a{" "}
          <code className="font-mono text-sm">
            {ROOT_FOLDER}/{place.country}/
          </code>{" "}
          en carpetas que salen de sus propias fechas.
        </p>
      </>
    );
  }

  const total = trips.reduce((sum, trip) => sum + trip.shots.length, 0);

  return (
    <>
      <SectionLabel>
        {total} {total === 1 ? "foto" : "fotos"} · {trips.length}{" "}
        {trips.length === 1 ? "viaje" : "viajes"}
      </SectionLabel>

      {trips.map((trip) => (
        <section key={trip.folderId} className="mb-10">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="t-display text-lg font-semibold">
              {trip.name}
              <span className="ml-2 font-normal text-ink-soft">{trip.year}</span>
            </h2>
            {trip.span && (
              <p className="font-mono text-xs text-ink-soft tabular-nums">
                {trip.span.from.toLocaleDateString("es")} →{" "}
                {trip.span.to.toLocaleDateString("es")}
              </p>
            )}
          </div>

          <TripNotes folderId={trip.folderId} />

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {trip.shots.map((shot) => (
              <Tile key={shot.id} shot={shot} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Tile({ shot }: { shot: Shot }) {
  const approximate = shot.geoSource !== "exif";

  return (
    <li className="relative">
      {isDisplayable(shot) ? (
        <DriveImage
          fileId={shot.id}
          thumbnailLink={shot.thumbnailLink}
          alt={shot.name}
          className="aspect-square w-full bg-surface-2 object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-surface-2 p-2">
          <span className="t-label text-center text-ink-soft">
            HEIC · no visible
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-1.5">
        {shot.takenAt && (
          <span className="bg-paper/85 px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums">
            {shot.takenAt.toLocaleDateString("es")}
          </span>
        )}
        <span className="flex gap-1">
          {isVideo(shot) && (
            <span className="t-label bg-paper/85 px-1.5 py-0.5">vídeo</span>
          )}
          {approximate && (
            <span
              className="t-label bg-paper/85 px-1.5 py-0.5 text-ink-soft"
              // The map will lean on this: a pin from the souvenir's
              // coordinates is a city, not a spot.
              title="Ubicación aproximada, del souvenir"
            >
              aprox.
            </span>
          )}
        </span>
      </div>
    </li>
  );
}
