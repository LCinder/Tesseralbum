"use client";

import { useState } from "react";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { applyFixes, surveyTrips, type Survey } from "@/lib/repair";

/**
 * Repairing trip folders named before the dates were understood.
 *
 * Two steps on purpose. The first only reads, and shows every folder it would
 * touch with the name it would end up with; the second writes. Renaming folders
 * in someone's Drive is not something to do behind a single click, and the plan
 * is also the explanation — it says which trips were misdated without needing a
 * paragraph about why.
 */
export function DateRepair() {
  const { getToken } = useSession();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [looking, setLooking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fixed, setFixed] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function look() {
    setLooking(true);
    setProblem(null);
    setFixed(null);
    try {
      setSurvey(await surveyTrips(getToken));
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "No se pudo leer el archivo.",
      );
    } finally {
      setLooking(false);
    }
  }

  async function apply() {
    if (!survey) return;

    setApplying(true);
    setProblem(null);
    try {
      const done = await applyFixes(getToken, survey.fixes);
      setFixed(done);
      setSurvey(null);
    } catch (cause) {
      setProblem(
        cause instanceof Error
          ? cause.message
          : "No se pudieron corregir las carpetas.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <SectionLabel>Fechas</SectionLabel>

      <p className="mb-4 max-w-xl text-[0.95rem] text-ink-soft">
        Las carpetas subidas antes de que la app distinguiera la fecha de la
        cámara de la del sistema pueden llevar un nombre imposible, tipo{" "}
        <span className="font-mono">Noviembre-Agosto</span>. Esto recalcula las
        fechas de cada viaje a partir de las fotos que tiene dentro. No mueve ni
        borra nada: solo renombra carpetas.
      </p>

      {!survey && (
        <button
          type="button"
          onClick={() => void look()}
          disabled={looking || applying}
          className="t-label cursor-pointer border border-rule px-4 py-2 font-semibold transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
        >
          {looking ? "Revisando…" : "Revisar fechas"}
        </button>
      )}

      {fixed !== null && (
        <p
          role="status"
          className="mt-4 border-l-[3px] border-teal bg-teal-bg px-4 py-3 text-[0.95rem]"
        >
          {fixed === 0
            ? "No había nada que cambiar."
            : `${fixed} ${fixed === 1 ? "carpeta corregida" : "carpetas corregidas"}. Los álbumes ya muestran las fechas buenas.`}
        </p>
      )}

      {survey && <Plan survey={survey} />}

      {survey && (
        <div className="mt-5 flex flex-wrap items-baseline gap-5">
          {survey.fixes.length > 0 && (
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying}
              className="t-display cursor-pointer rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {applying
                ? "Corrigiendo…"
                : `Corregir ${survey.fixes.length} ${survey.fixes.length === 1 ? "carpeta" : "carpetas"}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSurvey(null)}
            disabled={applying}
            className="t-label cursor-pointer text-ink-soft hover:underline disabled:opacity-60"
          >
            {survey.fixes.length > 0 ? "Cancelar" : "Cerrar"}
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-4 text-sm text-accent">
          {problem}
        </p>
      )}
    </>
  );
}

/** What the survey found, before anything is written. */
function Plan({ survey }: { survey: Survey }) {
  const { fixes, examined, mixed, undatable } = survey;

  if (examined === 0) {
    return (
      <p className="mt-4 text-[0.95rem]">
        Todavía no hay ningún viaje en Drive.
      </p>
    );
  }

  return (
    <div className="mt-4 border-l-[3px] border-teal bg-teal-bg px-4 py-4">
      <p className="t-label mb-3 text-teal">
        {fixes.length === 0
          ? `${examined} ${examined === 1 ? "viaje revisado" : "viajes revisados"} · todo correcto`
          : `${fixes.length} de ${examined} ${examined === 1 ? "viaje" : "viajes"} con las fechas mal`}
      </p>

      {fixes.length > 0 && (
        <ul className="flex flex-col gap-3">
          {fixes.map((fix) => (
            <li key={fix.folderId}>
              <p className="break-all font-mono text-sm">
                {fix.rename === fix.name ? (
                  <>{fix.name}</>
                ) : (
                  <>
                    <span className="text-ink-soft line-through">
                      {fix.name}
                    </span>{" "}
                    → <strong>{fix.rename}</strong>
                  </>
                )}
              </p>
              <p className="mt-0.5 text-[0.9rem] text-ink-soft tabular-nums">
                {fix.span.from.toLocaleDateString("es")} →{" "}
                {fix.span.to.toLocaleDateString("es")} · {fix.photos}{" "}
                {fix.photos === 1 ? "foto" : "fotos"}
              </p>
              {fix.rename === fix.name && (
                <p className="mt-0.5 text-[0.9rem] text-ink-soft">
                  El nombre ya era correcto; se corrigen las fechas que lleva
                  guardadas, que es lo que decide si la próxima subida se une a
                  este viaje.
                </p>
              )}
              {fix.wrongYear && (
                <p className="mt-0.5 text-[0.9rem]">
                  Está guardado en {fix.wrongYear.holding} y por fechas le toca{" "}
                  {fix.wrongYear.wanted}. Se le arregla el nombre, pero moverlo
                  de carpeta tendrás que hacerlo tú desde Drive.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {mixed.length > 0 && (
        <div className="mt-4">
          <p className="text-[0.9rem]">
            {mixed.length === 1
              ? "Una carpeta tiene"
              : `${mixed.length} carpetas tienen`}{" "}
            más de un viaje dentro, de cuando un lote no se partía por sus
            huecos. Renombrarlas no los separa, así que no las toco — para
            partirlas hay que mover fotos, y eso no lo hace este botón.
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {mixed.map((folder) => (
              <li
                key={`${folder.year}/${folder.name}`}
                className="font-mono text-sm text-ink-soft"
              >
                {folder.year}/{folder.name} · {folder.trips} viajes
              </li>
            ))}
          </ul>
        </div>
      )}

      {undatable > 0 && (
        <p className="mt-4 text-[0.9rem]">
          {undatable === 1
            ? "Un viaje no tiene"
            : `${undatable} viajes no tienen`}{" "}
          ninguna foto con fecha de cámara, así que no hay nada mejor con lo que
          corregirlos.
        </p>
      )}
    </div>
  );
}
