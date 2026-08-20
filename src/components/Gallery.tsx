"use client";

import { useEffect, useState } from "react";
import { DriveImage } from "@/components/DriveImage";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { TripNotes } from "@/components/TripNotes";
import { Viewer } from "@/components/Viewer";
import { ROOT_FOLDER, type Place } from "@/lib/catalog";
import {
  isDisplayable,
  isVideo,
  listTrips,
  type Shot,
  type Trip,
} from "@/lib/gallery";

/**
 * The album for one place: the trips first, the photos second.
 *
 * Going back to a city is common, and pouring every visit into one grid mixes
 * them — a wall where 2024 and 2026 sit side by side with nothing marking the
 * seam. The trips are the index; a photo grid opens inside one.
 */
export function Gallery({ place }: { place: Place }) {
  const { getToken } = useSession();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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
        // One trip is not a choice worth making the reader click through.
        if (found.length === 1) setOpenId(found[0].folderId);
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
    setOpenId(null);
    setAttempt((n) => n + 1);
  };

  if (problem) {
    return (
      <>
        <SectionLabel>Viajes</SectionLabel>
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
        <SectionLabel>Viajes</SectionLabel>
        <p className="t-label text-ink-soft" role="status">
          Leyendo tu Drive…
        </p>
      </>
    );
  }

  if (trips.length === 0) {
    return (
      <>
        <SectionLabel>Viajes</SectionLabel>
        <p className="mb-10 max-w-lg text-ink-soft">
          Todavía ninguno. Escanea el chip de {place.city} y sube las primeras
          fotos — irán a{" "}
          <code className="font-mono text-sm">
            {ROOT_FOLDER}/{place.country}/
          </code>{" "}
          en carpetas que salen de sus propias fechas.
        </p>
      </>
    );
  }

  const open = trips.find((trip) => trip.folderId === openId) ?? null;

  if (open) {
    return (
      <OpenTrip
        trip={open}
        // Only offer a way back when there is somewhere to go back to.
        onBack={trips.length > 1 ? () => setOpenId(null) : undefined}
      />
    );
  }

  const total = trips.reduce((sum, trip) => sum + trip.shots.length, 0);

  return (
    <>
      <SectionLabel>
        {trips.length} {trips.length === 1 ? "viaje" : "viajes"} · {total}{" "}
        {total === 1 ? "foto" : "fotos"}
      </SectionLabel>

      <ul className="border-t border-rule">
        {trips.map((trip) => (
          <li key={trip.folderId} className="border-b border-rule">
            <button
              type="button"
              onClick={() => setOpenId(trip.folderId)}
              className="flex w-full cursor-pointer items-center gap-4 py-3 text-left hover:text-accent"
            >
              {/* The first photo as a stamp, so the list reads as journeys
                  rather than as a folder listing. */}
              <span className="w-16 shrink-0">
                {trip.shots[0] && isDisplayable(trip.shots[0]) ? (
                  <DriveImage
                    fileId={trip.shots[0].id}
                    thumbnailLink={trip.shots[0].thumbnailLink}
                    thumbId={trip.shots[0].thumbId}
                    alt=""
                    className="aspect-square w-16 bg-surface-2 object-cover"
                  />
                ) : (
                  <span className="block aspect-square w-16 bg-surface-2" />
                )}
              </span>

              <span className="grow">
                <span className="t-display block text-lg font-semibold">
                  {trip.name}
                  <span className="ml-2 font-normal text-ink-soft">
                    {trip.year}
                  </span>
                </span>
                <span className="t-label block text-ink-soft">
                  {trip.span
                    ? `${trip.span.from.toLocaleDateString("es")} → ${trip.span.to.toLocaleDateString("es")}`
                    : "sin fechas"}
                </span>
              </span>

              <span className="t-label shrink-0 text-ink-soft tabular-nums">
                {trip.shots.length} {trip.shots.length === 1 ? "foto" : "fotos"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function OpenTrip({ trip, onBack }: { trip: Trip; onBack?: () => void }) {
  const [viewing, setViewing] = useState<number | null>(null);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="t-display text-xl font-bold">
          {trip.name}
          <span className="ml-2 font-normal text-ink-soft">{trip.year}</span>
        </h2>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="t-label cursor-pointer text-accent hover:underline"
          >
            ← Todos los viajes
          </button>
        )}
      </div>

      {trip.span && (
        <p className="mb-4 font-mono text-xs text-ink-soft tabular-nums">
          {trip.span.from.toLocaleDateString("es")} →{" "}
          {trip.span.to.toLocaleDateString("es")}
        </p>
      )}

      <TripNotes folderId={trip.folderId} />

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {trip.shots.map((shot, i) => (
          <Tile key={shot.id} shot={shot} onOpen={() => setViewing(i)} />
        ))}
      </ul>

      {viewing !== null && (
        <Viewer
          shots={trip.shots}
          index={viewing}
          onClose={() => setViewing(null)}
          onMove={setViewing}
        />
      )}
    </>
  );
}

function Tile({ shot, onOpen }: { shot: Shot; onOpen: () => void }) {
  const approximate = shot.geoSource !== "exif";

  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Abrir ${shot.name}`}
        className="block w-full cursor-pointer"
      >
      {isDisplayable(shot) ? (
        <DriveImage
          fileId={shot.id}
          thumbnailLink={shot.thumbnailLink}
          thumbId={shot.thumbId}
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

      </button>

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
              // The map leans on this: a pin from the place's coordinates is a
              // city, not a spot.
              title="Ubicación aproximada, del lugar"
            >
              aprox.
            </span>
          )}
        </span>
      </div>
    </li>
  );
}
