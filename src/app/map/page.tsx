"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DriveImage } from "@/components/DriveImage";
import { MapView } from "@/components/MapView";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { isConfigured } from "@/lib/env";
import { listAllMedia } from "@/lib/google/drive";
import {
  filterByYear,
  yearsOf,
  type Cluster,
  type Pin,
} from "@/lib/map";

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
  const { getToken, catalog } = useSession();

  const [pins, setPins] = useState<Pin[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [selected, setSelected] = useState<Cluster | null>(null);
  const [withoutCoords, setWithoutCoords] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const files = await listAllMedia(getToken, {
          signal: controller.signal,
        });
        if (cancelled) return;

        const usable: Pin[] = [];
        let skipped = 0;

        for (const file of files) {
          const properties = file.appProperties ?? {};
          const lat = Number(properties.lat);
          const lng = Number(properties.lng);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            skipped += 1;
            continue;
          }

          const takenAt = properties.takenAt
            ? new Date(properties.takenAt)
            : null;

          usable.push({
            id: file.id,
            name: file.name,
            lat,
            lng,
            geoSource: properties.geoSource ?? "none",
            takenAt:
              takenAt && Number.isFinite(takenAt.getTime()) ? takenAt : null,
            placeId: properties.placeId ?? null,
            thumbnailLink: file.thumbnailLink,
            mimeType: file.mimeType,
          });
        }

        setPins(usable);
        setWithoutCoords(skipped);
        setProblem(null);
      } catch (cause) {
        if (cancelled) return;
        setProblem(
          cause instanceof Error ? cause.message : "No se pudo leer el mapa.",
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken]);

  if (problem) {
    return (
      <>
        <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
          Mapa
        </h1>
        <p
          role="alert"
          className="border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
        >
          {problem}
        </p>
      </>
    );
  }

  if (!pins) {
    return (
      <>
        <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
          Mapa
        </h1>
        <p className="t-label text-ink-soft" role="status">
          Leyendo tu Drive…
        </p>
      </>
    );
  }

  if (pins.length === 0) {
    return (
      <>
        <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
          Mapa
        </h1>
        <p className="max-w-lg text-lg text-ink-soft">
          Todavía no hay fotos con ubicación. Sube algunas desde el souvenir de
          un lugar y aparecerán aquí.{" "}
          <Link href="/" className="text-accent underline">
            Tus lugares
          </Link>
        </p>
      </>
    );
  }

  const years = yearsOf(pins);
  const showing = filterByYear(pins, year);
  const approximate = showing.filter((p) => p.geoSource !== "exif").length;

  return (
    <>
      <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
        Mapa
      </h1>

      <p className="mb-6 max-w-lg text-ink-soft">
        {showing.length} {showing.length === 1 ? "foto" : "fotos"} con
        ubicación. Los círculos huecos son aproximados: la foto llegó sin GPS y
        usa las coordenadas de su souvenir.
      </p>

      {years.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <YearChip active={year === null} onClick={() => setYear(null)}>
            Todos
          </YearChip>
          {years.map((candidate) => (
            <YearChip
              key={candidate}
              active={year === candidate}
              onClick={() => setYear(candidate)}
            >
              {candidate}
            </YearChip>
          ))}
        </div>
      )}

      <MapView pins={showing} onSelect={setSelected} />

      <p className="t-label mt-2 text-ink-soft">
        {approximate > 0 && <>{approximate} aproximadas · </>}
        {withoutCoords > 0 && <>{withoutCoords} sin ubicación · </>}
        Teselas de OpenStreetMap
      </p>

      {selected && (
        <div className="mt-8">
          <SectionLabel>
            {selected.pins.length}{" "}
            {selected.pins.length === 1 ? "foto aquí" : "fotos aquí"}
          </SectionLabel>

          <div className="mb-3 flex items-baseline justify-between gap-4">
            <p className="font-mono text-xs text-ink-soft tabular-nums">
              {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
              {selected.approximate && " · aproximado"}
            </p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="t-label cursor-pointer text-accent hover:underline"
            >
              Cerrar
            </button>
          </div>

          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {selected.pins.map((shot) => {
              const place = catalog?.places.find((p) => p.id === shot.placeId);
              return (
                <li key={shot.id}>
                  <DriveImage
                    fileId={shot.id}
                    thumbnailLink={shot.thumbnailLink}
                    alt={shot.name}
                    className="aspect-square w-full bg-surface-2 object-cover"
                  />
                  <p className="t-label mt-1 truncate text-ink-soft">
                    {shot.takenAt
                      ? shot.takenAt.toLocaleDateString("es")
                      : place?.city ?? shot.name}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function YearChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`t-label cursor-pointer border px-3 py-1.5 tabular-nums transition-colors ${
        active
          ? "border-accent bg-accent text-accent-ink"
          : "border-rule text-ink-soft hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
