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
 * 2. Google's `thumbnailLink`. A few kilobytes — but served from another host,
 *    expiring after hours, and whether an `<img>` may load it is Google's call.
 * 3. The Drive API with our bearer token. Always works, at the price of the
 *    whole file, which is why it is last.
 *
 * Whatever ends up on screen from paths 2 and 3 is written back to the cache,
 * so the second visit to an album costs nothing.
 */

type Stage = "checking" | "thumb" | "downloading" | "blob" | "failed";

export function DriveImage({
  fileId,
  thumbnailLink,
  alt,
  className,
}: {
  fileId: string;
  thumbnailLink?: string;
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
      else setStage(thumbnailLink ? "thumb" : "downloading");
    })();

    return () => {
      cancelled = true;
    };
  }, [stage, fileId, thumbnailLink]);

  useEffect(() => {
    if (stage !== "downloading") return;

    const controller = new AbortController();

    (async () => {
      try {
        const blob = await downloadBlob(getToken, fileId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        show(blob);
        // Best effort: a failed write costs a re-download, not an error.
        void writeThumb(fileId, blob);
      } catch {
        if (!controller.signal.aborted) setStage("failed");
      }
    })();

    return () => controller.abort();
  }, [stage, fileId, getToken]);

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

  if (stage === "checking" || stage === "downloading") {
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
      onError={() => setStage(stage === "thumb" ? "downloading" : "failed")}
      // A thumbnail that loaded is worth keeping; caching it here is what makes
      // the next visit instant. It is fetched again as a blob because an <img>
      // does not hand over its bytes — cheap, since the browser has it cached.
      onLoad={() => {
        if (stage !== "thumb") return;
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
