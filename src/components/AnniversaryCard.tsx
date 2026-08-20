"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DriveImage } from "@/components/DriveImage";
import { useSession } from "@/components/SessionProvider";
import { anniversariesOn, yearsAgoLabel } from "@/lib/anniversary";
import type { Place } from "@/lib/catalog";
import { listByPlace, listEverything } from "@/lib/google/drive";
import { memo } from "@/lib/memo";
import { tripsFromListing } from "@/lib/passport";
import type { Preview } from "@/lib/map";
import { loadAnniversary, saveAnniversary } from "@/lib/session-store";

/**
 * "A year ago today you were in Kyoto."
 *
 * Renders nothing on the great majority of days, and that is the point: a card
 * that appeared every time would be furniture, and furniture gets ignored.
 * When it does appear it should feel like the app remembered something.
 *
 * The answer is worked out once a day and kept, because finding it means
 * sweeping the whole archive and the answer is "no" on all but a handful of
 * days a year.
 */

type Memory = {
  placeId: string;
  label: string;
  detail: string;
  previews: Preview[];
};

/** Local date, so the cache turns over at the reader's midnight. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function AnniversaryCard({ places }: { places: Place[] }) {
  const { getToken } = useSession();
  const [found, setFound] = useState<Memory | null>(null);

  useEffect(() => {
    if (places.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const today = todayKey();

      // Answered already today, including a remembered "no". Without this the
      // home page would sweep the whole archive on every visit, almost always
      // to find nothing.
      const cached = loadAnniversary<Memory>(today);
      if (cached) {
        if (cached.value) setFound(cached.value);
        return;
      }

      try {
        // The same key the passport uses: whichever runs first pays, and the
        // other gets it free.
        const { folders, media } = await memo("everything", () =>
          listEverything(getToken, { signal: controller.signal }),
        );
        if (cancelled) return;

        const [anniversary] = anniversariesOn(
          new Date(),
          tripsFromListing(folders, media),
        );

        if (!anniversary) {
          saveAnniversary(today, null);
          return;
        }

        const place = places.find((p) => p.id === anniversary.trip.placeId);
        if (!place) return;

        const previews = await memo(`preview:${place.id}`, () =>
          listByPlace(getToken, place.id, {
            limit: 3,
            signal: controller.signal,
          }),
        );
        if (cancelled) return;

        const memory: Memory = {
          placeId: place.id,
          label: yearsAgoLabel(anniversary.yearsAgo),
          detail:
            anniversary.tripLength > 1
              ? `día ${anniversary.dayOfTrip} de ${anniversary.tripLength}`
              : "",
          previews: previews.map((file) => ({
            id: file.id,
            name: file.name,
            thumbnailLink: file.thumbnailLink,
            thumbId: file.appProperties?.thumbId,
            mimeType: file.mimeType,
          })),
        };

        saveAnniversary(today, memory);
        setFound(memory);
      } catch {
        // Silent by design, and deliberately uncached: a network failure is
        // not an answer, and storing it would suppress a real memory until
        // tomorrow.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken, places]);

  if (!found) return null;

  const place = places.find((candidate) => candidate.id === found.placeId);
  // The place could have been deleted since the memory was stored this morning.
  if (!place) return null;

  return (
    <Link
      href={`/place/${place.id}`}
      className="mb-10 block border-l-[3px] border-accent bg-accent-bg px-4 py-4 transition-opacity hover:opacity-90"
    >
      <p className="t-label mb-1 text-accent">
        {found.label}
        {found.detail && ` · ${found.detail}`}
      </p>

      <p className="t-display mb-3 text-2xl font-bold">
        Estabas en {place.city}
        <span className="ml-2 text-lg font-normal text-ink-soft">
          {place.country}
        </span>
      </p>

      {found.previews.length > 0 && (
        <div className="flex gap-2">
          {found.previews.map((preview) => (
            <DriveImage
              key={preview.id}
              fileId={preview.id}
              thumbnailLink={preview.thumbnailLink}
              thumbId={preview.thumbId}
              alt=""
              className="aspect-square w-20 bg-surface-2 object-cover"
            />
          ))}
        </div>
      )}
    </Link>
  );
}
