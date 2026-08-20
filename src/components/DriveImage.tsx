/* eslint-disable @next/next/no-img-element -- next/image cannot proxy a Drive
   URL that needs our bearer token, nor a blob: URL. This component exists
   precisely to do what next/image cannot. */
"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { downloadBlob } from "@/lib/google/drive";

/**
 * Shows a private Drive image, with a fast path and a guaranteed fallback.
 *
 * Google generates a thumbnail for every file and hands us a `thumbnailLink`.
 * Using it costs nothing and transfers a few kilobytes — but it is served from
 * a different host, it expires after a few hours, and whether an `<img>` may
 * load it is Google's call, not ours.
 *
 * So: try the link, and when it fails, download the file through the Drive API
 * with our bearer token and show it from a blob. That always works, at the
 * price of the whole file, which is why it is second.
 */

type Stage = "thumb" | "downloading" | "blob" | "failed";

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
  const [stage, setStage] = useState<Stage>(thumbnailLink ? "thumb" : "downloading");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Revoking on unmount matters in a grid: a hundred un-revoked object URLs
  // pin a hundred full-size images in memory for the life of the tab.
  const created = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (created.current) URL.revokeObjectURL(created.current);
    };
  }, []);

  useEffect(() => {
    if (stage !== "downloading") return;

    const controller = new AbortController();

    (async () => {
      try {
        const blob = await downloadBlob(getToken, fileId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const url = URL.createObjectURL(blob);
        created.current = url;
        setBlobUrl(url);
        setStage("blob");
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

  if (stage === "downloading") {
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
      onError={() => {
        if (stage === "thumb") setStage("downloading");
        else setStage("failed");
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
