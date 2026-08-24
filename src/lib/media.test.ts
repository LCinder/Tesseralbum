import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  dateFromName,
  formatBytes,
  pickCoords,
  pickDate,
  undecodableWarning,
} from "./media";

test("MIME type decides photo from video", () => {
  assert.equal(classify("image/jpeg", "IMG_0001.JPG"), "photo");
  assert.equal(classify("image/heic", "IMG_0001.HEIC"), "photo");
  assert.equal(classify("video/mp4", "clip.mp4"), "video");
  assert.equal(classify("video/quicktime", "clip.mov"), "video");
});

test("a missing MIME type falls back to the extension", () => {
  // Some Android pickers hand over an empty File.type; dropping the file as
  // unsupported would be wrong.
  assert.equal(classify("", "IMG_0001.jpg"), "photo");
  assert.equal(classify("", "vacaciones.MOV"), "video");
  assert.equal(classify("application/octet-stream", "foto.heic"), "photo");
});

test("anything that is not media is refused", () => {
  assert.equal(classify("application/pdf", "billete.pdf"), null);
  assert.equal(classify("", "notas.txt"), null);
  assert.equal(classify("", "sinextension"), null);
});

test("formats the browser cannot show are flagged, not rejected", () => {
  assert.match(undecodableWarning("image/heic", "a.heic") ?? "", /HEIC/);
  assert.match(undecodableWarning("", "a.HEIF") ?? "", /HEIC/);
  assert.match(undecodableWarning("video/quicktime", "a.mov") ?? "", /HEVC/);

  assert.equal(undecodableWarning("image/jpeg", "a.jpg"), null);
  assert.equal(undecodableWarning("video/mp4", "a.mp4"), null);
});

test("an EXIF date wins and is marked as such", () => {
  const shot = new Date(2025, 8, 29, 14, 32);
  const result = pickDate(shot, "IMG_0001.jpg", Date.now());

  assert.equal(result.dateSource, "exif");
  assert.equal(result.takenAt?.getTime(), shot.getTime());
});

test("without EXIF the file date is used, and labelled as weaker", () => {
  const modified = new Date(2025, 9, 7, 9, 0).getTime();
  const result = pickDate(undefined, "sin-pistas.jpg", modified);

  assert.equal(result.dateSource, "file");
  assert.equal(result.takenAt?.getTime(), modified);
});

test("an unusable EXIF date does not masquerade as one", () => {
  const modified = new Date(2025, 9, 7).getTime();

  for (const junk of [
    null,
    undefined,
    "2025-09-29",
    0,
    new Date("no es una fecha"),
  ]) {
    const result = pickDate(junk, "sin-pistas.jpg", modified);
    assert.equal(result.dateSource, "file", `for ${String(junk)}`);
  }
});

test("with no date at all, nothing is invented", () => {
  const result = pickDate(undefined, "sin-pistas.jpg", 0);
  assert.equal(result.takenAt, null);
  assert.equal(result.dateSource, "none");
});

test("valid coordinates come through marked as EXIF", () => {
  const result = pickCoords(35.0116, 135.7681);

  assert.equal(result.geoSource, "exif");
  assert.equal(result.lat, 35.0116);
  assert.equal(result.lng, 135.7681);
});

test("the extremes of the globe are valid", () => {
  assert.equal(pickCoords(-90, -180).geoSource, "exif");
  assert.equal(pickCoords(90, 180).geoSource, "exif");
});

test("Null Island is treated as no location", () => {
  // Cameras writing empty GPS tags land on 0,0. A pin in the Gulf of Guinea
  // is worse than an honest "no location".
  const result = pickCoords(0, 0);

  assert.equal(result.geoSource, "none");
  assert.equal(result.lat, null);
});

test("a single valid axis is not half a location", () => {
  assert.equal(pickCoords(35.0116, undefined).geoSource, "none");
  assert.equal(pickCoords(undefined, 135.7681).geoSource, "none");
});

test("out-of-range and unparseable coordinates are refused", () => {
  assert.equal(pickCoords(91, 0).geoSource, "none");
  assert.equal(pickCoords(0, 181).geoSource, "none");
  assert.equal(pickCoords("norte", "este").geoSource, "none");
  assert.equal(pickCoords(null, null).geoSource, "none");
});

test("a longitude of zero is kept when the latitude is real", () => {
  // Greenwich is a place. Only 0,0 exactly is suspect.
  const result = pickCoords(51.4779, 0);

  assert.equal(result.geoSource, "exif");
  assert.equal(result.lng, 0);
});

test("sizes read the way a person would say them", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
});

test("a WhatsApp photo keeps its date in its name", () => {
  // The one case that matters most: EXIF stripped, mtime is the day it was
  // forwarded, and the real date is still sitting in the file name.
  const forwardedLastWeek = new Date(2026, 2, 14).getTime();
  const result = pickDate(
    undefined,
    "IMG-20250929-WA0012.jpg",
    forwardedLastWeek,
  );

  assert.equal(result.dateSource, "name");
  assert.equal(result.takenAt?.getFullYear(), 2025);
  assert.equal(result.takenAt?.getMonth(), 8);
  assert.equal(result.takenAt?.getDate(), 29);
});

test("the usual camera and screenshot names are understood", () => {
  const cases: [string, [number, number, number]][] = [
    ["IMG_20250929_140311.jpg", [2025, 8, 29]],
    ["PXL_20250929_120311123.jpg", [2025, 8, 29]],
    ["VID_20241118_093000.mp4", [2024, 10, 18]],
    ["20250929_140311.jpg", [2025, 8, 29]],
    ["Screenshot_20250929-140311_Maps.png", [2025, 8, 29]],
    ["2025-09-29 14.03.11.jpg", [2025, 8, 29]],
    ["signal-2025-09-29-140311.jpeg", [2025, 8, 29]],
    ["2024_11_18.png", [2024, 10, 18]],
  ];

  for (const [name, [year, month, day]] of cases) {
    const at = dateFromName(name);
    assert.ok(at, `no date read from ${name}`);
    assert.deepEqual(
      [at.getFullYear(), at.getMonth(), at.getDate()],
      [year, month, day],
      name,
    );
  }
});

test("a name with a time keeps the time, one without lands at midday", () => {
  const withTime = dateFromName("IMG_20250929_140311.jpg");
  assert.equal(withTime?.getHours(), 14);
  assert.equal(withTime?.getMinutes(), 3);

  // Midday, so reading the clock either way leaves the photo on its own day.
  const dayOnly = dateFromName("IMG-20250929-WA0012.jpg");
  assert.equal(dayOnly?.getHours(), 12);
});

test("numbers that are not dates are not read as dates", () => {
  for (const name of [
    "IMG_0001.jpg",
    "DSC_1234.JPG",
    "factura-12345678901234.pdf",
    "IMG_20251345_000000.jpg", // month 13, day 45
    "foto-19800101.jpg", // camera with a flat battery
    "captura-30250929.png", // year 3025
  ]) {
    assert.equal(dateFromName(name), null, name);
  }
});

test("a serial before the date does not hide the date", () => {
  const at = dateFromName("factura-12345678901234-IMG_20250929_140311.jpg");
  assert.equal(at?.getFullYear(), 2025);
  assert.equal(at?.getMonth(), 8);
  assert.equal(at?.getDate(), 29);
});

test("Pixel's milliseconds do not cost the photo its time", () => {
  const at = dateFromName("PXL_20250929_120311123.jpg");
  assert.equal(at?.getHours(), 12);
  assert.equal(at?.getMinutes(), 3);
  assert.equal(at?.getSeconds(), 11);
});
