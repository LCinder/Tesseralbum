/**
 * Making our own thumbnails, at upload time.
 *
 * Google generates thumbnails too, but its links expire and are served from a
 * host that may refuse an `<img>`. When that happens the only fallback is to
 * download the original — 4 MB for a photo, up to 200 MB for a clip — to show
 * something 400 px wide.
 *
 * One small file per upload removes that whole failure mode. A 50-photo album
 * goes from roughly 200 MB to about 1 MB.
 */

/** Wide enough for a retina grid tile, small enough to be nearly free. */
export const THUMB_SIZE = 400;

/** JPEG rather than WebP: every browser that can decode also encodes it. */
const THUMB_TYPE = "image/jpeg";
const THUMB_QUALITY = 0.82;

/** Where in a clip to grab the poster frame. */
const VIDEO_FRAME_SECONDS = 1;

/** Loading a whole video to grab one frame can stall; do not wait forever. */
const VIDEO_TIMEOUT_MS = 15000;

export function thumbName(fileName: string): string {
  return `${fileName}.thumb.jpg`;
}

/**
 * Scales to fit inside a square without cropping or distorting.
 *
 * Returned as whole pixels, and never zero: a canvas of zero width throws.
 */
export function fitInside(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: max, height: max };
  }
  if (width <= 0 || height <= 0) return { width: max, height: max };

  const scale = Math.min(1, max / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, THUMB_TYPE, THUMB_QUALITY),
  );
}

function draw(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob | null> {
  const box = fitInside(width, height, THUMB_SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;

  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);

  context.drawImage(source, 0, 0, box.width, box.height);
  return toBlob(canvas);
}

/**
 * A thumbnail for a photo.
 *
 * `createImageBitmap` decodes off the main thread, so a batch of large photos
 * does not freeze the page. Returns null for anything the browser cannot
 * decode — HEIC in Chrome — which is a real answer: the upload still goes
 * ahead, only the thumbnail is missing.
 */
async function photoThumb(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return await draw(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** A poster frame from a video, taken a second in to skip the black lead-in. */
function videoThumb(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");

    let settled = false;
    const done = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(blob);
    };

    const timer = setTimeout(() => done(null), VIDEO_TIMEOUT_MS);

    video.preload = "metadata";
    video.muted = true;
    // Required on iOS, which otherwise refuses to decode without a gesture.
    video.playsInline = true;

    video.addEventListener("loadeddata", () => {
      // A clip shorter than the seek point still has a first frame worth using.
      video.currentTime = Math.min(
        VIDEO_FRAME_SECONDS,
        Math.max(0, (video.duration || 0) / 2),
      );
    });

    video.addEventListener("seeked", () => {
      void draw(video, video.videoWidth, video.videoHeight).then(done);
    });

    video.addEventListener("error", () => done(null));

    video.src = url;
  });
}

/**
 * A thumbnail for whatever this is, or null when the browser cannot decode it.
 *
 * Never throws: a missing thumbnail costs a slower first view, and failing the
 * upload over it would be losing a photo to save a preview.
 */
export async function makeThumbnail(
  file: File,
  kind: "photo" | "video",
): Promise<Blob | null> {
  try {
    return kind === "video" ? await videoThumb(file) : await photoThumb(file);
  } catch {
    return null;
  }
}
