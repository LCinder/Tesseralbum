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

test("a hash query batches many clauses into one request", () => {
  // The point of batching: fifty photos used to mean fifty list queries before
  // a single byte moved. This is the shape those queries take.
  const hashes = ["aaa", "bbb", "ccc"];
  const clauses = hashes
    .map((hash) => `appProperties has { key='sha256' and value=${quote(hash)} }`)
    .join(" or ");

  const q = `(${clauses}) and trashed = false`;

  assert.equal((q.match(/appProperties has/g) ?? []).length, 3);
  assert.match(q, /^\(.* or .* or .*\) and trashed = false$/);
});

test("a hash with a quote in it cannot break out of its clause", () => {
  // Hashes are hex so this cannot happen in practice — but the escaping has to
  // hold anyway, because a query built by concatenation is one bad value away
  // from asking Drive something entirely different.
  const nasty = "abc' or name = 'x";
  const clause = `appProperties has { key='sha256' and value=${quote(nasty)} }`;

  // The injected text survives as text, inside the quoted value where it is
  // harmless. What matters is that its quote is escaped and cannot close it.
  assert.ok(clause.includes("\\'"), "the quote is escaped");
  assert.ok(clause.endsWith("' }"), "the clause still closes where it should");
});
