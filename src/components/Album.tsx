"use client";

import { useState } from "react";
import { ChipWriter } from "@/components/ChipWriter";
import { CopyButton } from "@/components/CopyButton";
import { Gallery } from "@/components/Gallery";
import { UploadPreview } from "@/components/UploadPreview";
import { type Place } from "@/lib/catalog";
import { placeUrl } from "@/lib/env";
import { flagOf } from "@/lib/flags";

/**
 * One place: its heading, its uploader, and its photos.
 *
 * Shared by `/place/[id]` and `/t/[slug]` because they are the same page
 * reached two ways — by browsing, or by putting a phone against the souvenir.
 * The scan used to stop at a link to this view, which made the chip a
 * signpost pointing at the thing it should simply have been.
 *
 * What differs is only the opening posture: someone who just scanned is
 * standing there with photos to add, so the uploader starts open for them and
 * stays closed for someone browsing an album to look at it.
 */
export function Album({
  place,
  openUpload = false,
  showChip = true,
}: {
  place: Place;
  /** Start with the file picker open, as scanning a chip does. */
  openUpload?: boolean;
  /** Show the chip's own address, for copying onto a new tag. */
  showChip?: boolean;
}) {
  const [uploading, setUploading] = useState(openUpload);
  const [galleryKey, setGalleryKey] = useState(0);

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

      {showChip && (
        <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule pt-4">
          <span className="t-label text-ink-soft">Su chip</span>
          <span className="flex items-baseline gap-4">
            <code className="font-mono text-xs text-ink-soft">
              /t/{place.slug}
            </code>
            <CopyButton
              value={placeUrl(
                place.slug,
                typeof window === "undefined" ? "" : window.location.origin,
              )}
            />
            <ChipWriter slug={place.slug} />
          </span>
        </div>
      )}
    </>
  );
}
