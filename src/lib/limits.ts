/**
 * What the app refuses to upload, and why.
 *
 * Every check runs in the browser before a byte moves. Discovering a limit
 * halfway through a 200 MB upload on hotel wifi is the outcome worth avoiding.
 */

import { formatBytes, type MediaFile } from "@/lib/media";

/**
 * Ceiling for one video.
 *
 * Drive's free tier is 15 GB shared with Gmail and Photos, so a handful of
 * unbounded clips can swallow it. 200 MB is roughly three minutes of phone
 * video at normal quality — enough for the clip you actually want, small
 * enough that fifty of them still leave room.
 */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Long clips belong somewhere else; this is a photo album with sound. */
export const MAX_VIDEO_SECONDS = 3 * 60;

/**
 * Ceiling for one photo.
 *
 * Generous on purpose: a 48-megapixel raw-ish JPEG can reach 30 MB and there
 * is no good reason to reject it. This only catches a video misfiled as an
 * image, or a scanner output nobody meant to upload.
 */
export const MAX_PHOTO_BYTES = 60 * 1024 * 1024;

export type Rejection = {
  key: string;
  name: string;
  reason: string;
};

/** Why this file cannot be uploaded, or `null` if it can. */
export function rejectionFor(item: MediaFile): string | null {
  if (item.kind === "video") {
    if (item.file.size > MAX_VIDEO_BYTES) {
      return `Vídeo de ${formatBytes(item.file.size)}: el tope es ${formatBytes(MAX_VIDEO_BYTES)}. Recórtalo en el móvil antes de subirlo.`;
    }
    if (
      item.durationSeconds !== null &&
      item.durationSeconds > MAX_VIDEO_SECONDS
    ) {
      return `Vídeo de ${formatDuration(item.durationSeconds)}: el tope son ${formatDuration(MAX_VIDEO_SECONDS)}.`;
    }
    return null;
  }

  if (item.file.size > MAX_PHOTO_BYTES) {
    return `Foto de ${formatBytes(item.file.size)}: el tope es ${formatBytes(MAX_PHOTO_BYTES)}.`;
  }

  return null;
}

/** Splits a selection into what will upload and what will not. */
export function applyLimits(media: MediaFile[]): {
  accepted: MediaFile[];
  rejected: Rejection[];
} {
  const accepted: MediaFile[] = [];
  const rejected: Rejection[] = [];

  for (const item of media) {
    const reason = rejectionFor(item);
    if (reason) {
      rejected.push({
        key: `${item.file.name}-${item.file.size}`,
        name: item.file.name,
        reason,
      });
    } else {
      accepted.push(item);
    }
  }

  return { accepted, rejected };
}

export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;

  if (minutes === 0) return `${rest} s`;
  return `${minutes}:${String(rest).padStart(2, "0")} min`;
}

/** Total size of a batch, for the quota warning. */
export function totalBytes(media: MediaFile[]): number {
  return media.reduce((sum, item) => sum + item.file.size, 0);
}

export type Quota = {
  limitBytes: number;
  usedBytes: number;
  /** Drive counts trashed files against you until the bin is emptied. */
  driveBytes: number;
};

export function freeBytes(quota: Quota): number {
  return Math.max(0, quota.limitBytes - quota.usedBytes);
}

export function usedFraction(quota: Quota): number {
  if (quota.limitBytes <= 0) return 0;
  return Math.min(1, quota.usedBytes / quota.limitBytes);
}

/**
 * Whether a batch fits, with a warning band before the hard stop.
 *
 * Filling a Drive is not just this app's problem — the same quota holds Gmail,
 * so running it to zero costs the user their email too. Worth saying before
 * the upload, not after.
 */
export function quotaVerdict(
  quota: Quota | null,
  batchBytes: number,
): { kind: "ok" | "tight" | "full"; message: string | null } {
  if (!quota || quota.limitBytes <= 0) {
    return { kind: "ok", message: null };
  }

  const free = freeBytes(quota);

  if (batchBytes > free) {
    return {
      kind: "full",
      message: `Este lote ocupa ${formatBytes(batchBytes)} y en tu Drive quedan ${formatBytes(free)}. Libera espacio antes de subirlo — recuerda que la papelera sigue contando.`,
    };
  }

  // A tenth of the quota left is the point at which Gmail starts to be at
  // risk, which is a different kind of problem from a full photo album.
  if (free - batchBytes < quota.limitBytes * 0.1) {
    return {
      kind: "tight",
      message: `Después de esto quedarán ${formatBytes(free - batchBytes)} en un Drive de ${formatBytes(quota.limitBytes)}. Esa cuota la comparten Gmail y Google Photos.`,
    };
  }

  return { kind: "ok", message: null };
}
