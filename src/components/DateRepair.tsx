"use client";

import { useState } from "react";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { parseDay } from "@/lib/media";
import {
  applyFixes,
  planTripDate,
  setTripDate,
  surveyTrips,
  type Checked,
  type Survey,
  type Unverifiable,
} from "@/lib/repair";

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
  const [note, setNote] = useState<string | null>(null);

  async function look() {
    setLooking(true);
    setProblem(null);
    setFixed(null);
    setNote(null);
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
        Las carpetas subidas antes de que la app supiera leer bien las fechas
        pueden llevar un nombre imposible, tipo{" "}
        <span className="font-mono">Noviembre-Agosto</span>. Esto recalcula el
        nombre de cada viaje leyendo sus fotos igual que el álbum: la fecha de
        la cámara, la del nombre del fichero, y para las que no tengan ninguna,
        la de las fotos de al lado. No mueve ni borra nada: solo renombra
        carpetas.
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

      {note && (
        <p
          role="status"
          className="mt-4 border-l-[3px] border-teal bg-teal-bg px-4 py-3 text-[0.95rem]"
        >
          {note}
        </p>
      )}

      {survey && (
        <Plan
          survey={survey}
          onDone={(note) => {
            setSurvey(null);
            setNote(note);
          }}
        />
      )}

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
function Plan({
  survey,
  onDone,
}: {
  survey: Survey;
  onDone: (note: string) => void;
}) {
  const { fixes, examined, mixed, unverifiable, undatable } = survey;

  if (examined === 0) {
    return (
      <p className="mt-4 text-[0.95rem]">
        Todavía no hay ningún viaje en Drive.
      </p>
    );
  }

  return (
    <div className="mt-4 border-l-[3px] border-teal bg-teal-bg px-4 py-4">
      <p className="t-label mb-3 text-teal">{headline(survey)}</p>

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

      {unverifiable.length > 0 && (
        <div className="mt-4">
          <p className="t-label mb-1 text-teal">Esto lo tienes que decir tú</p>
          <p className="mb-2 text-[0.9rem]">
            {unverifiable.length === 1
              ? "Este viaje no tiene"
              : "Estos viajes no tienen"}{" "}
            ni una sola fecha aprovechable: ninguna foto trae la de la cámara, y
            las del fichero son todas del mismo día, así que tampoco hay una
            vecina de la que sacarla. Esto solo pasa si copiaste la tanda entera
            de golpe.
          </p>
          <ul className="flex flex-col gap-4">
            {unverifiable.map((trip) => (
              <TripDate key={trip.folderId} trip={trip} onDone={onDone} />
            ))}
          </ul>
        </div>
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

      <Detail checked={survey.checked} />

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

/**
 * One trip nobody can date automatically, and the field that dates it.
 *
 * The cost is spelled out on the button rather than after the fact: this writes
 * to every photo in the trip, which is thirty requests where the rest of this
 * panel spends one, and that is worth knowing before pressing it.
 */
function TripDate({
  trip,
  onDone,
}: {
  trip: Unverifiable;
  onDone: (note: string) => void;
}) {
  const { getToken } = useSession();

  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);

  const when = parseDay(typed);
  const plan = when ? planTripDate(trip, when) : null;
  const photos = trip.photoIds.length;

  async function save() {
    if (!when || !plan) return;

    setBusy({ done: 0, total: photos + 1 });
    setProblem(null);
    try {
      await setTripDate(getToken, trip, when, {
        onProgress: (done, total) => setBusy({ done, total }),
      });
      onDone(
        `${photos} ${photos === 1 ? "foto fechada" : "fotos fechadas"}, y la carpeta pasa a llamarse ${plan.rename}.`,
      );
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "No se pudo guardar la fecha.",
      );
      setBusy(null);
    }
  }

  return (
    <li>
      <p className="break-all font-mono text-sm">
        {trip.year}/{trip.name}
        <span className="ml-2 font-sans text-ink-soft">
          {photos} {photos === 1 ? "foto" : "fotos"}
        </span>
      </p>

      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <input
          type="date"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={busy !== null}
          className="border border-rule bg-surface px-2 py-1 font-mono text-sm tabular-nums disabled:opacity-60"
        />
        {plan && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null}
            className="t-label cursor-pointer font-semibold text-accent hover:underline disabled:cursor-wait disabled:opacity-60"
          >
            {busy
              ? `Guardando ${busy.done}/${busy.total}…`
              : `Fechar ${photos} ${photos === 1 ? "foto" : "fotos"} y renombrar a ${plan.rename}`}
          </button>
        )}
      </div>

      {plan && (
        <p className="mt-1 text-[0.85rem] text-ink-soft">
          Se escribe en cada foto, no solo en la carpeta: son {photos + 1}{" "}
          llamadas a Drive. El álbum y el mapa leen la foto, así que arreglar
          solo la carpeta no cambiaría nada de lo que se ve.
        </p>
      )}

      {plan?.wrongYear && (
        <p className="mt-1 text-[0.9rem]">
          Está guardado en {plan.wrongYear.holding} y por esa fecha le toca{" "}
          {plan.wrongYear.wanted}. Se le arregla el nombre, pero moverlo de
          carpeta tendrás que hacerlo desde Drive.
        </p>
      )}

      {problem && (
        <p role="alert" className="mt-1 text-sm text-accent">
          {problem}
        </p>
      )}
    </li>
  );
}

/** What the survey found, said without rounding it up to "todo correcto". */
function headline({
  fixes,
  examined,
  mixed,
  unverifiable,
  undatable,
}: Survey): string {
  const trips = examined === 1 ? "viaje" : "viajes";

  if (fixes.length > 0) {
    return `${fixes.length} de ${examined} ${trips} con las fechas mal`;
  }

  // Nothing to rewrite is not the same as nothing wrong: a trip nobody can
  // date, or one holding two journeys, is reported below, and saying
  // "todo correcto" over the top of it was simply untrue.
  // `undatable` belongs in this count too. Leaving it out is what let a
  // folder whose photos were never found report itself as "todo correcto".
  const stuck = mixed.length + unverifiable.length + undatable;
  if (stuck > 0) {
    return `${examined} ${trips} revisados · ${stuck} que no puedo arreglar solo`;
  }

  if (examined === 0) return `Ninguna carpeta de viaje en Drive`;

  return `${examined} ${examined === 1 ? "viaje revisado" : "viajes revisados"} · todo correcto`;
}

const SOURCE_NAMES: Record<string, string> = {
  exif: "de la cámara",
  name: "del nombre",
  nearby: "de las vecinas",
  manual: "puestas a mano",
  file: "del fichero",
  none: "sin fecha",
};

/**
 * Every folder examined, with the dates it was judged on.
 *
 * Here because "todo correcto" is not a claim anyone can check from the
 * outside. When the verdict is wrong — and it has been — this is what shows
 * whether the photos were even found, and where each of their dates came from.
 */
function Detail({ checked }: { checked: Checked[] }) {
  const [open, setOpen] = useState(false);

  if (checked.length === 0) return null;

  return (
    <div className="mt-4 border-t border-teal/30 pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="t-label cursor-pointer text-ink-soft hover:text-accent hover:underline"
      >
        {open ? "Ocultar" : "Ver"} lo que ha leído de cada carpeta
      </button>

      {open && (
        <ul className="mt-2 flex flex-col gap-3">
          {checked.map((one) => (
            <li key={one.folderId} className="text-[0.9rem]">
              <p className="break-all font-mono text-sm">
                {one.year}/{one.name}
                <span className="ml-2 font-sans text-ink-soft">
                  {one.verdict}
                </span>
              </p>
              <p className="text-ink-soft tabular-nums">
                dice: {one.stored.from.toLocaleDateString("es")} →{" "}
                {one.stored.to.toLocaleDateString("es")}
              </p>
              <p className="text-ink-soft tabular-nums">
                sus {one.photos} {one.photos === 1 ? "foto" : "fotos"} dicen:{" "}
                {one.found
                  ? `${one.found.from.toLocaleDateString("es")} → ${one.found.to.toLocaleDateString("es")}`
                  : "ninguna fecha"}
              </p>
              <p className="text-ink-soft">
                {Object.entries(one.sources).length === 0
                  ? "no se ha encontrado ninguna foto dentro"
                  : Object.entries(one.sources)
                      .map(
                        ([source, count]) =>
                          `${count} ${SOURCE_NAMES[source] ?? source}`,
                      )
                      .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
