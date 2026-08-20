/**
 * Reading what a file knows about itself, before anything is uploaded.
 *
 * Everything happens in the browser: the EXIF, the hash, the classification.
 * Nothing is sent anywhere, which is what makes it safe to show the user what
 * was understood and let them look at it before committing.
 *
 * The pure helpers at the top are the ones worth testing; the reading itself
 * needs a real `File`.
 */

/** Hashing loads the whole file into memory, so very large ones are skipped. */
export const MAX_HASH_BYTES = 100 * 1024 * 1024;

export type Kind = "photo" | "video";

/** Where a value came from, so the interface never fakes precision. */
export type Provenance = "exif" | "file" | "none";

export type MediaFile = {
  file: File;
  kind: Kind;
  /** Absent when the file was too large to hash — see `MAX_HASH_BYTES`. */
  sha256: string | null;
  takenAt: Date | null;
  dateSource: Provenance;
  lat: number | null;
  lng: number | null;
  geoSource: "exif" | "none";
  width: number | null;
  height: number | null;
  /** Something the user should know, in their language. */
  warning: string | null;
};

/**
 * Photo or video, decided by MIME type with the extension as a backstop.
 *
 * Browsers do not always fill in `File.type` — an unusual extension, some
 * Android file pickers — so the name is worth consulting rather than dropping
 * the file as unsupported.
 */
export function classify(mime: string, name: string): Kind | null {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";

  const extension = name.toLowerCase().split(".").pop() ?? "";

  if (["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif", "tif", "tiff"].includes(extension)) {
    return "photo";
  }
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv", "3gp"].includes(extension)) {
    return "video";
  }

  return null;
}

/**
 * Formats a browser cannot decode, even though it will happily store them.
 *
 * An iPhone on its default setting produces HEIC and HEVC, which Chrome and
 * Firefox will not render. The file uploads fine; what fails is showing it. The
 * fix belongs on the phone — Ajustes › Cámara › Formatos › Más compatible —
 * rather than in a megabyte of decoder shipped to every visitor.
 */
export function undecodableWarning(mime: string, name: string): string | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";

  if (mime === "image/heic" || mime === "image/heif" || extension === "heic" || extension === "heif") {
    return "HEIC: se sube bien, pero el navegador no puede mostrarla. En el iPhone: Ajustes › Cámara › Formatos › Más compatible.";
  }
  if (mime === "video/quicktime" && extension === "mov") {
    return "Puede ser HEVC, que Chrome no reproduce. Si no se ve, cambia el formato de la cámara a «Más compatible».";
  }

  return null;
}

/**
 * Picks the capture date, and says where it came from.
 *
 * `File.lastModified` is a weak substitute: copying a file, syncing it or
 * exporting it all reset it. It is still better than nothing for a video,
 * whose date EXIF does not cover — but the caller has to be able to tell the
 * two apart, which is what `dateSource` is for.
 */
export function pickDate(
  exifDate: unknown,
  lastModified: number,
): { takenAt: Date | null; dateSource: Provenance } {
  if (exifDate instanceof Date && Number.isFinite(exifDate.getTime())) {
    return { takenAt: exifDate, dateSource: "exif" };
  }

  if (Number.isFinite(lastModified) && lastModified > 0) {
    return { takenAt: new Date(lastModified), dateSource: "file" };
  }

  return { takenAt: null, dateSource: "none" };
}

/** Valid Earth coordinates, or nothing. Zero-zero is treated as absent. */
export function pickCoords(
  latitude: unknown,
  longitude: unknown,
): { lat: number | null; lng: number | null; geoSource: "exif" | "none" } {
  const lat = Number(latitude);
  const lng = Number(longitude);

  const usable =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // Null Island: cameras that write empty GPS tags land here, and a pin off
    // the coast of Ghana is worse than no pin at all.
    !(lat === 0 && lng === 0);

  return usable
    ? { lat, lng, geoSource: "exif" }
    : { lat: null, lng: null, geoSource: "none" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256(file: File): Promise<string | null> {
  if (file.size > MAX_HASH_BYTES) return null;

  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Reads one file. Never throws: a file whose EXIF is unreadable still comes
 * back, with whatever could be worked out and a warning attached, because
 * dropping it silently is the one outcome the user cannot debug.
 */
export async function readMedia(file: File): Promise<MediaFile | null> {
  const kind = classify(file.type, file.name);
  if (!kind) return null;

  const warnings: string[] = [];
  const undecodable = undecodableWarning(file.type, file.name);
  if (undecodable) warnings.push(undecodable);

  let exif: Record<string, unknown> = {};

  if (kind === "photo") {
    try {
      // Loaded lazily so the parser is not in the bundle for people who never
      // upload anything.
      const exifr = await import("exifr");
      exif =
        (await exifr.parse(file, {
          tiff: true,
          exif: true,
          gps: true,
          // The whole point is these four; parsing the rest is wasted work.
          pick: [
            "DateTimeOriginal",
            "CreateDate",
            "GPSLatitude",
            "GPSLongitude",
            "ExifImageWidth",
            "ExifImageHeight",
          ],
        })) ?? {};
    } catch {
      warnings.push("No se pudo leer el EXIF de esta foto.");
    }
  }

  const { takenAt, dateSource } = pickDate(
    exif.DateTimeOriginal ?? exif.CreateDate,
    file.lastModified,
  );

  const { lat, lng, geoSource } = pickCoords(exif.latitude, exif.longitude);

  if (kind === "photo" && geoSource === "none") {
    warnings.push("Sin ubicación: se usará la del souvenir.");
  }
  if (dateSource === "file") {
    warnings.push(
      kind === "video"
        ? "Fecha tomada del fichero: el EXIF no cubre vídeo."
        : "Sin fecha EXIF; se usa la del fichero, que es menos fiable.",
    );
  }

  const sha = await sha256(file);
  if (!sha) {
    warnings.push(
      `Demasiado grande para calcular su huella (más de ${formatBytes(MAX_HASH_BYTES)}); no se podrá detectar si está duplicada.`,
    );
  }

  return {
    file,
    kind,
    sha256: sha,
    takenAt,
    dateSource,
    lat,
    lng,
    geoSource,
    width: numberOrNull(exif.ExifImageWidth),
    height: numberOrNull(exif.ExifImageHeight),
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reads a whole selection, dropping what is neither photo nor video. */
export async function readSelection(files: File[]): Promise<{
  media: MediaFile[];
  rejected: string[];
}> {
  const media: MediaFile[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const read = await readMedia(file);
    if (read) media.push(read);
    else rejected.push(file.name);
  }

  return { media, rejected };
}
