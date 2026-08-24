import assert from "node:assert/strict";
import test from "node:test";

/**
 * Only the decisions are testable: which URL a sticker would carry, whether
 * writing here is worth doing, and what each failure means. Whether a tag ends
 * up written can only be found out by tapping one, so that part is verified by
 * hand on a phone.
 *
 * The public address is read when asked rather than at module load, so setting
 * it here is enough.
 */
process.env.NEXT_PUBLIC_SITE_URL = "https://tesseralbum.vercel.app";

import { placeUrl } from "./env";
import { chipBytes, chipTarget, nfcProblem, SMALLEST_TAG_BYTES } from "./nfc";

test("a chip carries the public URL, not the one you are looking at", () => {
  const target = chipTarget("dublin", "https://tesseralbum.vercel.app");

  assert.equal(target.kind, "ready");
  assert.equal(
    target.kind === "ready" && target.url,
    "https://tesseralbum.vercel.app/t/dublin",
  );
});

test("writing from a dev server is refused, not quietly wrong", () => {
  // A chip holds one absolute URL for ever. localhost would work on exactly
  // one machine, and you would find out by tapping it months later.
  const target = chipTarget("dublin", "http://localhost:3000");

  assert.equal(target.kind, "wrong-origin");
  assert.equal(
    target.kind === "wrong-origin" && target.expected,
    "https://tesseralbum.vercel.app",
  );
  assert.equal(
    target.kind === "wrong-origin" && target.actual,
    "http://localhost:3000",
  );
});

test("a preview deployment is not the public address either", () => {
  const target = chipTarget(
    "dublin",
    "https://tesseralbum-rhh9jge7t-lcinders-projects.vercel.app",
  );

  assert.equal(target.kind, "wrong-origin");
});

test("a trailing slash is not a different origin", () => {
  assert.equal(
    chipTarget("dublin", "https://tesseralbum.vercel.app/").kind,
    "ready",
  );
});

test("the copy button falls back to where you are when nothing is configured", () => {
  // Only chip writing needs the public address. Copying a URL on a dev server
  // to try it in the same browser is a reasonable thing to do.
  assert.equal(
    placeUrl("dublin", "http://localhost:3000"),
    "https://tesseralbum.vercel.app/t/dublin",
  );
});

test("a short URL fits the cheap stickers with room to spare", () => {
  const url = "https://tesseralbum.vercel.app/t/dublin";

  assert.ok(
    chipBytes(url) < SMALLEST_TAG_BYTES,
    `${chipBytes(url)} bytes should fit in ${SMALLEST_TAG_BYTES}`,
  );
});

test("the estimate over-counts rather than under-counts", () => {
  // Wrong in the safe direction: warning about a tag that would have fitted is
  // an annoyance, silently overflowing one is a ruined sticker.
  const url = "https://example.com/t/x";

  assert.ok(chipBytes(url) > url.length);
});

test("a URL too long for an NTAG213 is over the line", () => {
  const url = `https://tesseralbum.vercel.app/t/${"x".repeat(140)}`;

  assert.ok(chipBytes(url) > SMALLEST_TAG_BYTES);
});

test("each failure says what to do about it", () => {
  const cases: [string, RegExp][] = [
    ["NotAllowedError", /permiso/i],
    ["NotSupportedError", /Chrome|iPhone/],
    ["NotReadableError", /apagado|ajustes/i],
    ["NetworkError", /moverla|separado/i],
  ];

  for (const [name, expected] of cases) {
    const message = nfcProblem(new DOMException("x", name));
    assert.ok(message, name);
    assert.match(message, expected, name);
  }
});

test("cancelling is not a failure to report", () => {
  assert.equal(nfcProblem(new DOMException("x", "AbortError")), null);
});

test("something unrecognised still says something", () => {
  assert.match(nfcProblem(new Error("vaya")) ?? "", /No se pudo grabar/);
});
