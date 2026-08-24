"use client";

import { useEffect, useRef, useState } from "react";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { ROOT_FOLDER, type Place } from "@/lib/catalog";
import {
  applyLimits,
  formatDuration,
  quotaVerdict,
  totalBytes,
  type Quota,
  type Rejection,
} from "@/lib/limits";
import {
  formatBytes,
  parseDay,
  readSelection,
  withManualDate,
  withNeighbourDates,
  type MediaFile,
} from "@/lib/media";
import { readQuota } from "@/lib/google/drive";
import { clusterTrips, tripPath, undatedFor } from "@/lib/trips";
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
  onUploaded,
}: {
  place: Place;
  slug: string;
  /** Called once a batch put at least one new file in Drive. */
  onUploaded?: () => void;
}) {
  const { getToken, rootId } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  // The last progress seen, so the finished batch can be inspected without
  // waiting for a re-render to settle. It also carries across a retry: the
  // second attempt only reports on the files it took, and the rest of the
  // table would otherwise forget what it had already said about them.
  const lastProgress = useRef<Progress | null>(null);

  const [media, setMedia] = useState<MediaFile[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [tooBig, setTooBig] = useState<Rejection[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A yyyy-mm-dd typed in for the files that carry no date of their own.
  const [typed, setTyped] = useState("");

  // Read once on mount. A failure is not worth surfacing: the quota only
  // powers a warning, and losing it must not block an upload.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void readQuota(getToken, { signal: controller.signal })
      .then((found) => {
        if (!cancelled) setQuota(found);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;

    setReading(true);
    lastProgress.current = null;
    setMedia(null);
    setRejected([]);
    setProgress(null);
    setProblem(null);
    setTyped("");

    const result = await readSelection(files);
    const { accepted, rejected: overLimit } = applyLimits(result.media);

    setMedia(accepted);
    setRejected(result.rejected);
    setTooBig(overLimit);
    setReading(false);
  }

  function reset() {
    abort.current?.abort();
    lastProgress.current = null;
    setMedia(null);
    setRejected([]);
    setTooBig([]);
    setProgress(null);
    setProblem(null);
    setUploading(false);
    setTyped("");
    if (input.current) input.current.value = "";
  }

  /**
   * Uploads some of the selection, keeping what earlier attempts established.
   *
   * A retry re-clusters rather than being handed the original span: three
   * photos out of fifty draw a narrower trip on their own, but the folder the
   * other forty-seven made is within a fortnight of them, so it is found and
   * joined. That also keeps a two-trip selection from collapsing into a single
   * folder on the second attempt.
   */
  async function run(items: MediaFile[]) {
    if (items.length === 0) return;

    // Unreachable in practice — the uploader only renders once connected — but
    // the alternative to checking is uploading into an unknown folder.
    if (!rootId) {
      setProblem("Todavía no hay conexión con Drive. Espera un momento.");
      return;
    }

    const controller = new AbortController();
    abort.current = controller;

    const settled = new Map(lastProgress.current?.states ?? []);
    const knownFolder = lastProgress.current?.folder ?? null;

    setUploading(true);
    setProblem(null);

    try {
      await uploadBatch(getToken, {
        media: items,
        place,
        slug,
        rootId,
        signal: controller.signal,
        onProgress: (next) => {
          const merged: Progress = {
            folder: next.folder ?? knownFolder,
            states: new Map([...settled, ...next.states]),
          };
          lastProgress.current = merged;
          setProgress(merged);
        },
      });

      const added = items.some(
        (item) =>
          lastProgress.current?.states.get(itemKey(item))?.status === "done",
      );
      // Only when something actually landed: a batch of duplicates changes
      // nothing, and refetching an album for no reason is wasted work.
      if (added) onUploaded?.();
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "No se pudo subir el lote.",
      );
    } finally {
      setUploading(false);
      abort.current = null;
    }
  }

  // The same split the upload will perform, shown before it happens: the
  // folder a batch lands in is derived from its own dates, and this is the
  // cheap moment to catch that being wrong.
  // The selection as it will actually be filed: whatever each file said
  // about itself, plus a typed-in date for the ones that said nothing. The
  // preview, the folder names and the upload all read this, so none of them
  // can disagree with what is on screen.
  // Photos come off a camera in order, so a file that lost its date sits
  // between two that kept theirs. Borrowing from them rescues a batch of
  // forwarded photos without asking anything, and covers the common case: a
  // few files recopied last week among twenty left alone since the trip.
  const found = withNeighbourDates(media ?? []);

  // Only for whatever had no neighbour to borrow from — a batch copied all
  // at once has nothing to go on but the traveller.
  const typedDay = parseDay(typed);
  const items = typedDay ? withManualDate(found, typedDay) : found;

  const trips = clusterTrips(items);

  // Whatever the split could not place. Counted rather than listed: the table
  // below already names every file.
  const undated = undatedFor(items).length;
  const borrowed = items.filter((item) => item.dateSource === "nearby").length;
  const states = progress?.states;

  const counts = tally(states);
  const finished = progress !== null && !uploading;

  // Anything the run did not put in Drive: the outright failures, and whatever
  // a cancelled or broken batch never reached. Files already there are left
  // out, so a retry is never a second upload of the same bytes.
  const unfinished = finished ? items.filter(isUnfinished(states)) : [];

  const batchBytes = totalBytes(items);
  const verdict = quotaVerdict(quota, batchBytes);

  return (
    <>
      <SectionLabel>+</SectionLabel>

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
              {progress?.folder
                ? "Subiendo a"
                : trips.length === 1
                  ? "Irán a esta carpeta"
                  : `Se han detectado ${trips.length} viajes`}
            </p>

            {trips.length === 0 ? (
              <p className="break-all font-mono text-sm">
                {ROOT_FOLDER}/{place.country}/ — sin fechas, no se puede decidir
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {trips.map((trip) => (
                  <li key={trip.span.from.getTime()}>
                    <p className="break-all font-mono text-sm">
                      {[
                        ROOT_FOLDER,
                        ...tripPath(place.country, trip.span),
                      ].join("/")}
                      /
                    </p>
                    <p className="mt-0.5 text-[0.9rem] text-ink-soft tabular-nums">
                      {trip.span.from.toLocaleDateString("es")} →{" "}
                      {trip.span.to.toLocaleDateString("es")} ·{" "}
                      {trip.items.length}{" "}
                      {trip.items.length === 1 ? "fichero" : "ficheros"}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {borrowed > 0 && (
              <p className="mt-3 text-[0.9rem]">
                {borrowed}{" "}
                {borrowed === 1 ? "fichero no traía" : "ficheros no traían"}{" "}
                fecha propia y ha tomado la de las fotos de al lado. La del
                sistema se pone al día sola al copiar un fichero, así que no
                sirve; las vecinas de la misma tanda sí.
              </p>
            )}

            {undated > 0 && (
              <div className="mt-4 border-t border-teal/30 pt-3">
                <p className="text-[0.9rem]">
                  {undated} {undated === 1 ? "fichero" : "ficheros"} sin fecha,
                  y sin ninguna foto cerca de la que sacarla.
                </p>
                <label className="mt-2 flex flex-wrap items-baseline gap-2 text-[0.9rem]">
                  <span>Si sabes de cuándo son:</span>
                  <input
                    type="date"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    disabled={uploading || progress !== null}
                    className="border border-rule bg-surface px-2 py-1 font-mono text-sm tabular-nums disabled:opacity-60"
                  />
                </label>
                <p className="mt-1 text-[0.85rem] text-ink-soft">
                  Solo se aplica a esos. Las que traen fecha de cámara no se
                  tocan.
                </p>
              </div>
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

          {verdict.message && !progress && (
            <p
              role={verdict.kind === "full" ? "alert" : "status"}
              className={
                verdict.kind === "full"
                  ? "mb-4 border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
                  : "mb-4 border-l-[3px] border-teal bg-teal-bg px-4 py-3 text-[0.95rem]"
              }
            >
              {verdict.message}
            </p>
          )}

          <div className="mb-4 flex flex-wrap items-baseline gap-4">
            {!progress && (
              <button
                type="button"
                onClick={() => void run(items)}
                disabled={
                  trips.length === 0 || uploading || verdict.kind === "full"
                }
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

            {unfinished.length > 0 && (
              <button
                type="button"
                onClick={() => void run(unfinished)}
                className="t-display cursor-pointer rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90"
              >
                Reintentar {unfinished.length}{" "}
                {unfinished.length === 1 ? "fichero" : "ficheros"}
              </button>
            )}

            {finished && (
              <button
                type="button"
                onClick={reset}
                className={
                  unfinished.length > 0
                    ? "t-label cursor-pointer text-ink-soft hover:text-accent hover:underline"
                    : "t-display cursor-pointer rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90"
                }
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
                <span className="text-ink-soft">Quedan {counts.left}.</span>
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
                {items.map((item) => (
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

      {tooBig.length > 0 && (
        <div className="mt-6 border-l-[3px] border-accent bg-accent-bg px-4 py-3">
          <p className="t-label mb-2 text-accent">
            {tooBig.length} sin subir por tamaño
          </p>
          <ul className="flex flex-col gap-1 text-[0.9rem]">
            {tooBig.map((item) => (
              <li key={item.key}>
                <span className="break-all font-mono text-xs">{item.name}</span>{" "}
                — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected.length > 0 && (
        <p className="mt-4 text-[0.9rem] text-ink-soft">
          Descartados por no ser foto ni vídeo: {rejected.join(", ")}.
        </p>
      )}
    </>
  );
}

/**
 * Whether a file still has to be uploaded, given what the last run said.
 *
 * A file with no state at all counts: that is a batch that threw before it
 * reached the loop, which leaves the whole selection untouched in Drive.
 */
function isUnfinished(states: Map<string, ItemState> | undefined) {
  return (item: MediaFile) => {
    const state = states?.get(itemKey(item));
    if (!state) return true;
    return state.status !== "done" && state.status !== "duplicate";
  };
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
            {item.kind === "video"
              ? item.durationSeconds !== null
                ? formatDuration(item.durationSeconds)
                : "vídeo"
              : "foto"}
          </span>
        </td>
        <td className="py-2 pr-4 tabular-nums">
          {item.takenAt ? (
            <>
              {item.takenAt.toLocaleDateString("es")}
              {item.dateSource === "name" && (
                <span className="t-label ml-2 text-ink-soft">del nombre</span>
              )}
              {item.dateSource === "file" && (
                <span className="t-label ml-2 text-accent">del fichero</span>
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
            <span className="font-sans text-ink-soft">del lugar</span>
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
