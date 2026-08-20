/* eslint-disable @next/next/no-img-element -- next/image cannot proxy a Drive
   URL that needs our bearer token, nor a blob: URL. This component exists
   precisely to do what next/image cannot. */
"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { readThumb, writeThumb } from "@/lib/cache";
import { downloadBlob } from "@/lib/google/drive";

/**
 * Shows a private Drive image, with three paths in order of cost.
 *
 * 1. IndexedDB, if this file was fetched before. Free and instant.
 * 2. Our own 400 px copy, made at upload time. A few tens of kilobytes over an
 *    API we control, so it neither expires nor depends on another host.
 * 3. Google's `thumbnailLink`, for anything uploaded before we made our own.
 * 4. The Drive API on the original. Always works, at the price of the whole
 *    file, which is why it is last.
 *
 * Whatever ends up on screen from paths 2 and 3 is written back to the cache,
 * so the second visit to an album costs nothing.
 */

type Stage = "checking" | "own" | "google" | "downloading" | "blob" | "failed";

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

  // Look in the cache first, then fall through to whichever network path is
  // available.
  useEffect(() => {
    if (stage !== "checking") return;
    let cancelled = false;

    (async () => {
      const cached = await readThumb(fileId);
      if (cancelled) return;

      if (cached) show(cached);
      else if (thumbId) setStage("own");
      else if (thumbnailLink) setStage("google");
      else setStage("downloading");
    })();

    return () => {
      cancelled = true;
    };
  }, [stage, fileId, thumbId, thumbnailLink]);

  // Our own thumbnail, then the original as a last resort. Both are downloads
  // through the Drive API, so they share one effect.
  useEffect(() => {
    if (stage !== "own" && stage !== "downloading") return;

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
        if (controller.signal.aborted) return;
        // A thumbnail that has gone missing — deleted from Drive by hand —
        // must not lose the photo; fall through to whatever is left.
        if (stage !== "own") setStage("failed");
        else setStage(thumbnailLink ? "google" : "downloading");
      }
    })();

    return () => controller.abort();
  }, [stage, fileId, thumbId, thumbnailLink, getToken]);

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

  if (stage === "checking" || stage === "own" || stage === "downloading") {
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
      // Falling through to the authenticated download is the whole point: an
      // expired or refused thumbnail link must not leave a broken image.
      onError={() => setStage(stage === "google" ? "downloading" : "failed")}
      // A thumbnail that loaded is worth keeping; caching it here is what makes
      // the next visit instant. It is fetched again as a blob because an <img>
      // does not hand over its bytes — cheap, since the browser has it cached.
      onLoad={() => {
        if (stage !== "google") return;
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
