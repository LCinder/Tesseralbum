import { placeUrl, siteUrl } from "@/lib/env";

/**
 * Writing a place's URL onto an NFC sticker, from the browser.
 *
 * The premise of the whole project is tapping a phone against a souvenir, and
 * until now the app could not produce one of those souvenirs: the stickers were
 * written with some other program. Web NFC closes that loop.
 *
 * Android and Chrome only. There is no Web NFC on iOS and no sign of one, so
 * everything here has to fail into an explanation rather than a broken button.
 */

/** The shape of the bits of Web NFC this uses. */
type NdefWriter = {
  write(
    message: { records: { recordType: string; data?: unknown }[] },
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>;
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>;
};

declare global {
  interface Window {
    /** Absent everywhere except Chrome on Android. */
    NDEFReader?: new () => NdefWriter;
  }
}

/** Whether this browser can write a sticker at all. */
export function nfcAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

/**
 * Whether a sticker written here would be worth anything.
 *
 * A chip carries one absolute URL and nothing can change it afterwards, so
 * writing `http://localhost:3000/t/dublin` produces a sticker that works on
 * exactly one machine with a dev server running — and you find out by tapping
 * it in a year's time. Refusing is cheaper than remembering.
 */
export type ChipTarget =
  | { kind: "ready"; url: string }
  /** No public address is configured, so there is no right URL to write. */
  | { kind: "unset" }
  /** Configured, but this is not it — a dev server, or a preview deployment. */
  | { kind: "wrong-origin"; expected: string; actual: string };

export function chipTarget(slug: string, origin: string): ChipTarget {
  const site = siteUrl();
  if (!site) return { kind: "unset" };

  const here = origin.replace(/\/+$/, "");
  if (here !== site) {
    return { kind: "wrong-origin", expected: site, actual: here };
  }

  return { kind: "ready", url: placeUrl(slug, origin) };
}

/**
 * An upper bound on the tag memory this URL needs.
 *
 * An NDEF URI record is the address plus a short header, and the common schemes
 * are abbreviated to a single byte — so this over-counts a little, which is the
 * right direction to be wrong in for a warning.
 */
export function chipBytes(url: string): number {
  return new TextEncoder().encode(url).length + 10;
}

/** NTAG213, the cheap stickers. The larger ones hold 504 or 888. */
export const SMALLEST_TAG_BYTES = 144;

/**
 * Writes a URL to whichever sticker is presented next.
 *
 * The promise does not settle until a tag comes into range, so a caller without
 * an `AbortSignal` waits for ever. Cancelling is not a nicety here.
 */
export async function writeChipUrl(
  url: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  const Reader = typeof window === "undefined" ? undefined : window.NDEFReader;
  if (!Reader) {
    throw new DOMException("Web NFC no está disponible.", "NotSupportedError");
  }

  await new Reader().write(
    { records: [{ recordType: "url", data: url }] },
    { signal },
  );
}

/**
 * What went wrong, in terms of something the reader can do about it.
 *
 * Web NFC reports everything as a `DOMException` whose name is the only useful
 * part, and each one points at a different fix — "enciende el NFC" against "no
 * la muevas" against "dale permiso". Collapsing them into one message throws
 * away the only help the API gives.
 *
 * Returns null when the write was cancelled, which is not a failure to report.
 */
export function nfcProblem(cause: unknown): string | null {
  const name = cause instanceof DOMException ? cause.name : "";

  switch (name) {
    case "AbortError":
      return null;
    case "NotAllowedError":
      return "No has dado permiso para usar el NFC. Chrome lo pregunta la primera vez; si lo bloqueaste, se cambia en el candado de la barra de direcciones.";
    case "NotSupportedError":
      return "Este navegador no sabe escribir pegatinas NFC. Hace falta Chrome en Android; en iPhone no existe Web NFC, así que ahí tendrás que copiar la URL y grabarla con una app tipo NFC Tools.";
    case "NotReadableError":
      return "El NFC está apagado. Enciéndelo en los ajustes del móvil y vuelve a intentarlo.";
    case "NetworkError":
      return "La pegatina se ha separado antes de terminar de escribir. Vuelve a intentarlo apoyándola sin moverla.";
    default:
      return "No se pudo grabar la pegatina.";
  }
}
