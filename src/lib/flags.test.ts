import assert from "node:assert/strict";
import test from "node:test";
import { flagOf } from "./flags";

test("flags come from the country code", () => {
  assert.equal(flagOf("JP"), "🇯🇵");
  assert.equal(flagOf("ES"), "🇪🇸");
  assert.equal(flagOf("IE"), "🇮🇪");
});

test("case and stray spaces do not matter", () => {
  assert.equal(flagOf("es"), "🇪🇸");
  assert.equal(flagOf(" ie "), "🇮🇪");
});

test("a code that is not two letters yields no flag rather than a broken one", () => {
  assert.equal(flagOf(""), "");
  assert.equal(flagOf("E"), "");
  assert.equal(flagOf("ESP"), "");
  assert.equal(flagOf("12"), "");
  assert.equal(flagOf("E1"), "");
});
