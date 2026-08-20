"use client";

import { use } from "react";
import Link from "next/link";
import { Album } from "@/components/Album";
import { SessionGate, Shell } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { SetupNeeded } from "@/components/SetupNeeded";
import { findPlaceBySlug } from "@/lib/catalog";
import { isConfigured } from "@/lib/env";

/**
 * The NFC landing page.
 *
 * This used to be a server route that set a signed cookie. It no longer needs
 * to: access is whatever Drive grants the signed-in account, so scanning is
 * pure navigation. The slug says *which* album to open, and Drive decides
 * whether this person may see it.
 *
 * It shows the album itself rather than a link to it. Scanning is already the
 * gesture that says "open this"; asking for a second one made the chip a
 * doorway with another door behind it.
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

  // Open on the uploader: whoever just tapped the souvenir is standing there
  // with the photos. The chip's own address is not worth repeating to someone
  // who arrived through it.
  return <Album key={place.id} place={place} openUpload showChip={false} />;
}
