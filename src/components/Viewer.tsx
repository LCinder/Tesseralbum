/* eslint-disable @next/next/no-img-element -- next/image cannot take a blob:
   URL, which is the only form a private Drive file has here. */
"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { downloadBlob } from "@/lib/google/drive";
import { isDisplayable, isVideo, type Shot } from "@/lib/gallery";
import { formatBytes } from "@/lib/media";

/**
 * One photo or video, full size, over the album.
 *
 * This is also the only place a video can be watched: everywhere else renders
 * an `<img>`, which shows a clip's poster frame at best. Playback needs a real
 * `<video>` element and the file's own bytes.
 *
 * Those bytes are downloaded whole rather than streamed. Drive's API host does
 * not take a token on a media URL in a way an element can follow, so a range
 * request is not available to us — the reason clips are capped at 200 MB in
 * the first place.
 */
export function Viewer({
  shots,
  index,
  onClose,
  onMove,
}: {
  shots: Shot[];
  index: number;
  onClose: () => void;
  onMove: (next: number) => void;
}) {
  const shot = shots[index];

  // Keyboard first: a full-screen overlay you cannot leave with Escape is a
  // trap, and arrows are how anyone expects to move through photos.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onMove(index - 1);
      if (event.key === "ArrowRight" && index < shots.length - 1) {
        onMove(index + 1);
      }
    };

    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [index, shots.length, onClose, onMove]);

  if (!shot) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shot.name}
      className="fixed inset-0 z-50 flex flex-col bg-paper"
    >
      <header className="flex shrink-0 items-baseline justify-between gap-4 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-ink-soft">
            {shot.name}
          </p>
          <p className="t-label text-ink-soft tabular-nums">
            {index + 1} de {shots.length}
            {shot.takenAt && ` · ${shot.takenAt.toLocaleDateString("es")}`}
            {shot.bytes !== null && ` · ${formatBytes(shot.bytes)}`}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="t-label shrink-0 cursor-pointer text-accent hover:underline"
        >
          Cerrar ✕
        </button>
      </header>

      <div className="relative flex min-h-0 grow items-center justify-center bg-surface-2 p-2">
        <Content key={shot.id} shot={shot} />

        {index > 0 && (
          <Arrow side="left" onClick={() => onMove(index - 1)} />
        )}
        {index < shots.length - 1 && (
          <Arrow side="right" onClick={() => onMove(index + 1)} />
        )}
      </div>

      {shot.lat !== null && shot.lng !== null && (
        <footer className="shrink-0 border-t border-rule px-4 py-2">
          <p className="font-mono text-xs text-ink-soft tabular-nums">
            {shot.lat.toFixed(4)}, {shot.lng.toFixed(4)}
            {shot.geoSource !== "exif" && " · aproximado, del lugar"}
          </p>
        </footer>
      )}
    </div>
  );
}

/**
 * The media itself.
 *
 * Remounted per shot via a key, so switching photos starts clean without an
 * effect having to reset anything.
 */
function Content({ shot }: { shot: Shot }) {
  const { getToken } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const created = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (created.current) URL.revokeObjectURL(created.current);
    };
  }, []);

  useEffect(() => {
    if (!isDisplayable(shot)) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const blob = await downloadBlob(getToken, shot.id, {
          signal: controller.signal,
        });
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        created.current = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setProblem("No se pudo cargar el archivo.");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [shot, getToken]);

  if (!isDisplayable(shot)) {
    return (
      <p className="max-w-sm text-center text-ink-soft">
        Es un HEIC. Se guardó bien en tu Drive, pero el navegador no sabe
        decodificarlo. Ábrelo desde Drive, o cambia el formato de la cámara a
        «Más compatible».
      </p>
    );
  }

  if (problem) {
    return (
      <p role="alert" className="text-accent">
        {problem}
      </p>
    );
  }

  if (!url) {
    return (
      <p className="t-label text-ink-soft" role="status">
        {isVideo(shot) ? "Descargando el vídeo…" : "Cargando…"}
      </p>
    );
  }

  if (isVideo(shot)) {
    return (
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="max-h-full max-w-full"
      />
    );
  }

  return (
    <img
      src={url}
      alt={shot.name}
      className="max-h-full max-w-full object-contain"
    />
  );
}

function Arrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Anterior" : "Siguiente"}
      className={`absolute top-1/2 -translate-y-1/2 cursor-pointer bg-paper/85 px-3 py-6 text-xl text-ink transition-opacity hover:opacity-80 ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
