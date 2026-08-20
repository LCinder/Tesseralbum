import assert from "node:assert/strict";
import test from "node:test";
import { quote } from "./drive";

test("plain names are just wrapped in quotes", () => {
  assert.equal(quote("Japón"), "'Japón'");
  assert.equal(quote("Tesseralbum"), "'Tesseralbum'");
  assert.equal(quote("2024"), "'2024'");
});

test("apostrophes are escaped instead of ending the string", () => {
  // Without escaping, Drive would see the query end after "Sant" and either
  // reject it or match the wrong thing.
  assert.equal(quote("Sant'Angelo"), "'Sant\\'Angelo'");
  assert.equal(quote("Côte d'Ivoire"), "'Côte d\\'Ivoire'");
  assert.equal(quote("L'Hospitalet"), "'L\\'Hospitalet'");
});

test("backslashes are escaped before quotes, not after", () => {
  // Order matters: escaping quotes first would then double the backslash it
  // just introduced, and the value would arrive corrupted.
  assert.equal(quote("a\\b"), "'a\\\\b'");
  assert.equal(quote("back\\'slash"), "'back\\\\\\'slash'");
});

test("an escaped value never contains a bare delimiter", () => {
  for (const nasty of [
    "it's",
    "' or name = '",
    "\\",
    "\\'",
    "''''",
    "trailing\\",
  ]) {
    const escaped = quote(nasty);
    const inner = escaped.slice(1, -1);

    // Walk the body: every quote and backslash must be preceded by a
    // backslash, which is exactly what keeps the delimiter unambiguous.
    let i = 0;
    let bare = 0;
    while (i < inner.length) {
      if (inner[i] === "\\") {
        i += 2;
        continue;
      }
      if (inner[i] === "'") bare += 1;
      i += 1;
    }

    assert.equal(bare, 0, `bare quote left in ${escaped}`);
  }
});
