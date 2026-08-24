import { shotDate } from "@/lib/gallery";
import {
  listEverything,
  update,
  type DriveFile,
  type TokenSource,
} from "@/lib/google/drive";
import { forget, memo } from "@/lib/memo";
import {
  clusterTrips,
  disambiguate,
  monthLabel,
  spanFromProperties,
  spanToProperties,
  yearLabel,
  type DateSpan,
} from "@/lib/trips";

/**
 * Putting right the folders that were named before the dates were understood.
 *
 * Trip folders carry the span they cover in their own properties, and were
 * named from it at upload time. When that span was drawn from `File.lastModified`
 * — reset to *now* by copying a file — the folder ended up claiming a trip that
 * ran from November to today.
 *
 * Nothing here reads anything new: the photos already say when they were taken,
 * and the same clustering the uploader uses re-derives the answer from them. So
 * a survey costs the two listings the app already caches, and only a folder that
 * is genuinely wrong costs a write.
 */

/** One folder whose own photos disagree with what it says about itself. */
export type Fix = {
  folderId: string;
  /** The name it has now. */
  name: string;
  /** The name it should have — equal to `name` when only the dates were wrong. */
  rename: string;
  /** The span its photos actually cover. */
  span: DateSpan;
  photos: number;
  /**
   * Set when the year folder holding it no longer matches its dates. A rename
   * cannot fix that, so it is reported rather than acted on.
   */
  wrongYear?: { holding: string; wanted: string };
};

/** A folder holding more than one journey — renaming cannot separate them. */
export type Mixed = { name: string; year: string; trips: number };

export type Survey = {
  /** The folders to rewrite, each with the name it should end up with. */
  fixes: Fix[];
  /** Trip folders looked at. */
  examined: number;
  mixed: Mixed[];
  /** Folders whose photos carry no date worth trusting; left alone. */
  undatable: number;
};

/** Photos grouped by the folder they sit in, which is their trip. */
function contentsOf(media: DriveFile[]): Map<string, DriveFile[]> {
  const grouped = new Map<string, DriveFile[]>();

  for (const file of media) {
    const parent = file.parents?.[0];
    if (!parent) continue;

    const found = grouped.get(parent);
    if (found) found.push(file);
    else grouped.set(parent, [file]);
  }

  return grouped;
}

/** Folder names already spoken for, per parent, so a rename cannot collide. */
function namesInUse(folders: DriveFile[]): Map<string, Set<string>> {
  const taken = new Map<string, Set<string>>();

  for (const folder of folders) {
    const parent = folder.parents?.[0];
    if (!parent) continue;

    const names = taken.get(parent) ?? new Set<string>();
    names.add(folder.name);
    taken.set(parent, names);
  }

  return taken;
}

/**
 * Works out what would have to change, given the archive as it stands.
 *
 * Pure, and the whole of the decision: everything subtle about this feature is
 * here rather than behind a network call, so it can be tested against a folder
 * tree written out by hand.
 */
export function planFixes({
  folders,
  media,
}: {
  folders: DriveFile[];
  media: DriveFile[];
}): Survey {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const contents = contentsOf(media);
  const taken = namesInUse(folders);

  const fixes: Fix[] = [];
  const mixed: Mixed[] = [];
  let examined = 0;
  let undatable = 0;

  for (const folder of folders) {
    // Only folders we made and dated. Anything created by hand in Drive has no
    // span to be wrong about, and guessing at one would be inventing a trip.
    const stored = spanFromProperties(folder.appProperties);
    if (!stored) continue;

    examined += 1;

    const parent = folder.parents?.[0] ?? "";
    const year = byId.get(parent)?.name ?? "";

    // The same clustering the uploader does, on the dates the photos carry —
    // which for a photo whose name holds the date is now read back out of it.
    const clusters = clusterTrips(
      (contents.get(folder.id) ?? []).map(shotDate),
    );

    if (clusters.length === 0) {
      undatable += 1;
      continue;
    }

    // Two journeys filed together, from before a selection was split by its
    // gaps. Renaming would make it worse: the folder would claim to be one of
    // them while holding both. Separating them means moving files, which is a
    // heavier and more destructive operation than this button promises.
    if (clusters.length > 1) {
      mixed.push({ name: folder.name, year, trips: clusters.length });
      continue;
    }

    const span = clusters[0].span;
    const wanted = monthLabel(span);

    const sameSpan =
      stored.from.getTime() === span.from.getTime() &&
      stored.to.getTime() === span.to.getTime();

    if (sameSpan && wanted === folder.name) continue;

    // Its own name is not an obstacle to keeping it, but a sibling's is.
    const siblings = new Set(taken.get(parent) ?? []);
    siblings.delete(folder.name);

    const rename =
      wanted === folder.name
        ? folder.name
        : disambiguate(wanted, [...siblings]);

    // Reserved as the plan is built, so two folders collapsing onto the same
    // month do not both try to claim it.
    if (rename !== folder.name) {
      const names = taken.get(parent);
      names?.delete(folder.name);
      names?.add(rename);
    }

    const wantedYear = yearLabel(span);

    fixes.push({
      folderId: folder.id,
      name: folder.name,
      rename,
      span,
      photos: clusters[0].items.length,
      ...(year && wantedYear !== year
        ? { wrongYear: { holding: year, wanted: wantedYear } }
        : {}),
    });
  }

  return { fixes, examined, mixed, undatable };
}

/**
 * The same answer, for the archive in Drive.
 *
 * Read-only and safe to run at any time — it is what the button shows before
 * asking. The listing is the memoised one the passport already fetches, so
 * running this straight after visiting that page usually costs nothing.
 */
export async function surveyTrips(
  getToken: TokenSource,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Survey> {
  return planFixes(
    await memo("everything", () => listEverything(getToken, { signal })),
  );
}

/**
 * The PATCH body for one fix.
 *
 * The name is left out when unchanged, so a folder whose only problem was its
 * stored dates is not rewritten under the name it already had.
 */
export function changesFor(fix: Fix): {
  name?: string;
  appProperties: Record<string, string>;
} {
  return {
    ...(fix.rename !== fix.name ? { name: fix.rename } : {}),
    appProperties: spanToProperties(fix.span),
  };
}

/**
 * Writes the plan. One request per folder, and only for folders in the plan.
 *
 * Stops on the first failure rather than pressing on: a rename that fails
 * because the token expired will fail for every folder after it too, and
 * fifty identical errors are less use than one.
 */
export async function applyFixes(
  getToken: TokenSource,
  fixes: Fix[],
  {
    onProgress,
    signal,
  }: { onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<number> {
  let done = 0;

  try {
    for (const fix of fixes) {
      if (signal?.aborted) break;

      await update(getToken, fix.folderId, changesFor(fix));

      done += 1;
      onProgress?.(done);
    }
  } finally {
    // Every cached listing mentioned these folders by their old names. Done in
    // `finally` because a run that stopped half way through still changed some.
    if (done > 0) forget();
  }

  return done;
}
