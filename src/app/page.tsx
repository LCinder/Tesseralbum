"use client";

import Link from "next/link";
import { AnniversaryCard } from "@/components/AnniversaryCard";
import { NewPlaceForm } from "@/components/NewPlaceForm";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { ROOT_FOLDER, sortedPlaces } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";

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

          {/* No count beside each row any more: it counted chips, and with
              places as the vocabulary "Kioto · 1 lugar" reads as nonsense.
              The city and its country say everything the list needs to. */}
          <ul className="border-t border-rule">
            {places.map((place) => (
              <li key={place.id} className="border-b border-rule">
                <Link
                  href={`/place/${place.id}`}
                  className="flex items-baseline justify-between gap-4 py-4 hover:text-accent"
                >
                  <span className="t-display text-lg font-semibold">
                    {place.city}
                  </span>
                  <span className="t-label text-ink-soft">{place.country}</span>
                </Link>
              </li>
            ))}
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
