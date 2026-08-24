"use client";

import { useEffect, useRef, useState } from "react";
import { placeUrl, siteUrl } from "@/lib/env";
import {
  SMALLEST_TAG_BYTES,
  chipBytes,
  chipTarget,
  nfcProblem,
  writeChipUrl,
} from "@/lib/nfc";

/** Long enough to fish the sticker out of a drawer, short enough to give up. */
const GIVE_UP_MS = 60_000;

type State =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

/**
 * Writes a place's URL onto an NFC sticker.
 *
 * Whether the browser can do this is decided in the click handler rather than
 * at render. Reading `window` while rendering would disagree with the
 * prerendered HTML, and the alternative — hiding the button on iPhone — trades
 * an explanation for a mystery. A button that says why it cannot help is worth
 * more than one that is not there.
 */
export function ChipWriter({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  // Cleanup only, so nothing is set from an effect: a sticker must not still be
  // being waited for after the row it belongs to has gone.
  useEffect(() => () => abort.current?.abort(), []);

  async function write() {
    const origin = window.location.origin;
    const target = chipTarget(slug, origin);

    if (target.kind === "unset") {
      setState({
        kind: "failed",
        message:
          "Falta configurar NEXT_PUBLIC_SITE_URL con la dirección pública del álbum. Sin ella no sé qué URL grabar, y una pegatina no se puede reescribir a medias.",
      });
      return;
    }

    if (target.kind === "wrong-origin") {
      setState({
        kind: "failed",
        message: `Esto es ${target.actual}, y el chip tiene que llevar ${target.expected}. Una pegatina grabada desde aquí solo funcionaría en este ordenador. Ábrelo en ${target.expected} y grábala desde ahí.`,
      });
      return;
    }

    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), GIVE_UP_MS);

    setState({ kind: "waiting" });

    try {
      await writeChipUrl(target.url, { signal: controller.signal });
      setState({ kind: "done" });
    } catch (cause) {
      const message = nfcProblem(cause);
      // Null means it was cancelled — by the button, or by the timeout. Neither
      // is a failure worth colouring red.
      setState(message ? { kind: "failed", message } : { kind: "idle" });
    } finally {
      clearTimeout(timer);
      abort.current = null;
    }
  }

  // Measured against the configured public address rather than wherever this
  // is being viewed from, so it is the same on the server and in the browser
  // and can be decided while rendering.
  const tight =
    siteUrl() !== "" && chipBytes(placeUrl(slug, "")) > SMALLEST_TAG_BYTES;

  return (
    <>
      {state.kind === "waiting" ? (
        <span className="flex items-baseline gap-3">
          <span className="t-label text-teal">
            Acerca la pegatina al móvil…
          </span>
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="t-label cursor-pointer text-ink-soft hover:underline"
          >
            Cancelar
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void write()}
          className="t-label shrink-0 cursor-pointer text-ink-soft hover:text-accent hover:underline"
        >
          {state.kind === "done" ? "Grabar otra" : "Grabar chip"}
        </button>
      )}

      {state.kind === "done" && (
        <p role="status" className="mt-2 basis-full text-[0.9rem] text-teal">
          Pegatina grabada. Acércala otra vez para comprobar que abre el álbum.
        </p>
      )}

      {state.kind === "failed" && (
        <p role="alert" className="mt-2 basis-full text-[0.9rem] text-accent">
          {state.message}
        </p>
      )}

      {tight && state.kind === "idle" && (
        <p className="mt-2 basis-full text-[0.9rem] text-ink-soft">
          Esta URL es larga para una pegatina NTAG213, que son las baratas.
          Necesitarás una NTAG215 o mayor.
        </p>
      )}
    </>
  );
}
