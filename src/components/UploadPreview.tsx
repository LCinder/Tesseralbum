"use client";

import { useRef, useState } from "react";
import { SectionLabel } from "@/components/Shell";
import { ROOT_FOLDER, type Place } from "@/lib/catalog";
import { formatBytes, readSelection, type MediaFile } from "@/lib/media";
import { monthLabel, spanOf, tripPath, yearLabel } from "@/lib/trips";

/**
 * Phase 2, first slice: read the selection and show what was understood.
 *
 * Nothing is uploaded. The point is to check the date logic against real
 * photos before a single byte moves — a wrong folder is cheap to fix here and
 * expensive once a holiday is filed under it.
 */
export function UploadPreview({ place }: { place: Place }) {
  const input = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<MediaFile[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [reading, setReading] = useState(false);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;

    setReading(true);
    setMedia(null);
    setRejected([]);

    const result = await readSelection(files);

    setMedia(result.media);
    setRejected(result.rejected);
    setReading(false);
  }

  function clear() {
    setMedia(null);
    setRejected([]);
    if (input.current) input.current.value = "";
  }

  const dated = media?.map((item) => item.takenAt) ?? [];
  const span = spanOf(dated);
  const withoutDate = media?.filter((item) => !item.takenAt).length ?? 0;
  const withoutGeo = media?.filter((item) => item.geoSource === "none").length ?? 0;

  return (
    <>
      <SectionLabel>Subir fotos</SectionLabel>

      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={onPick}
        className="mb-2 block w-full cursor-pointer border border-rule bg-surface px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-accent file:px-3 file:py-1.5 file:font-semibold file:text-accent-ink"
      />

      <p className="mb-8 text-[0.9rem] text-ink-soft">
        Todavía no se sube nada. Esta pantalla lee las fotos en tu navegador y
        te dice qué ha entendido y dónde irían.
      </p>

      {reading && (
        <p className="t-label text-ink-soft" role="status">
          Leyendo…
        </p>
      )}

      {media && media.length > 0 && (
        <>
          <div className="mb-8 border-l-[3px] border-teal bg-teal-bg px-4 py-4">
            <p className="t-label mb-2 text-teal">Irían a esta carpeta</p>
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
          </div>

          <SectionLabel>
            {media.length} {media.length === 1 ? "fichero" : "ficheros"}
          </SectionLabel>

          {(withoutDate > 0 || withoutGeo > 0) && (
            <p className="mb-4 text-[0.9rem] text-ink-soft">
              {withoutDate > 0 && (
                <>
                  {withoutDate} sin fecha aprovechable.{" "}
                </>
              )}
              {withoutGeo > 0 && (
                <>
                  {withoutGeo} sin coordenadas — usarán las de {place.city}.
                </>
              )}
            </p>
          )}

          <div className="mb-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Fichero</Th>
                  <Th>Fecha</Th>
                  <Th>Ubicación</Th>
                  <Th>Tamaño</Th>
                </tr>
              </thead>
              <tbody>
                {media.map((item) => (
                  <Row key={`${item.file.name}-${item.file.size}`} item={item} />
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={clear}
            className="t-label cursor-pointer text-ink-soft hover:text-accent hover:underline"
          >
            Limpiar la selección
          </button>
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

function Row({ item }: { item: MediaFile }) {
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
              <Source value={item.dateSource} />
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
        <td className="py-2 tabular-nums">{formatBytes(item.file.size)}</td>
      </tr>
      {item.warning && (
        <tr className="border-b border-rule">
          <td colSpan={4} className="pb-2 text-[0.85rem] text-ink-soft">
            {item.warning}
          </td>
        </tr>
      )}
    </>
  );
}

/** Marks a value taken from a weaker source than the EXIF. */
function Source({ value }: { value: "exif" | "file" | "none" }) {
  if (value !== "file") return null;
  return <span className="t-label ml-2 text-ink-soft">del fichero</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="t-label border-b border-ink pb-2 pr-4 text-left text-ink-soft">
      {children}
    </th>
  );
}
