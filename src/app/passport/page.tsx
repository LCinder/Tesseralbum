"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { sortedPlaces } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";
import { listEverything } from "@/lib/google/drive";
import { memo } from "@/lib/memo";
import {
  buildPassport,
  flagOf,
  tripsFromListing,
  type CountryEntry,
  type Passport,
} from "@/lib/passport";

export default function PassportPage() {
  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Record />
      </SessionGate>
    </Shell>
  );
}

function Record() {
  const { getToken, catalog } = useSession();

  const [passport, setPassport] = useState<Passport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const { folders, media } = await memo("everything", () =>
          listEverything(getToken, { signal: controller.signal }),
        );
        if (cancelled) return;

        setPassport(
          buildPassport(
            sortedPlaces(catalog),
            tripsFromListing(folders, media),
          ),
        );
        setProblem(null);
      } catch (cause) {
        if (cancelled) return;
        setProblem(
          cause instanceof Error
            ? cause.message
            : "No se pudo leer el pasaporte.",
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken, catalog]);

  if (problem) {
    return (
      <>
        <Title />
        <p
          role="alert"
          className="border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
        >
          {problem}
        </p>
      </>
    );
  }

  if (!passport) {
    return (
      <>
        <Title />
        <p className="t-label text-ink-soft" role="status">
          Sumando tus viajes…
        </p>
      </>
    );
  }

  if (passport.tripCount === 0) {
    return (
      <>
        <Title />
        <p className="max-w-lg text-lg text-ink-soft">
          Todavía no hay ningún viaje. Escanea un souvenir, sube las fotos, y
          esta página se llena sola.{" "}
          <Link href="/" className="text-accent underline">
            Tus lugares
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Title />

      <dl className="mb-10 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat value={passport.countries.length} label="países" />
        <Stat value={passport.cityCount} label="ciudades" />
        <Stat value={passport.tripCount} label="viajes" />
        <Stat value={passport.daysTravelling} label="días fuera" />
      </dl>

      {passport.firstVisit && passport.lastVisit && (
        <p className="mb-10 max-w-lg text-ink-soft">
          Desde {passport.firstVisit.toLocaleDateString("es")} hasta{" "}
          {passport.lastVisit.toLocaleDateString("es")}, con{" "}
          {passport.photoCount} {passport.photoCount === 1 ? "foto" : "fotos"}{" "}
          guardadas.
        </p>
      )}

      <SectionLabel>Países</SectionLabel>

      <ul className="mb-12 border-t border-rule">
        {passport.countries.map((entry) => (
          <Country key={entry.country} entry={entry} />
        ))}
      </ul>

      {passport.byYear.length > 1 && (
        <>
          <SectionLabel>Por año</SectionLabel>
          <ByYear years={passport.byYear} />
        </>
      )}
    </>
  );
}

function Title() {
  return (
    <h1 className="t-display mb-6 text-4xl font-bold leading-none sm:text-5xl">
      Pasaporte
    </h1>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dt className="t-label text-ink-soft">{label}</dt>
      <dd className="t-display text-4xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Country({ entry }: { entry: CountryEntry }) {
  const flag = flagOf(entry.countryCode);

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule py-4">
      <div>
        <h2 className="t-display text-lg font-semibold">
          {flag && (
            <span aria-hidden="true" className="mr-2">
              {flag}
            </span>
          )}
          {entry.country}
        </h2>
        <p className="t-label mt-0.5 text-ink-soft">
          {entry.cities.join(" · ")}
        </p>
      </div>

      <div className="text-right">
        <p className="tabular-nums">
          {entry.trips} {entry.trips === 1 ? "viaje" : "viajes"} ·{" "}
          {entry.photos} {entry.photos === 1 ? "foto" : "fotos"}
        </p>
        {entry.firstVisit && (
          <p className="t-label mt-0.5 text-ink-soft tabular-nums">
            {entry.firstVisit.getFullYear() === entry.lastVisit?.getFullYear()
              ? entry.firstVisit.getFullYear()
              : `${entry.firstVisit.getFullYear()}–${entry.lastVisit?.getFullYear()}`}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Trips per year as bars.
 *
 * Scaled against the busiest year rather than an absolute maximum, so the
 * shape reads the same whether the record holds three trips or thirty.
 */
function ByYear({
  years,
}: {
  years: { year: string; trips: number; photos: number }[];
}) {
  const busiest = Math.max(...years.map((y) => y.trips));

  return (
    <ul className="flex flex-col gap-2 border-t border-rule pt-4">
      {years.map((year) => (
        <li
          key={year.year}
          className="grid grid-cols-[3rem_1fr_auto] items-center gap-3"
        >
          <span className="font-mono text-sm text-ink-soft tabular-nums">
            {year.year || "—"}
          </span>
          <span className="h-4 bg-surface-2">
            <span
              className="block h-full bg-accent"
              style={{ width: `${(year.trips / busiest) * 100}%` }}
            />
          </span>
          <span className="t-label text-ink-soft tabular-nums">
            {year.trips} · {year.photos} fotos
          </span>
        </li>
      ))}
    </ul>
  );
}
