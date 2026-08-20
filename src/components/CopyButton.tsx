"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copies a value to the clipboard and says so for a moment.
 *
 * The Clipboard API needs a secure context, which localhost and any https
 * deployment both satisfy. When it is refused anyway — a permission prompt
 * denied, an odd browser — the value is shown so it can be selected by hand,
 * because a copy button that silently does nothing is worse than none.
 */
export function CopyButton({
  value,
  label = "Copiar URL",
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);

    try {
      await navigator.clipboard.writeText(value);
      setState("done");
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  if (state === "failed") {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="t-label text-accent">Cópiala a mano</span>
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="w-56 border border-rule bg-surface px-2 py-1 font-mono text-xs"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="t-label shrink-0 cursor-pointer text-accent hover:underline"
    >
      {state === "done" ? "¡Copiada!" : label}
    </button>
  );
}
