"use client";

import { use } from "react";
import Link from "next/link";
import { Album } from "@/components/Album";
import { SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { isConfigured } from "@/lib/env";

export default function PlacePage({ params }: PageProps<"/place/[id]">) {
  const { id } = use(params);

  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Found id={id} />
      </SessionGate>
    </Shell>
  );
}

function Found({ id }: { id: string }) {
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

  // Keyed on the place so walking from one album to another starts clean:
  // an unsent file selection must not follow you to a different city.
  return <Album key={place.id} place={place} />;
}
