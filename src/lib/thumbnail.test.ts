import assert from "node:assert/strict";
import test from "node:test";
import { THUMB_SIZE, fitInside, thumbName } from "./thumbnail";

test("a large landscape photo shrinks to fit the long side", () => {
  const box = fitInside(4000, 3000, THUMB_SIZE);

  assert.equal(box.width, THUMB_SIZE);
  assert.equal(box.height, 300);
});

test("a portrait photo is limited by its height", () => {
  const box = fitInside(3000, 4000, THUMB_SIZE);

  assert.equal(box.height, THUMB_SIZE);
  assert.equal(box.width, 300);
});

test("aspect ratio survives the scaling", () => {
  const box = fitInside(1600, 900, THUMB_SIZE);
  assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.02);
});

test("an image smaller than the box is left alone, not blown up", () => {
  // Upscaling would make a bigger file that looks worse.
  const box = fitInside(120, 80, THUMB_SIZE);

  assert.equal(box.width, 120);
  assert.equal(box.height, 80);
});

test("a square stays square", () => {
  const box = fitInside(2000, 2000, THUMB_SIZE);

  assert.equal(box.width, THUMB_SIZE);
  assert.equal(box.height, THUMB_SIZE);
});

test("dimensions come back as whole pixels", () => {
  const box = fitInside(1000, 333, THUMB_SIZE);

  assert.equal(box.width, Math.round(box.width));
  assert.equal(box.height, Math.round(box.height));
});

test("a degenerate size never produces a zero-sized canvas", () => {
  // A canvas of zero width throws, which would fail an upload over a preview.
  for (const [w, h] of [
    [0, 0],
    [0, 500],
    [500, 0],
    [-10, 20],
    [Number.NaN, 100],
    [Number.POSITIVE_INFINITY, 100],
  ]) {
    const box = fitInside(w, h, THUMB_SIZE);
    assert.ok(box.width >= 1, `width for ${w}x${h}`);
    assert.ok(box.height >= 1, `height for ${w}x${h}`);
  }
});

test("an extremely wide panorama still has at least one pixel of height", () => {
  const box = fitInside(20000, 400, THUMB_SIZE);

  assert.equal(box.width, THUMB_SIZE);
  assert.ok(box.height >= 1);
});

test("thumbnail names stay beside their original", () => {
  assert.equal(thumbName("IMG_0042.JPG"), "IMG_0042.JPG.thumb.jpg");
  assert.equal(thumbName("clip.mp4"), "clip.mp4.thumb.jpg");
});
