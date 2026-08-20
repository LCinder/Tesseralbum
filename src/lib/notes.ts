import {
  findChild,
  readText,
  writeText,
  type TokenSource,
} from "@/lib/google/drive";

/**
 * The diary: one Markdown file per trip, living in the trip's own folder.
 *
 * A file rather than a field, for the same reason the catalogue is a JSON file
 * next to the photos: it stays readable and editable in Drive itself, and it
 * travels with the photos if the folder is ever moved or shared.
 */

export const NOTES_NAME = "notas.md";

/** The note for a trip, or an empty string when there is none yet. */
export async function readNotes(
  getToken: TokenSource,
  folderId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ text: string; fileId: string | null }> {
  const existing = await findChild(getToken, folderId, NOTES_NAME, {
    folder: false,
  });

  if (!existing) return { text: "", fileId: null };

  return {
    text: await readText(getToken, existing.id, { signal }),
    fileId: existing.id,
  };
}

/**
 * Saves the note, creating the file on first write.
 *
 * An emptied note deletes nothing: an empty file is honest about having been
 * written, and removing it would be a surprising amount of destruction for
 * clearing a text box.
 */
export async function saveNotes(
  getToken: TokenSource,
  folderId: string,
  text: string,
  fileId: string | null,
): Promise<string> {
  const written = await writeText(
    getToken,
    text,
    fileId ? { fileId } : { parentId: folderId, name: NOTES_NAME },
  );

  return written.id;
}
