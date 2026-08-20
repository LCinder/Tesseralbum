"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { readNotes, saveNotes } from "@/lib/notes";

/**
 * The diary entry for one trip.
 *
 * Saves on a pause rather than behind a button: writing about a trip is the
 * part people abandon, and a save button is one more reason to. A short delay
 * after typing stops means one request per thought, not one per keystroke.
 */

const SAVE_AFTER_MS = 1500;

type State = "loading" | "idle" | "saving" | "saved" | "failed";

export function TripNotes({ folderId }: { folderId: string }) {
  const { getToken } = useSession();

  const [text, setText] = useState("");
  const [state, setState] = useState<State>("loading");
  const [editing, setEditing] = useState(false);

  const fileId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What is already in Drive, so a save that changes nothing is skipped.
  const saved = useRef("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const found = await readNotes(getToken, folderId, {
          signal: controller.signal,
        });
        if (cancelled) return;

        fileId.current = found.fileId;
        saved.current = found.text;
        setText(found.text);
        setState("idle");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [getToken, folderId]);

  async function persist(value: string) {
    if (value === saved.current) return;

    setState("saving");
    try {
      fileId.current = await saveNotes(
        getToken,
        folderId,
        value,
        fileId.current,
      );
      saved.current = value;
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  function onChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setText(value);
    setState("idle");

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(value), SAVE_AFTER_MS);
  }

  function onBlur() {
    // Leaving the field is a stronger signal than a pause; do not make the
    // user wait out the timer to know their words are safe.
    if (timer.current) clearTimeout(timer.current);
    void persist(text);
    if (text.trim() === "") setEditing(false);
  }

  if (state === "loading") {
    return (
      <p className="t-label mb-4 text-ink-soft" role="status">
        Leyendo las notas…
      </p>
    );
  }

  // Nothing written yet, and not being written: an empty box every trip would
  // be noise in a page meant for looking at photos.
  if (!editing && text.trim() === "") {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="t-label mb-4 cursor-pointer text-ink-soft hover:text-accent hover:underline"
      >
        + Escribir sobre este viaje
      </button>
    );
  }

  if (!editing) {
    return (
      <div className="mb-6 border-l-[3px] border-rule pl-4">
        {/* Preserving newlines rather than rendering Markdown: the file is
            Markdown so it reads well in Drive, but a paragraph of holiday
            notes needs no renderer. */}
        <p className="whitespace-pre-wrap text-[1.05rem] leading-relaxed">
          {text}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="t-label mt-2 cursor-pointer text-ink-soft hover:text-accent hover:underline"
        >
          Editar
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <textarea
        value={text}
        onChange={onChange}
        onBlur={onBlur}
        autoFocus
        rows={5}
        placeholder="Qué pasó, con quién, qué comisteis…"
        className="w-full resize-y border border-rule bg-surface px-3 py-2 text-[1.05rem] leading-relaxed"
      />

      <div className="mt-1 flex items-baseline justify-between gap-4">
        <span className="t-label text-ink-soft" role="status">
          {state === "saving" && "Guardando…"}
          {state === "saved" && "Guardado en Drive"}
          {state === "failed" && (
            <span className="text-accent">No se pudo guardar</span>
          )}
        </span>

        <button
          type="button"
          onClick={() => {
            onBlur();
            setEditing(false);
          }}
          className="t-label cursor-pointer text-accent hover:underline"
        >
          Hecho
        </button>
      </div>
    </div>
  );
}
