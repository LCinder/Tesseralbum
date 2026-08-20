"use client";

import { use, useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { Gallery } from "@/components/Gallery";
import { SessionGate, Shell } from "@/components/Shell";
import { UploadPreview } from "@/components/UploadPreview";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { isConfigured } from "@/lib/env";
import { flagOf } from "@/lib/flags";

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

  // Declared before the guard below: a hook after a conditional return would
  // run on some renders and not others.
  const [uploading, setUploading] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);

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

  return (
    <>
      <p className="t-label mb-2 text-teal">
        {flagOf(place.countryCode) && (
          <span aria-hidden="true" className="mr-1.5">
            {flagOf(place.countryCode)}
          </span>
        )}
        {place.country}
      </p>

      <h1 className="t-display mb-3 text-5xl font-bold leading-none sm:text-6xl">
        {place.city}
      </h1>

      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-sm text-ink-soft tabular-nums">
          {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
        </p>

        {!uploading && (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="t-display cursor-pointer rounded-sm bg-accent px-4 py-2 font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            Subir fotos
          </button>
        )}
      </div>

      {/* Closed by default: this page is for looking at photos, and a file
          picker sitting open under every album would be furniture. */}
      {uploading && (
        <div className="mb-10 border-l-[3px] border-accent bg-accent-bg px-4 py-4">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <span className="t-label text-accent">Añadir a {place.city}</span>
            <button
              type="button"
              onClick={() => setUploading(false)}
              className="t-label cursor-pointer text-ink-soft hover:underline"
            >
              Cerrar
            </button>
          </div>

          <UploadPreview
            place={place}
            slug={place.slug}
            // Remounting the gallery is how it picks up what just arrived;
            // otherwise the album underneath keeps showing the old count.
            onUploaded={() => setGalleryKey((n) => n + 1)}
          />
        </div>
      )}

      <Gallery key={galleryKey} place={place} />

      <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule pt-4">
        <span className="t-label text-ink-soft">Su chip</span>
        <span className="flex items-baseline gap-4">
          <code className="font-mono text-xs text-ink-soft">
            /t/{place.slug}
          </code>
          <CopyButton
            value={`${typeof window === "undefined" ? "" : window.location.origin}/t/${place.slug}`}
          />
        </span>
      </div>
    </>
  );
}
