"use client";

import Link from "next/link";
import { AnniversaryCard } from "@/components/AnniversaryCard";
import { NewPlaceForm } from "@/components/NewPlaceForm";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { ROOT_FOLDER, sortedPlaces } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";
import { flagOf } from "@/lib/flags";

export default function Home() {
  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Places />
      </SessionGate>
    </Shell>
  );
}

function Places() {
  const { catalog } = useSession();
  if (!catalog) return null;

  const places = sortedPlaces(catalog);
  const empty = places.length === 0;

  return (
    <>
      <h1 className="t-display mb-3 text-4xl font-bold leading-none sm:text-5xl">
        {empty ? "Empieza por un lugar" : "Tus lugares"}
      </h1>

      <p className="mb-10 max-w-lg text-lg text-ink-soft">
        {empty ? (
          <>
            Tu Drive está conectado y la carpeta{" "}
            <code className="font-mono text-base">{ROOT_FOLDER}</code> ya existe.
            Busca la ciudad de tu primer souvenir y dala de alta.
          </>
        ) : (
          "Las fotos se organizarán por sus propias fechas dentro de la carpeta del país."
        )}
      </p>

      {!empty && <AnniversaryCard places={places} />}

      <NewPlaceForm />

      {!empty && (
        <>
          <SectionLabel>
            {places.length} lugar{places.length === 1 ? "" : "es"}
          </SectionLabel>

          <ul className="border-t border-rule">
            {places.map((place) => {
              const flag = flagOf(place.countryCode);

              return (
                <li key={place.id} className="border-b border-rule">
                  {/* The whole row is the link, so the tap target is the row
                      and not just the button. The button is a span for that
                      reason: nesting one inside a link would be invalid and
                      would shrink the target to its own edges. */}
                  <Link
                    href={`/place/${place.id}`}
                    className="group flex items-center justify-between gap-4 py-4"
                  >
                    <span className="min-w-0">
                      <span className="t-display block text-lg font-semibold group-hover:text-accent">
                        {place.city}
                      </span>
                      <span className="t-label block text-ink-soft">
                        {flag && (
                          <span aria-hidden="true" className="mr-1.5">
                            {flag}
                          </span>
                        )}
                        {place.country}
                      </span>
                    </span>

                    <span className="t-label shrink-0 rounded-sm border border-rule px-3 py-1.5 text-ink-soft transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-accent-ink">
                      Ver álbum
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="mt-6">
            <Link href="/admin" className="t-label text-accent hover:underline">
              Gestionar lugares · copiar URLs y borrar
            </Link>
          </p>
        </>
      )}
    </>
  );
}
