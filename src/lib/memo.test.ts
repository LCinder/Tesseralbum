import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { forget, memo } from "./memo";

beforeEach(() => forget());

test("the second ask is answered without running the loader again", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return "fotos";
  };

  assert.equal(await memo("album:kioto", load), "fotos");
  assert.equal(await memo("album:kioto", load), "fotos");
  assert.equal(calls, 1);
});

test("different keys are different answers", async () => {
  await memo("album:kioto", async () => "kioto");
  assert.equal(await memo("album:dublin", async () => "dublin"), "dublin");
  assert.equal(await memo("album:kioto", async () => "otra"), "kioto");
});

test("simultaneous asks share one request", async () => {
  // The case this exists for: two components mounting at once would otherwise
  // each fire the same listing before either returned.
  let calls = 0;
  const load = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return calls;
  };

  const [a, b, c] = await Promise.all([
    memo("album:kioto", load),
    memo("album:kioto", load),
    memo("album:kioto", load),
  ]);

  assert.equal(calls, 1, "one request for three asks");
  assert.deepEqual([a, b, c], [1, 1, 1]);
});

test("a failure is not remembered as an answer", async () => {
  // Caching a rejection would suppress the real answer for the whole TTL over
  // one flaky moment.
  await assert.rejects(
    memo("album:kioto", async () => {
      throw new Error("se cayó la red");
    }),
  );

  assert.equal(await memo("album:kioto", async () => "bien"), "bien");
});

test("a failure does not poison the callers waiting on it", async () => {
  const failing = memo("album:kioto", async () => {
    throw new Error("se cayó la red");
  });
  const alsoWaiting = memo("album:kioto", async () => "no debería correr");

  await assert.rejects(failing);
  await assert.rejects(alsoWaiting, "both see the same failure");
});

test("forgetting one prefix leaves the rest alone", async () => {
  await memo("album:kioto", async () => "kioto");
  await memo("passport", async () => "pasaporte");

  forget("album:");

  let reloaded = false;
  await memo("album:kioto", async () => {
    reloaded = true;
    return "kioto otra vez";
  });

  assert.ok(reloaded, "the album was forgotten");
  assert.equal(
    await memo("passport", async () => "no debería correr"),
    "pasaporte",
    "the passport was not",
  );
});

test("forgetting everything forgets everything", async () => {
  await memo("album:kioto", async () => "kioto");
  forget();

  let reloaded = false;
  await memo("album:kioto", async () => {
    reloaded = true;
    return "otra vez";
  });

  assert.ok(reloaded);
});

test("a cached value of null or false is still a cached value", async () => {
  // A truthiness check here would re-run the loader for every honest "no".
  let calls = 0;
  const load = async () => {
    calls += 1;
    return null;
  };

  await memo("vacío", load);
  await memo("vacío", load);

  assert.equal(calls, 1);
});
