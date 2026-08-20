"use client";

import { use } from "react";
import Link from "next/link";
import { SessionGate, SectionLabel, Shell } from "@/components/Shell";
import { UploadPreview } from "@/components/UploadPreview";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { findSouvenir, souvenirsOfPlace } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";

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

  const found = findSouvenir(catalog, slug);

  if (!found) {
    return (
      <>
        <p className="t-label mb-3 text-accent">Lugar no reconocido</p>
        <h1 className="t-display mb-4 text-4xl font-bold leading-none">
          Este souvenir no está en tu catálogo
        </h1>
        <p className="mb-6 max-w-lg text-lg text-ink-soft">
          El chip ha respondido, pero su código no aparece en{" "}
          <code className="font-mono text-base">souvenirs.json</code>. O es de
          otro Drive, o el lugar se dio de baja.
        </p>
        <p>
          <Link href="/admin" className="text-accent underline">
            Darla de alta ahora
          </Link>
        </p>
      </>
    );
  }

  const { souvenir, place } = found;
  const siblings = souvenirsOfPlace(catalog, place.id).filter(
    (other) => other.slug !== souvenir.slug,
  );

  return (
    <>
      <p className="t-label mb-2 text-teal">{place.country}</p>

      <h1 className="t-display mb-3 text-5xl font-bold leading-none sm:text-6xl">
        {place.city}
      </h1>

      <p className="mb-10 font-mono text-sm text-ink-soft tabular-nums">
        {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
      </p>

      <UploadPreview place={place} slug={souvenir.slug} />

      {siblings.length > 0 && (
        <>
          <SectionLabel>Otros chips de {place.city}</SectionLabel>
          <ul className="border-t border-rule">
            {siblings.map((other) => (
              <li
                key={other.slug}
                className="border-b border-rule py-3 font-mono text-xs text-ink-soft"
              >
                /t/{other.slug}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-10">
        <Link href={`/place/${place.id}`} className="text-accent underline">
          Ver el álbum de {place.city}
        </Link>
      </p>
    </>
  );
}
