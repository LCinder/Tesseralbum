import assert from "node:assert/strict";
import test from "node:test";
import {
  SAME_TRIP_GAP_DAYS,
  belongsToSameTrip,
  disambiguate,
  mergeSpans,
  monthLabel,
  monthName,
  spanFromProperties,
  spanOf,
  spanToProperties,
  tripPath,
  yearLabel,
} from "./trips";

/** Local time, because a folder name follows the traveller's calendar. */
const on = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

test("the Ireland trip from the brief lands where it should", () => {
  // 29 September to 7 October 2025.
  const span = { from: on(2025, 9, 29), to: on(2025, 10, 7) };

  assert.deepEqual(tripPath("Irlanda", span), [
    "Irlanda",
    "2025",
    "Septiembre-Octubre",
  ]);
});

test("a trip inside one month is named by that month alone", () => {
  const span = { from: on(2024, 11, 18), to: on(2024, 11, 26) };
  assert.equal(monthLabel(span), "Noviembre");
  assert.deepEqual(tripPath("Japón", span), ["Japón", "2024", "Noviembre"]);
});

test("a single-day trip still gets a folder", () => {
  const day = on(2025, 3, 14);
  assert.deepEqual(tripPath("Portugal", { from: day, to: day }), [
    "Portugal",
    "2025",
    "Marzo",
  ]);
});

test("a long trip is named by its ends, not every month between", () => {
  const span = { from: on(2023, 6, 2), to: on(2023, 8, 30) };
  assert.equal(monthLabel(span), "Junio-Agosto");
});

test("a New Year trip stays in the year it started", () => {
  // Splitting this across 2025/ and 2026/ would tear one trip in half.
  const span = { from: on(2025, 12, 28), to: on(2026, 1, 4) };

  assert.equal(yearLabel(span), "2025");
  assert.equal(monthLabel(span), "Diciembre-Enero");
  assert.deepEqual(tripPath("Austria", span), [
    "Austria",
    "2025",
    "Diciembre-Enero",
  ]);
});

test("the same month in different years is not one month", () => {
  // Only reachable via a suspect date, but the label must not collapse to
  // "Marzo" and merge two trips a year apart.
  const span = { from: on(2024, 3, 5), to: on(2025, 3, 5) };
  assert.equal(monthLabel(span), "Marzo-Marzo");
});

test("month names cover the year and refuse anything else", () => {
  assert.equal(monthName(0), "Enero");
  assert.equal(monthName(8), "Septiembre");
  assert.equal(monthName(11), "Diciembre");
  assert.throws(() => monthName(12), RangeError);
  assert.throws(() => monthName(-1), RangeError);
});

test("the span of a batch ignores photos with no date", () => {
  const span = spanOf([
    on(2025, 10, 3),
    null,
    on(2025, 9, 29),
    undefined,
    on(2025, 10, 7),
  ]);

  assert.equal(span?.from.getTime(), on(2025, 9, 29).getTime());
  assert.equal(span?.to.getTime(), on(2025, 10, 7).getTime());
});

test("a batch with no usable dates has no span", () => {
  assert.equal(spanOf([]), null);
  assert.equal(spanOf([null, undefined]), null);
  assert.equal(spanOf([new Date("no es una fecha")]), null);
});

test("uploading the rest of a trip later reuses its folder", () => {
  const uploaded = { from: on(2025, 9, 29), to: on(2025, 10, 5) };
  const forgotten = { from: on(2025, 10, 6), to: on(2025, 10, 7) };

  assert.ok(belongsToSameTrip(uploaded, forgotten));

  const merged = mergeSpans(uploaded, forgotten);
  assert.equal(monthLabel(merged), "Septiembre-Octubre");
  assert.equal(merged.to.getTime(), on(2025, 10, 7).getTime());
});

test("a genuine second visit gets its own folder", () => {
  const first = { from: on(2025, 9, 29), to: on(2025, 10, 7) };
  const second = { from: on(2025, 12, 20), to: on(2025, 12, 27) };

  assert.equal(belongsToSameTrip(first, second), false);
});

test("the same-trip threshold is exactly the documented gap", () => {
  const first = { from: on(2025, 1, 1), to: on(2025, 1, 10) };

  const justInside = {
    from: on(2025, 1, 10 + SAME_TRIP_GAP_DAYS),
    to: on(2025, 1, 10 + SAME_TRIP_GAP_DAYS),
  };
  const justOutside = {
    from: on(2025, 1, 10 + SAME_TRIP_GAP_DAYS + 1),
    to: on(2025, 1, 10 + SAME_TRIP_GAP_DAYS + 1),
  };

  assert.ok(belongsToSameTrip(first, justInside), "at the threshold");
  assert.equal(
    belongsToSameTrip(first, justOutside),
    false,
    "past the threshold",
  );
});

test("order does not matter when comparing two spans", () => {
  const early = { from: on(2025, 5, 1), to: on(2025, 5, 3) };
  const late = { from: on(2025, 9, 1), to: on(2025, 9, 3) };

  assert.equal(belongsToSameTrip(early, late), belongsToSameTrip(late, early));
  assert.deepEqual(mergeSpans(early, late), mergeSpans(late, early));
});

test("overlapping batches count as one trip", () => {
  const a = { from: on(2025, 7, 1), to: on(2025, 7, 20) };
  const b = { from: on(2025, 7, 10), to: on(2025, 7, 15) };

  assert.ok(belongsToSameTrip(a, b));
  assert.deepEqual(mergeSpans(a, b), a);
});

test("a free name is left alone", () => {
  assert.equal(disambiguate("Septiembre", []), "Septiembre");
  assert.equal(disambiguate("Septiembre", ["Octubre"]), "Septiembre");
});

test("two separate trips in one month get distinct folders", () => {
  // 1-5 September and 25-30 September are 20 days apart, so not one trip —
  // but both want to be called "Septiembre".
  const early = { from: on(2025, 9, 1), to: on(2025, 9, 5) };
  const late = { from: on(2025, 9, 25), to: on(2025, 9, 30) };

  assert.equal(belongsToSameTrip(early, late), false);

  const first = monthLabel(early);
  assert.equal(disambiguate(monthLabel(late), [first]), "Septiembre (2)");
});

test("disambiguation keeps counting past the second collision", () => {
  assert.equal(
    disambiguate("Marzo", ["Marzo", "Marzo (2)", "Marzo (3)"]),
    "Marzo (4)",
  );
});

test("a span survives a round trip through folder properties", () => {
  const span = { from: on(2025, 9, 29), to: on(2025, 10, 7) };
  const restored = spanFromProperties(spanToProperties(span));

  assert.equal(restored?.from.getTime(), span.from.getTime());
  assert.equal(restored?.to.getTime(), span.to.getTime());
});

test("a folder without our properties is not mistaken for a trip", () => {
  // Folders made by hand in Drive, or by an older version, must read as
  // "not ours" rather than poison the same-trip comparison.
  assert.equal(spanFromProperties(undefined), null);
  assert.equal(spanFromProperties({}), null);
  assert.equal(spanFromProperties({ tripFrom: "2025-09-29T00:00:00Z" }), null);
  assert.equal(spanFromProperties({ tripFrom: "ayer", tripTo: "hoy" }), null);
});

test("a reversed span is rejected rather than silently swapped", () => {
  const backwards = {
    tripFrom: on(2025, 10, 7).toISOString(),
    tripTo: on(2025, 9, 29).toISOString(),
  };

  assert.equal(spanFromProperties(backwards), null);
});
