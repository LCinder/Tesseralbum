"use client";

import { use } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { Gallery } from "@/components/Gallery";
import { SectionLabel, SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { souvenirsOfPlace } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";

export default function PlacePage({ params }: PageProps<"/place/[id]">) {
  const { id } = use(params);

  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Album id={id} />
      </SessionGate>
    </Shell>
  );
}

function Album({ id }: { id: string }) {
  const { catalog } = useSession();
  if (!catalog) return null;

  const place = catalog.places.find((candidate) => candidate.id === id);

  if (!place) {
    return (
      <>
        <p className="t-label mb-3 text-accent">Sin resultados</p>
        <h1 className="t-display mb-4 text-4xl font-bold leading-none">
          Este lugar no está en tu catálogo
        </h1>
        <p className="mb-6 max-w-lg text-lg text-ink-soft">
          Puede que el enlace sea de otro Drive, o que el lugar se diera de
          baja.
        </p>
        <p>
          <Link href="/" className="text-accent underline">
            Volver a tus lugares
          </Link>
        </p>
      </>
    );
  }

  const souvenirs = souvenirsOfPlace(catalog, place.id);

  return (
    <>
      <p className="t-label mb-2 text-teal">{place.country}</p>

      <h1 className="t-display mb-3 text-5xl font-bold leading-none sm:text-6xl">
        {place.city}
      </h1>

      <p className="mb-10 font-mono text-sm text-ink-soft tabular-nums">
        {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
      </p>

      <Gallery place={place} />

      <SectionLabel>
        {souvenirs.length} souvenir{souvenirs.length === 1 ? "" : "s"}
      </SectionLabel>

      <ul className="border-t border-rule">
        {souvenirs.map((souvenir) => (
          <li
            key={souvenir.slug}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule py-3"
          >
            <code className="font-mono text-xs text-ink-soft">
              /t/{souvenir.slug}
            </code>
            <CopyButton
              value={`${typeof window === "undefined" ? "" : window.location.origin}/t/${souvenir.slug}`}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
