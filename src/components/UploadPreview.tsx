"use client";

import { useRef, useState } from "react";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { ROOT_FOLDER, type Place } from "@/lib/catalog";
import { formatBytes, readSelection, type MediaFile } from "@/lib/media";
import { monthLabel, spanOf, tripPath, yearLabel } from "@/lib/trips";
import {
  itemKey,
  uploadBatch,
  type ItemState,
  type Progress,
} from "@/lib/upload";

/**
 * Choosing files, seeing what was understood, and uploading them.
 *
 * The preview is not decoration: the folder a batch lands in is derived from
 * its own dates, so showing that decision before it is acted on is the only
 * cheap moment to catch it being wrong.
 */
export function UploadPreview({
  place,
  slug,
}: {
  place: Place;
  slug: string;
}) {
  const { getToken } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const [media, setMedia] = useState<MediaFile[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;

    setReading(true);
    setMedia(null);
    setRejected([]);
    setProgress(null);
    setProblem(null);

    const result = await readSelection(files);

    setMedia(result.media);
    setRejected(result.rejected);
    setReading(false);
  }

  function reset() {
    abort.current?.abort();
    setMedia(null);
    setRejected([]);
    setProgress(null);
    setProblem(null);
    setUploading(false);
    if (input.current) input.current.value = "";
  }

  async function start() {
    if (!media || media.length === 0) return;

    const controller = new AbortController();
    abort.current = controller;

    setUploading(true);
    setProblem(null);

    try {
      await uploadBatch(getToken, {
        media,
        place,
        slug,
        signal: controller.signal,
        onProgress: setProgress,
      });
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "No se pudo subir el lote.",
      );
    } finally {
      setUploading(false);
      abort.current = null;
    }
  }

  const span = spanOf(media?.map((item) => item.takenAt) ?? []);
  const states = progress?.states;

  const counts = tally(states);
  const finished = progress !== null && !uploading;

  return (
    <>
      <SectionLabel>Subir fotos</SectionLabel>

      {!progress && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={onPick}
            disabled={reading}
            className="mb-2 block w-full cursor-pointer border border-rule bg-surface px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-accent file:px-3 file:py-1.5 file:font-semibold file:text-accent-ink"
          />
          <p className="mb-8 text-[0.9rem] text-ink-soft">
            Los ficheros van del navegador a tu Drive directamente. No pasan por
            ningún servidor nuestro.
          </p>
        </>
      )}

      {reading && (
        <p className="t-label text-ink-soft" role="status">
          Leyendo…
        </p>
      )}

      {media && media.length > 0 && (
        <>
          <div className="mb-8 border-l-[3px] border-teal bg-teal-bg px-4 py-4">
            <p className="t-label mb-2 text-teal">
              {progress?.folder ? "Subiendo a" : "Irán a esta carpeta"}
            </p>
            <p className="mb-3 break-all font-mono text-sm">
              {span
                ? [ROOT_FOLDER, ...tripPath(place.country, span)].join("/") + "/"
                : `${ROOT_FOLDER}/${place.country}/ — sin fechas, no se puede decidir`}
            </p>

            {span && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.9rem]">
                <dt className="text-ink-soft">Viaje</dt>
                <dd className="tabular-nums">
                  {span.from.toLocaleDateString("es")} →{" "}
                  {span.to.toLocaleDateString("es")}
                </dd>
                <dt className="text-ink-soft">Año</dt>
                <dd className="tabular-nums">{yearLabel(span)}</dd>
                <dt className="text-ink-soft">Meses</dt>
                <dd>{monthLabel(span)}</dd>
              </dl>
            )}

            {progress?.folder?.renamedFrom && (
              <p className="mt-3 text-[0.9rem]">
                Este lote alarga un viaje que ya estaba subido: la carpeta{" "}
                <strong>{progress.folder.renamedFrom}</strong> pasa a llamarse{" "}
                <strong>{progress.folder.name}</strong>.
              </p>
            )}
            {progress?.folder?.reused && !progress.folder.renamedFrom && (
              <p className="mt-3 text-[0.9rem]">
                Se añaden a un viaje que ya existía.
              </p>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-baseline gap-4">
            {!progress && (
              <button
                type="button"
                onClick={start}
                disabled={!span || uploading}
                className="t-display cursor-pointer rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Subir {media.length}{" "}
                {media.length === 1 ? "fichero" : "ficheros"}
              </button>
            )}

            {uploading && (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="t-label cursor-pointer text-accent hover:underline"
              >
                Cancelar
              </button>
            )}

            {finished && (
              <button
                type="button"
                onClick={reset}
                className="t-display cursor-pointer rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90"
              >
                Subir más
              </button>
            )}

            {!progress && !uploading && (
              <button
                type="button"
                onClick={reset}
                className="t-label cursor-pointer text-ink-soft hover:text-accent hover:underline"
              >
                Limpiar
              </button>
            )}
          </div>

          {counts && (
            <p className="mb-4 text-[0.95rem]">
              {counts.done > 0 && <strong>{counts.done} subidas. </strong>}
              {counts.duplicate > 0 && (
                <>{counts.duplicate} ya estaban, no se han vuelto a subir. </>
              )}
              {counts.failed > 0 && (
                <span className="text-accent">{counts.failed} fallaron. </span>
              )}
              {uploading && counts.left > 0 && (
                <span className="text-ink-soft">
                  Quedan {counts.left}.
                </span>
              )}
            </p>
          )}

          {problem && (
            <p
              role="alert"
              className="mb-4 border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
            >
              {problem}
            </p>
          )}

          <div className="mb-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Fichero</Th>
                  <Th>Fecha</Th>
                  <Th>Ubicación</Th>
                  <Th>{states ? "Estado" : "Tamaño"}</Th>
                </tr>
              </thead>
              <tbody>
                {media.map((item) => (
                  <Row
                    key={itemKey(item)}
                    item={item}
                    state={states?.get(itemKey(item))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {media && media.length === 0 && !reading && (
        <p className="text-ink-soft">
          Ninguno de los ficheros elegidos es una foto o un vídeo.
        </p>
      )}

      {rejected.length > 0 && (
        <p className="mt-4 text-[0.9rem] text-ink-soft">
          Descartados por no ser foto ni vídeo: {rejected.join(", ")}.
        </p>
      )}
    </>
  );
}

function tally(states: Map<string, ItemState> | undefined) {
  if (!states) return null;

  let done = 0;
  let duplicate = 0;
  let failed = 0;
  let left = 0;

  for (const state of states.values()) {
    if (state.status === "done") done += 1;
    else if (state.status === "duplicate") duplicate += 1;
    else if (state.status === "failed") failed += 1;
    else left += 1;
  }

  return { done, duplicate, failed, left };
}

function Row({ item, state }: { item: MediaFile; state?: ItemState }) {
  return (
    <>
      <tr className="border-b border-rule align-top">
        <td className="py-2 pr-4">
          <span className="break-all">{item.file.name}</span>
          <span className="t-label ml-2 text-ink-soft">
            {item.kind === "video" ? "vídeo" : "foto"}
          </span>
        </td>
        <td className="py-2 pr-4 tabular-nums">
          {item.takenAt ? (
            <>
              {item.takenAt.toLocaleDateString("es")}
              {item.dateSource === "file" && (
                <span className="t-label ml-2 text-ink-soft">del fichero</span>
              )}
            </>
          ) : (
            <span className="text-ink-soft">—</span>
          )}
        </td>
        <td className="py-2 pr-4 font-mono text-xs tabular-nums">
          {item.lat !== null && item.lng !== null ? (
            `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`
          ) : (
            <span className="font-sans text-ink-soft">del souvenir</span>
          )}
        </td>
        <td className="py-2 tabular-nums">
          {state ? (
            <Status state={state} size={item.file.size} />
          ) : (
            formatBytes(item.file.size)
          )}
        </td>
      </tr>
      {item.warning && (
        <tr className="border-b border-rule">
          <td colSpan={4} className="pb-2 text-[0.85rem] text-ink-soft">
            {item.warning}
          </td>
        </tr>
      )}
      {state?.status === "failed" && (
        <tr className="border-b border-rule">
          <td colSpan={4} className="pb-2 text-[0.85rem] text-accent">
            {state.reason}
          </td>
        </tr>
      )}
    </>
  );
}

function Status({ state, size }: { state: ItemState; size: number }) {
  switch (state.status) {
    case "pending":
      return <span className="t-label text-ink-soft">En cola</span>;
    case "hashing":
      return <span className="t-label text-ink-soft">Comprobando</span>;
    case "duplicate":
      return <span className="t-label text-teal">Ya estaba</span>;
    case "uploading": {
      const percent = size === 0 ? 100 : Math.round((state.sent / size) * 100);
      return <span className="t-label text-accent">{percent}%</span>;
    }
    case "done":
      return <span className="t-label text-teal">Subida</span>;
    case "failed":
      return <span className="t-label text-accent">Falló</span>;
  }
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="t-label border-b border-ink pb-2 pr-4 text-left text-ink-soft">
      {children}
    </th>
  );
}
