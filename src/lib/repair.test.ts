import assert from "node:assert/strict";
import test from "node:test";
import type { DriveFile } from "./google/drive";
import { changesFor, planFixes, planTripDate } from "./repair";
import { spanToProperties } from "./trips";

/**
 * The planning is pure, so a folder tree can be written out by hand. Only the
 * fetching and the PATCHing are left over, and neither makes a decision.
 */

const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0);

const FOLDER_MIME = "application/vnd.google-apps.folder";

function folder(
  id: string,
  name: string,
  parent?: string,
  span?: { from: Date; to: Date },
): DriveFile {
  return {
    id,
    name,
    mimeType: FOLDER_MIME,
    parents: parent ? [parent] : undefined,
    appProperties: span ? spanToProperties(span) : undefined,
  };
}

function photo(
  id: string,
  name: string,
  parent: string,
  takenAt: Date | null,
  dateSource = "exif",
): DriveFile {
  return {
    id,
    name,
    mimeType: "image/jpeg",
    parents: [parent],
    appProperties: {
      ...(takenAt ? { takenAt: takenAt.toISOString() } : {}),
      dateSource,
    },
  };
}

/** Ireland 2025: a real November trip plus one photo copied last week. */
const IRELAND = {
  folders: [
    folder("root", "Tesseralbum"),
    folder("ie", "Irlanda", "root"),
    folder("y2025", "2025", "ie"),
    folder("trip", "Noviembre-Agosto", "y2025", {
      from: at(2025, 11, 18),
      to: at(2026, 8, 20),
    }),
  ],
  media: [
    photo("p1", "IMG_0001.jpg", "trip", at(2025, 11, 18)),
    photo("p2", "IMG_0002.jpg", "trip", at(2025, 11, 22)),
    photo("p3", "copiada.jpg", "trip", at(2026, 8, 20), "file"),
  ],
};

test("the reported folder is renamed from its own photos", () => {
  const survey = planFixes(IRELAND);

  assert.equal(survey.examined, 1);
  assert.equal(survey.fixes.length, 1);

  const [fix] = survey.fixes;
  assert.equal(fix.name, "Noviembre-Agosto");
  assert.equal(fix.rename, "Noviembre");
  assert.equal(
    fix.span.to.getMonth(),
    10,
    "the file date must not set the end",
  );
  assert.equal(fix.span.to.getDate(), 22);
  assert.equal(fix.photos, 3, "the misdated photo stays in the folder");
  assert.equal(fix.wrongYear, undefined);
});

test("the write carries both the new name and the corrected dates", () => {
  const [fix] = planFixes(IRELAND).fixes;

  assert.deepEqual(changesFor(fix), {
    name: "Noviembre",
    appProperties: spanToProperties({
      from: at(2025, 11, 18),
      to: at(2025, 11, 22),
    }),
  });
});

test("a folder that is already right is not touched", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre", "y2025", {
        from: at(2025, 11, 18),
        to: at(2025, 11, 22),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2025, 11, 18)),
      photo("p2", "b.jpg", "trip", at(2025, 11, 22)),
    ],
  });

  assert.equal(survey.examined, 1);
  assert.deepEqual(survey.fixes, []);
});

test("a right name over wrong dates is fixed without resending the name", () => {
  // The name only carries months, so "Noviembre" hides a stored span reaching
  // to the 30th. Left alone, the next upload would compare against that.
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre", "y2025", {
        from: at(2025, 11, 18),
        to: at(2025, 11, 30),
      }),
    ],
    media: [photo("p1", "a.jpg", "trip", at(2025, 11, 18))],
  });

  assert.equal(survey.fixes.length, 1);
  assert.equal(survey.fixes[0].rename, "Noviembre", "the name is kept");

  const changes = changesFor(survey.fixes[0]);
  assert.equal(changes.name, undefined, "an unchanged name is not resent");
  assert.ok(changes.appProperties);
});

test("a folder holding two journeys is reported, not renamed", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Abril-Noviembre", "y2025", {
        from: at(2025, 4, 2),
        to: at(2025, 11, 22),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2025, 4, 2)),
      photo("p2", "b.jpg", "trip", at(2025, 11, 22)),
    ],
  });

  assert.deepEqual(survey.fixes, []);
  assert.equal(survey.mixed.length, 1);
  assert.equal(survey.mixed[0].trips, 2);
  assert.equal(survey.mixed[0].year, "2025");
});

test("a rename that would collide with a sibling is numbered instead", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("other", "Noviembre", "y2025", {
        from: at(2025, 11, 1),
        to: at(2025, 11, 4),
      }),
      folder("trip", "Noviembre-Agosto", "y2025", {
        from: at(2025, 11, 25),
        to: at(2026, 8, 20),
      }),
    ],
    media: [
      photo("p0", "z.jpg", "other", at(2025, 11, 1)),
      photo("p1", "a.jpg", "trip", at(2025, 11, 25)),
      photo("p2", "b.jpg", "trip", at(2026, 8, 20), "file"),
    ],
  });

  const fix = survey.fixes.find((candidate) => candidate.folderId === "trip");

  assert.ok(fix);
  assert.equal(fix.rename, "Noviembre (2)");
});

test("two folders collapsing onto the same month do not both claim it", () => {
  // Both are misdated and both recompute to November. Without reserving the
  // name as the plan is built, the second would be told it is free.
  const span = { from: at(2025, 11, 1), to: at(2026, 8, 20) };
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("a", "Noviembre-Agosto", "y2025", span),
      folder("b", "Noviembre-Agosto (2)", "y2025", span),
    ],
    media: [
      photo("p1", "a.jpg", "a", at(2025, 11, 1)),
      photo("p2", "b.jpg", "a", at(2026, 8, 20), "file"),
      photo("p3", "c.jpg", "b", at(2025, 11, 3)),
      photo("p4", "d.jpg", "b", at(2026, 8, 20), "file"),
    ],
  });

  const names = survey.fixes.map((fix) => fix.rename);

  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2, `both claimed ${names.join(" and ")}`);
});

test("folders we did not date are not ours to rename", () => {
  // No span properties: made by hand in Drive, or by an older version. The
  // repair must not invent a trip for it.
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("mine", "Fotos sueltas", "y2025"),
    ],
    media: [photo("p1", "a.jpg", "mine", at(2025, 11, 18))],
  });

  assert.equal(survey.examined, 0);
  assert.deepEqual(survey.fixes, []);
});

test("a trip with nothing but weak dates is handed back to the traveller", () => {
  const survey = planFixes({
    folders: [
      folder("y2026", "2026"),
      folder("trip", "Agosto", "y2026", {
        from: at(2026, 8, 20),
        to: at(2026, 8, 20),
      }),
    ],
    media: [photo("p1", "sin-pistas.jpg", "trip", at(2026, 8, 20), "file")],
  });

  // Nothing to measure against, so nothing is rewritten on its own — but it
  // is not silently blessed either.
  assert.deepEqual(survey.fixes, []);
  assert.equal(survey.unverifiable.length, 1);
});

test("an empty trip folder is reported, not stripped of its dates", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre", "y2025", {
        from: at(2025, 11, 18),
        to: at(2025, 11, 22),
      }),
    ],
    media: [],
  });

  assert.equal(survey.undatable, 1);
  assert.deepEqual(survey.fixes, []);
});

test("a filename date repairs a photo whose stored date was the copy day", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre-Agosto", "y2025", {
        from: at(2025, 11, 18),
        to: at(2026, 8, 20),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2025, 11, 18)),
      // WhatsApp stripped the EXIF, the mtime is the day it was forwarded, and
      // the real date is still sitting in the name.
      photo("p2", "IMG-20251119-WA0012.jpg", "trip", at(2026, 8, 20), "file"),
    ],
  });

  assert.equal(survey.fixes.length, 1);
  assert.equal(survey.fixes[0].rename, "Noviembre");
  assert.equal(survey.fixes[0].span.to.getDate(), 19);
});

test("a trip whose year folder no longer matches says so", () => {
  // Every photo was misdated at upload, so the span started on the copy day
  // and the trip was filed under the wrong year entirely.
  const survey = planFixes({
    folders: [
      folder("y2026", "2026"),
      folder("trip", "Agosto", "y2026", {
        from: at(2026, 8, 20),
        to: at(2026, 8, 20),
      }),
    ],
    media: [
      photo("p1", "IMG-20251118-WA0001.jpg", "trip", at(2026, 8, 20), "file"),
      photo("p2", "IMG-20251119-WA0002.jpg", "trip", at(2026, 8, 20), "file"),
    ],
  });

  assert.equal(survey.fixes.length, 1);
  assert.deepEqual(survey.fixes[0].wrongYear, {
    holding: "2026",
    wanted: "2025",
  });
  assert.equal(survey.fixes[0].rename, "Noviembre");
});

test("nothing in an empty archive", () => {
  assert.deepEqual(planFixes({ folders: [], media: [] }), {
    fixes: [],
    examined: 0,
    mixed: [],
    unverifiable: [],
    undatable: 0,
  });
});

test("a trip with no camera date at all is not passed off as correct", () => {
  // The bug the user hit: every photo fell back to the day it was copied, so
  // the folder and the photos agreed with each other and were both wrong. The
  // survey said "todo correcto" and offered nothing.
  const survey = planFixes({
    folders: [
      folder("y2026", "2026"),
      folder("trip", "Agosto", "y2026", {
        from: at(2026, 8, 20),
        to: at(2026, 8, 20),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2026, 8, 20), "file"),
      photo("p2", "b.jpg", "trip", at(2026, 8, 20), "file"),
    ],
  });

  assert.deepEqual(survey.fixes, []);
  assert.equal(survey.examined, 1);
  assert.equal(survey.unverifiable.length, 1);
  assert.deepEqual(survey.unverifiable[0].photoIds, ["p1", "p2"]);
  assert.equal(survey.unverifiable[0].name, "Agosto");
  assert.equal(survey.unverifiable[0].year, "2026");
});

test("file dates weeks apart are one trip, named after most of them", () => {
  // Files stored since November plus one recopied last week, and no camera
  // date anywhere. Most of the timestamps agree, so they are the trip and
  // the stray borrows from its neighbour -- no question to answer.
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre-Agosto", "y2025", {
        from: at(2025, 11, 18),
        to: at(2026, 8, 20),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2025, 11, 18), "file"),
      photo("p2", "b.jpg", "trip", at(2025, 11, 22), "file"),
      photo("p3", "c.jpg", "trip", at(2026, 8, 20), "file"),
    ],
  });

  assert.deepEqual(survey.mixed, []);
  assert.deepEqual(survey.unverifiable, []);
  assert.equal(survey.fixes.length, 1);
  assert.equal(survey.fixes[0].rename, "Noviembre");
  assert.equal(survey.fixes[0].photos, 3);
});

test("one camera date is enough to fix the folder without asking", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre-Agosto", "y2025", {
        from: at(2025, 11, 18),
        to: at(2026, 8, 20),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2025, 11, 18)),
      photo("p2", "b.jpg", "trip", at(2026, 8, 20), "file"),
    ],
  });

  assert.deepEqual(survey.unverifiable, []);
  assert.equal(survey.fixes.length, 1);
  assert.equal(survey.fixes[0].rename, "Noviembre");
});

test("a typed date names the folder and dates every photo in it", () => {
  const trip = {
    folderId: "trip",
    name: "Agosto",
    year: "2026",
    photoIds: ["p1", "p2", "p3"],
    siblings: [],
  };

  const plan = planTripDate(trip, at(2025, 11, 18));

  assert.equal(plan.rename, "Noviembre");
  assert.equal(plan.photos, 3);
  assert.equal(plan.span.from.getTime(), at(2025, 11, 18).getTime());
  assert.equal(plan.span.to.getTime(), at(2025, 11, 18).getTime());
  assert.deepEqual(plan.wrongYear, { holding: "2026", wanted: "2025" });
});

test("a typed date that keeps the folder's name is not a rename", () => {
  const plan = planTripDate(
    {
      folderId: "trip",
      name: "Noviembre",
      year: "2025",
      photoIds: ["p1"],
      siblings: [],
    },
    at(2025, 11, 20),
  );

  assert.equal(plan.rename, "Noviembre");
  assert.equal(plan.wrongYear, undefined);
});

test("a typed date avoids a sibling that already holds the name", () => {
  const plan = planTripDate(
    {
      folderId: "trip",
      name: "Agosto",
      year: "2025",
      photoIds: ["p1"],
      siblings: ["Noviembre"],
    },
    at(2025, 11, 18),
  );

  assert.equal(plan.rename, "Noviembre (2)");
});

test("nothing wrong reads as nothing wrong", () => {
  const survey = planFixes({
    folders: [
      folder("y2025", "2025"),
      folder("trip", "Noviembre", "y2025", {
        from: at(2025, 11, 18),
        to: at(2025, 11, 22),
      }),
    ],
    media: [
      photo("p1", "a.jpg", "trip", at(2025, 11, 18)),
      photo("p2", "b.jpg", "trip", at(2025, 11, 22)),
    ],
  });

  assert.deepEqual(survey.fixes, []);
  assert.deepEqual(survey.mixed, []);
  assert.deepEqual(survey.unverifiable, []);
  assert.equal(survey.undatable, 0);
});
