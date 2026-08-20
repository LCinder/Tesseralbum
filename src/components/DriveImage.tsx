/* eslint-disable @next/next/no-img-element -- next/image cannot proxy a Drive
   URL that needs our bearer token, nor a blob: URL. This component exists
   precisely to do what next/image cannot. */
"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { readThumb, writeThumb } from "@/lib/cache";
import { downloadBlob } from "@/lib/google/drive";

/**
 * Shows a private Drive image, trying the cheapest source first.
 *
 * The order is driven by quota, not by convenience. Drive meters *API methods*:
 * a download is 200 units where a whole list is 100, so on a fifty-photo album
 * the images cost fifty times what finding them did. Anything that avoids a
 * metered download is worth trying first even if it sometimes fails.
 *
 * 1. **IndexedDB.** Free, instant, and covers every repeat visit for 30 days.
 * 2. **Google's `thumbnailLink`.** Served from a CDN host, so no Drive API
 *    method is invoked and no quota is spent. It expires after hours and needs
 *    the browser's Google session, which is exactly why it is a *try*, not a
 *    plan — but when it works it is free, and it usually works.
 * 3. **Our own 400 px copy.** A metered download, but of tens of kilobytes,
 *    and it never expires. This is what makes the chain reliable.
 * 4. **The original.** A metered download of the whole file, for anything
 *    uploaded before we started making thumbnails.
 *
 * Whatever reaches the screen is written back to the cache, so the second view
 * of an album costs nothing at all.
 */

type Stage = "checking" | "cdn" | "own" | "original" | "blob" | "failed";

/** The next source to try when the current one comes up empty. */
function after(current: Stage, hasOwn: boolean): Stage {
  if (current === "cdn") return hasOwn ? "own" : "original";
  if (current === "own") return "original";
  return "failed";
}

export function DriveImage({
  fileId,
  thumbnailLink,
  thumbId,
  alt,
  className,
}: {
  fileId: string;
  thumbnailLink?: string;
  thumbId?: string;
  alt: string;
  className?: string;
}) {
  const { getToken } = useSession();
  const [stage, setStage] = useState<Stage>("checking");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Revoking on unmount matters in a grid: a hundred un-revoked object URLs
  // pin a hundred images in memory for the life of the tab.
  const created = useRef<string | null>(null);

  const show = (blob: Blob) => {
    if (created.current) URL.revokeObjectURL(created.current);
    const url = URL.createObjectURL(blob);
    created.current = url;
    setBlobUrl(url);
    setStage("blob");
  };

  useEffect(() => {
    return () => {
      if (created.current) URL.revokeObjectURL(created.current);
    };
  }, []);

  useEffect(() => {
    if (stage !== "checking") return;
    let cancelled = false;

    (async () => {
      const cached = await readThumb(fileId);
      if (cancelled) return;

      if (cached) show(cached);
      else if (thumbnailLink) setStage("cdn");
      else if (thumbId) setStage("own");
      else setStage("original");
    })();

    return () => {
      cancelled = true;
    };
  }, [stage, fileId, thumbId, thumbnailLink]);

  // The two metered paths, which are the same request against different ids.
  useEffect(() => {
    if (stage !== "own" && stage !== "original") return;

    const target = stage === "own" ? (thumbId as string) : fileId;
    const controller = new AbortController();

    (async () => {
      try {
        const blob = await downloadBlob(getToken, target, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        show(blob);
        // Best effort: a failed write costs a re-download, not an error.
        void writeThumb(fileId, blob);
      } catch {
        if (!controller.signal.aborted) setStage(after(stage, Boolean(thumbId)));
      }
    })();

    return () => controller.abort();
  }, [stage, fileId, thumbId, getToken]);

  if (stage === "failed") {
    return (
      <div
        className={`flex items-center justify-center bg-surface-2 ${className ?? ""}`}
      >
        <span className="t-label px-2 text-center text-ink-soft">
          No se pudo cargar
        </span>
      </div>
    );
  }

  if (stage === "checking" || stage === "own" || stage === "original") {
    return (
      <div
        className={`animate-pulse bg-surface-2 ${className ?? ""}`}
        aria-label={`Cargando ${alt}`}
      />
    );
  }

  return (
    <img
      src={stage === "blob" && blobUrl ? blobUrl : sized(thumbnailLink)}
      alt={alt}
      loading="lazy"
      decoding="async"
      // An expired or refused CDN link must not leave a broken image; falling
      // through to a metered download is the price of the free attempt.
      onError={() => setStage(after(stage, Boolean(thumbId)))}
      // A CDN thumbnail that loaded is worth keeping, because caching it is
      // what makes the next visit free. Re-fetching it costs no quota and the
      // browser already has it, so this is nearly instant.
      onLoad={() => {
        if (stage !== "cdn") return;
        const link = sized(thumbnailLink);
        if (!link) return;

        void fetch(link)
          .then((response) => (response.ok ? response.blob() : null))
          .then((blob) => blob && writeThumb(fileId, blob))
          .catch(() => {
            // Cross-origin rules may forbid reading it. The image is on screen
            // either way; only the caching is lost.
          });
      }}
      className={className}
    />
  );
}

/**
 * Asks Google for a bigger thumbnail than the default.
 *
 * The links end in a size hint like `=s220`; rewriting it to `s400` gets a
 * sharper image at no extra request. Unrecognised shapes are left alone.
 */
function sized(link: string | undefined): string | undefined {
  if (!link) return undefined;
  return link.replace(/=s\d+(-c)?$/, "=s400");
}
