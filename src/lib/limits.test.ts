import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  applyLimits,
  formatDuration,
  freeBytes,
  quotaVerdict,
  rejectionFor,
  totalBytes,
  usedFraction,
} from "./limits";
import type { MediaFile } from "./media";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function media(
  kind: "photo" | "video",
  size: number,
  durationSeconds: number | null = null,
): MediaFile {
  return {
    file: { name: `f-${size}.x`, size } as File,
    kind,
    sha256: null,
    takenAt: null,
    dateSource: "none",
    lat: null,
    lng: null,
    geoSource: "none",
    width: null,
    height: null,
    durationSeconds,
    warning: null,
  };
}

test("ordinary photos and videos pass", () => {
  assert.equal(rejectionFor(media("photo", 4 * MB)), null);
  assert.equal(rejectionFor(media("video", 30 * MB, 45)), null);
});

test("an oversized video is refused with its size named", () => {
  const reason = rejectionFor(media("video", 500 * MB, 60));

  assert.match(reason ?? "", /500\.0 MB/);
  assert.match(reason ?? "", /200\.0 MB/);
});

test("a long video is refused with its length named", () => {
  const reason = rejectionFor(media("video", 10 * MB, 8 * 60));

  assert.match(reason ?? "", /8:00 min/);
  assert.match(reason ?? "", /3:00 min/);
});

test("the limits are boundaries, not approximations", () => {
  assert.equal(rejectionFor(media("video", MAX_VIDEO_BYTES, 10)), null);
  assert.notEqual(rejectionFor(media("video", MAX_VIDEO_BYTES + 1, 10)), null);

  assert.equal(rejectionFor(media("video", MB, MAX_VIDEO_SECONDS)), null);
  assert.notEqual(
    rejectionFor(media("video", MB, MAX_VIDEO_SECONDS + 1)),
    null,
  );

  assert.equal(rejectionFor(media("photo", MAX_PHOTO_BYTES)), null);
  assert.notEqual(rejectionFor(media("photo", MAX_PHOTO_BYTES + 1)), null);
});

test("a video whose duration could not be read is judged on size alone", () => {
  // An HEVC clip Chrome cannot open reports no duration. Refusing it for that
  // would reject exactly the files an iPhone produces by default.
  assert.equal(rejectionFor(media("video", 20 * MB, null)), null);
  assert.notEqual(rejectionFor(media("video", 500 * MB, null)), null);
});

test("the photo limit does not apply to videos, nor the reverse", () => {
  // A 100 MB video is fine; a 100 MB photo is a video misfiled as an image.
  assert.equal(rejectionFor(media("video", 100 * MB, 30)), null);
  assert.notEqual(rejectionFor(media("photo", 100 * MB)), null);
});

test("a batch splits into accepted and rejected, keeping order", () => {
  const good = media("photo", MB);
  const huge = media("video", 900 * MB, 30);
  const alsoGood = media("video", 5 * MB, 12);

  const { accepted, rejected } = applyLimits([good, huge, alsoGood]);

  assert.deepEqual(accepted, [good, alsoGood]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].name, huge.file.name);
});

test("durations read the way a person says them", () => {
  assert.equal(formatDuration(9), "9 s");
  assert.equal(formatDuration(59.4), "59 s");
  assert.equal(formatDuration(60), "1:00 min");
  assert.equal(formatDuration(185), "3:05 min");
});

test("batch size is the sum of its files", () => {
  assert.equal(totalBytes([media("photo", 100), media("video", 250)]), 350);
  assert.equal(totalBytes([]), 0);
});

test("a roomy Drive says nothing", () => {
  const quota = { limitBytes: 15 * GB, usedBytes: 2 * GB, driveBytes: GB };

  assert.equal(quotaVerdict(quota, 100 * MB).kind, "ok");
  assert.equal(quotaVerdict(quota, 100 * MB).message, null);
});

test("a batch that does not fit is stopped before it starts", () => {
  const quota = { limitBytes: 15 * GB, usedBytes: 14.9 * GB, driveBytes: GB };
  const verdict = quotaVerdict(quota, GB);

  assert.equal(verdict.kind, "full");
  // The bin still counts against the quota, which is the non-obvious part.
  assert.match(verdict.message ?? "", /papelera/);
});

test("getting close to full warns, mentioning what else shares the quota", () => {
  const quota = { limitBytes: 15 * GB, usedBytes: 13.5 * GB, driveBytes: GB };
  const verdict = quotaVerdict(quota, GB);

  assert.equal(verdict.kind, "tight");
  assert.match(verdict.message ?? "", /Gmail/);
});

test("an unlimited or unknown quota never blocks an upload", () => {
  assert.equal(quotaVerdict(null, 100 * GB).kind, "ok");
  assert.equal(
    quotaVerdict({ limitBytes: 0, usedBytes: 0, driveBytes: 0 }, GB).kind,
    "ok",
  );
});

test("free space and fill fraction stay within their bounds", () => {
  const over = { limitBytes: 15 * GB, usedBytes: 16 * GB, driveBytes: GB };

  assert.equal(freeBytes(over), 0, "never negative");
  assert.equal(usedFraction(over), 1, "never above full");
  assert.equal(
    usedFraction({ limitBytes: 0, usedBytes: 5, driveBytes: 0 }),
    0,
    "no division by zero",
  );
});
