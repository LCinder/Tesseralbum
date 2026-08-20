"use client";

import { use } from "react";
import Link from "next/link";
import { SessionGate, Shell } from "@/components/Shell";
import { UploadPreview } from "@/components/UploadPreview";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { findPlaceBySlug } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";
import { flagOf } from "@/lib/flags";

/**
 * The NFC landing page.
 *
 * This used to be a server route that set a signed cookie. It no longer needs
 * to: access is whatever Drive grants the signed-in account, so scanning is
 * pure navigation. The slug says *which* album to open, and Drive decides
 * whether this person may see it.
 */
export default function ScanPage({ params }: PageProps<"/t/[slug]">) {
  const { slug } = use(params);

  if (!isConfigured()) return <SetupNeeded />;

  return (
    <Shell>
      <SessionGate>
        <Scanned slug={slug} />
      </SessionGate>
    </Shell>
  );
}

function Scanned({ slug }: { slug: string }) {
  const { catalog } = useSession();
  if (!catalog) return null;

  const place = findPlaceBySlug(catalog, slug);

  if (!place) {
    return (
      <>
        <p className="t-label mb-3 text-accent">Lugar no reconocido</p>
        <h1 className="t-display mb-4 text-4xl font-bold leading-none">
          Este chip no está en tu catálogo
        </h1>
        <p className="mb-6 max-w-lg text-lg text-ink-soft">
          El chip ha respondido, pero su código no aparece en{" "}
          <code className="font-mono text-base">souvenirs.json</code>. O es de
          otro Drive, o el lugar se dio de baja.
        </p>
        <p>
          <Link href="/admin" className="text-accent underline">
            Dar de alta un lugar
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

      <p className="mb-10 font-mono text-sm text-ink-soft tabular-nums">
        {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
      </p>

      <UploadPreview place={place} slug={place.slug} />

      <p className="mt-10">
        <Link
          href={`/place/${place.id}`}
          className="t-display inline-block rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          Ver el álbum de {place.city}
        </Link>
      </p>
    </>
  );
}
