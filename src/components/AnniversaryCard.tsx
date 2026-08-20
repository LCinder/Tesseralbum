"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DriveImage } from "@/components/DriveImage";
import { useSession } from "@/components/SessionProvider";
import { anniversariesOn, yearsAgoLabel } from "@/lib/anniversary";
import type { Place } from "@/lib/catalog";
import { listByPlace, listEverything } from "@/lib/google/drive";
import { tripsFromListing } from "@/lib/passport";
import type { Preview } from "@/lib/map";

/**
 * "A year ago today you were in Kyoto."
 *
 * Renders nothing on the great majority of days, and that is the point: a card
 * that appeared every time would be furniture, and furniture gets ignored.
 * When it does appear it should feel like the app remembered something.
 */
export function AnniversaryCard({ places }: { places: Place[] }) {
  const { getToken } = useSession();
  const [found, setFound] = useState<{
    place: Place;
    label: string;
    detail: string;
    previews: Preview[];
  } | null>(null);

  useEffect(() => {
    if (places.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const { folders, media } = await listEverything(getToken, {
          signal: controller.signal,
        });
        if (cancelled) return;

        const [anniversary] = anniversariesOn(
          new Date(),
          tripsFromListing(folders, media),
        );
        if (!anniversary) return;

        const place = places.find((p) => p.id === anniversary.trip.placeId);
        if (!place) return;

        const previews = await listByPlace(getToken, place.id, {
          limit: 3,
          signal: controller.signal,
        });
        if (cancelled) return;

        setFound({
          place,
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
        });
      } catch {
        // Silent by design: this is a bonus, and an error message about a
        // memory nobody asked for would be worse than no memory.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken, places]);

  if (!found) return null;

  return (
    <Link
      href={`/place/${found.place.id}`}
      className="mb-10 block border-l-[3px] border-accent bg-accent-bg px-4 py-4 transition-opacity hover:opacity-90"
    >
      <p className="t-label mb-1 text-accent">
        {found.label}
        {found.detail && ` · ${found.detail}`}
      </p>

      <p className="t-display mb-3 text-2xl font-bold">
        Estabas en {found.place.city}
        <span className="ml-2 text-lg font-normal text-ink-soft">
          {found.place.country}
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
