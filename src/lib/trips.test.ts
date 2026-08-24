import assert from "node:assert/strict";
import test from "node:test";
import {
  SAME_TRIP_GAP_DAYS,
  belongsToSameTrip,
  clusterTrips,
  disambiguate,
  mergeSpans,
  monthLabel,
  monthName,
  spanFromProperties,
  spanOf,
  spanToProperties,
  inferDates,
  isTrustedDate,
  trustedSpan,
  tripPath,
  undatedFor,
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

/** A photo with a date and a claim about where the date came from. */
const shot = (at: Date | null, dateSource = "exif") => ({
  takenAt: at,
  dateSource,
});

test("a file date does not stretch a trip when real dates exist", () => {
  // The reported bug: photos from November whose EXIF was stripped fall back
  // to File.lastModified, which copying resets to today. One of those turned
  // a November trip into "Noviembre-Agosto".
  const batch = [
    shot(on(2025, 11, 18)),
    shot(on(2025, 11, 22)),
    shot(on(2026, 8, 20), "file"),
  ];

  const [trip] = clusterTrips(batch);

  assert.equal(monthLabel(trip.span), "Noviembre");
  assert.equal(yearLabel(trip.span), "2025");
  assert.equal(trip.items.length, 3, "the undated photo still comes along");
});

test("a filename date is trusted like EXIF", () => {
  // IMG_20251118.jpg is the camera writing the date, just somewhere else.
  const batch = [shot(on(2025, 11, 18), "name"), shot(on(2026, 8, 20), "file")];

  assert.equal(monthLabel(clusterTrips(batch)[0].span), "Noviembre");
});

test("with nothing better, file dates are used rather than refusing", () => {
  const batch = [
    shot(on(2025, 11, 18), "file"),
    shot(on(2025, 11, 20), "file"),
  ];

  const [trip] = clusterTrips(batch);
  assert.equal(monthLabel(trip.span), "Noviembre");
});

test("two journeys in one selection become two trips", () => {
  // The other half of the bug: picking a year of photos at once produced one
  // folder spanning the lot.
  const batch = [
    shot(on(2025, 11, 18)),
    shot(on(2025, 11, 26)),
    shot(on(2026, 4, 2)),
    shot(on(2026, 4, 9)),
  ];

  const trips = clusterTrips(batch);

  assert.equal(trips.length, 2);
  assert.equal(monthLabel(trips[0].span), "Noviembre");
  assert.equal(monthLabel(trips[1].span), "Abril");
  assert.deepEqual(
    trips.map((t) => t.items.length),
    [2, 2],
  );
});

test("one journey stays one trip, however many photos", () => {
  const batch = Array.from({ length: 40 }, (_, i) =>
    shot(on(2025, 9, 29 + Math.floor(i / 5))),
  );

  assert.equal(clusterTrips(batch).length, 1);
});

test("the seam is the same threshold that joins a later upload", () => {
  const together = [
    shot(on(2025, 1, 1)),
    shot(on(2025, 1, 1 + SAME_TRIP_GAP_DAYS)),
  ];
  const apart = [
    shot(on(2025, 1, 1)),
    shot(on(2025, 1, 2 + SAME_TRIP_GAP_DAYS)),
  ];

  assert.equal(clusterTrips(together).length, 1);
  assert.equal(clusterTrips(apart).length, 2);
});

test("trips come back in the order they happened", () => {
  const batch = [
    shot(on(2026, 4, 2)),
    shot(on(2025, 11, 18)),
    shot(on(2026, 8, 1)),
  ];

  assert.deepEqual(
    clusterTrips(batch).map(
      (t) => yearLabel(t.span) + " " + monthLabel(t.span),
    ),
    ["2025 Noviembre", "2026 Abril", "2026 Agosto"],
  );
});

test("undated photos join the biggest trip, not the first", () => {
  // The best guess available: the trip you are plainly uploading.
  const batch = [
    shot(on(2025, 11, 18)),
    shot(on(2026, 4, 2)),
    shot(on(2026, 4, 3)),
    shot(on(2026, 4, 4)),
    shot(null),
    shot(null),
  ];

  const trips = clusterTrips(batch);
  const april = trips.find((t) => monthLabel(t.span) === "Abril");

  assert.equal(april?.items.length, 5, "three dated plus the two undated");
});

test("a selection with no usable date at all yields no trip", () => {
  assert.deepEqual(clusterTrips([]), []);
  assert.deepEqual(clusterTrips([shot(null), shot(null)]), []);
});

test("the files no trip was drawn from are the ones reported", () => {
  const weak = shot(on(2026, 8, 20), "file");
  const none = shot(null, "none");
  const batch = [shot(on(2025, 11, 18)), weak, none];

  assert.deepEqual(undatedFor(batch), [weak, none]);
});

test("a batch with nothing better does not call its own dates ignored", () => {
  // These file dates decide the folder, so listing them as unused would be a
  // lie — and the warning would fire on every batch of stripped photos.
  const batch = [shot(on(2026, 8, 20), "file"), shot(on(2026, 8, 21), "file")];

  assert.deepEqual(undatedFor(batch), []);
  assert.equal(clusterTrips(batch).length, 1);
});

test("nothing to report when every photo carries a camera date", () => {
  assert.deepEqual(
    undatedFor([shot(on(2025, 11, 18)), shot(on(2025, 11, 19))]),
    [],
  );
  assert.deepEqual(undatedFor([]), []);
});

test("the yardstick is made only of camera dates", () => {
  const batch = [
    shot(on(2025, 11, 18)),
    shot(on(2025, 11, 22), "name"),
    shot(on(2026, 8, 20), "file"),
  ];

  const span = trustedSpan(batch);

  assert.equal(span?.from.getTime(), on(2025, 11, 18).getTime());
  assert.equal(span?.to.getTime(), on(2025, 11, 22).getTime());
});

test("with no camera date there is no yardstick, so nothing is judged", () => {
  const batch = [shot(on(2026, 8, 20), "file"), shot(null, "none")];

  assert.equal(trustedSpan(batch), null);
});

const named = (name: string, at: Date | null, dateSource = "exif") => ({
  name,
  takenAt: at,
  dateSource,
});

test("a photo that lost its date takes it from the one beside it", () => {
  const batch = [
    named("IMG_0001.jpg", on(2025, 11, 18)),
    named("IMG_0002.jpg", null, "none"),
    named("IMG_0003.jpg", on(2025, 11, 18)),
  ];

  const inferred = inferDates(batch);

  assert.equal(inferred.size, 1);
  assert.equal(inferred.get(batch[1])?.getTime(), on(2025, 11, 18).getTime());
});

test("the reported case: recopied files borrow from the ones left alone", () => {
  // Twenty files kept their November timestamps; three were recopied last
  // week and got today. No EXIF anywhere -- so the twenty are the trip.
  const batch = [
    ...Array.from({ length: 20 }, (_, i) =>
      named(
        `IMG_${String(i + 1).padStart(4, "0")}.jpg`,
        on(2025, 11, 18),
        "file",
      ),
    ),
    named("IMG_0021.jpg", on(2026, 8, 20), "file"),
    named("IMG_0022.jpg", on(2026, 8, 20), "file"),
    named("IMG_0023.jpg", on(2026, 8, 20), "file"),
  ];

  const inferred = inferDates(batch);

  assert.equal(inferred.size, 3, "only the three strays are redated");
  for (const stray of batch.slice(20)) {
    assert.equal(inferred.get(stray)?.getMonth(), 10, stray.name);
  }

  // And the folder that comes out of it.
  const dated = batch.map((item) => {
    const when = inferred.get(item);
    return when ? { ...item, takenAt: when, dateSource: "nearby" } : item;
  });
  const [trip] = clusterTrips(dated);

  assert.equal(monthLabel(trip.span), "Noviembre");
  assert.equal(yearLabel(trip.span), "2025");
  assert.equal(trip.items.length, 23);
});

test("one camera date anchors the whole batch", () => {
  const batch = [
    named("IMG_0001.jpg", on(2025, 11, 18)),
    named("IMG_0002.jpg", on(2026, 8, 20), "file"),
    named("IMG_0003.jpg", on(2026, 8, 20), "file"),
  ];

  const inferred = inferDates(batch);

  // The camera date wins outright, so both file dates are overruled even
  // though they are the majority.
  assert.equal(inferred.size, 2);
  assert.equal(inferred.get(batch[1])?.getTime(), on(2025, 11, 18).getTime());
});

test("an even split is two trips, not one with stragglers", () => {
  // Picking a winner here would quietly move half the photos to the wrong
  // month. Two journeys uploaded together is a real thing to do.
  const batch = [
    named("a1.jpg", on(2025, 4, 2), "file"),
    named("a2.jpg", on(2025, 4, 3), "file"),
    named("b1.jpg", on(2025, 11, 18), "file"),
    named("b2.jpg", on(2025, 11, 19), "file"),
  ];

  assert.equal(inferDates(batch).size, 0);
  assert.equal(clusterTrips(batch).length, 2);
});

test("each gap takes the closer of its two neighbours", () => {
  const batch = [
    named("IMG_0001.jpg", on(2025, 11, 18)),
    named("IMG_0002.jpg", null, "none"),
    named("IMG_0003.jpg", null, "none"),
    named("IMG_0004.jpg", on(2025, 11, 25)),
  ];

  const inferred = inferDates(batch);

  // 0002 is one step from 0001 and two from 0004; 0003 is the other way
  // round. Each takes the one it sits next to.
  assert.equal(inferred.get(batch[1])?.getTime(), on(2025, 11, 18).getTime());
  assert.equal(inferred.get(batch[2])?.getTime(), on(2025, 11, 25).getTime());
});

test("a photo between two equally close neighbours keeps the earlier", () => {
  // A photo tends to belong with what came before it rather than with what
  // interrupted it, and something has to break the tie.
  const batch = [
    named("IMG_0001.jpg", on(2025, 11, 18)),
    named("IMG_0002.jpg", null, "none"),
    named("IMG_0003.jpg", on(2025, 11, 25)),
  ];

  assert.equal(
    inferDates(batch).get(batch[1])?.getTime(),
    on(2025, 11, 18).getTime(),
  );
});

test("neighbours are found in camera order, not alphabetical order", () => {
  // IMG_10 sorts before IMG_2 alphabetically, which would make the wrong
  // photo its neighbour.
  const batch = [
    named("IMG_2.jpg", on(2025, 11, 18)),
    named("IMG_10.jpg", null, "none"),
    named("IMG_11.jpg", on(2025, 11, 25)),
  ];

  // Numerically IMG_10 sits between IMG_2 and IMG_11, equally close to
  // both, so it keeps the earlier. Sorted as text it would have come
  // first of the three and borrowed from IMG_11 instead.
  assert.equal(
    inferDates(batch).get(batch[1])?.getTime(),
    on(2025, 11, 18).getTime(),
  );
});

test("with no anchor anywhere, no date is invented", () => {
  const batch = [named("a.jpg", null, "none"), named("b.jpg", null, "none")];

  assert.equal(inferDates(batch).size, 0);
});

test("a batch that needs no help is left completely alone", () => {
  const batch = [
    named("a.jpg", on(2025, 11, 18)),
    named("b.jpg", on(2025, 11, 19)),
  ];

  assert.equal(inferDates(batch).size, 0);
});

test("a borrowed date counts for naming the folder", () => {
  // Otherwise the photo would be filed under a trip it is not counted as
  // part of, and the interface would keep calling it undated.
  assert.equal(isTrustedDate("nearby"), true);
  assert.deepEqual(
    undatedFor([named("a.jpg", on(2025, 11, 18), "nearby")]),
    [],
  );
});
