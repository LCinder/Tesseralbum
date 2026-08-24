"use client";

import { useEffect, useState } from "react";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { cacheSize, clearThumbs } from "@/lib/cache";
import { readQuota } from "@/lib/google/drive";
import { freeBytes, usedFraction, type Quota } from "@/lib/limits";
import { formatBytes } from "@/lib/media";

/**
 * What the archive is costing: Drive quota, and the local thumbnail cache.
 *
 * Worth showing together because they answer different questions — one is
 * "will my next trip fit", the other is "why is this site using disk space".
 */
export function StoragePanel() {
  const { getToken } = useSession();

  const [quota, setQuota] = useState<Quota | null | "loading">("loading");
  const [cache, setCache] = useState<{ count: number; bytes: number } | null>(
    null,
  );
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void readQuota(getToken, { signal: controller.signal })
      .then((found) => {
        if (!cancelled) setQuota(found);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });

    void cacheSize().then((size) => {
      if (!cancelled) setCache(size);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [getToken]);

  async function clear() {
    setClearing(true);
    await clearThumbs();
    setCache(await cacheSize());
    setClearing(false);
  }

  return (
    <>
      <SectionLabel>Espacio</SectionLabel>

      {quota === "loading" && (
        <p className="t-label mb-6 text-ink-soft" role="status">
          Consultando…
        </p>
      )}

      {quota === null && (
        <p className="mb-6 text-[0.95rem] text-ink-soft">
          Tu cuenta no declara un límite de almacenamiento.
        </p>
      )}

      {quota && quota !== "loading" && (
        <div className="mb-8">
          <div
            className="mb-2 h-2 w-full overflow-hidden bg-surface-2"
            role="img"
            aria-label={`${Math.round(usedFraction(quota) * 100)} por ciento usado`}
          >
            <div
              className="h-full bg-accent"
              style={{ width: `${usedFraction(quota) * 100}%` }}
            />
          </div>

          <p className="text-[0.95rem] tabular-nums">
            {formatBytes(quota.usedBytes)} de {formatBytes(quota.limitBytes)}{" "}
            usados · <strong>{formatBytes(freeBytes(quota))} libres</strong>
          </p>

          <p className="mt-1 text-[0.9rem] text-ink-soft">
            De eso, {formatBytes(quota.driveBytes)} son ficheros de Drive. El
            resto lo ocupan Gmail y Google Photos, que comparten la misma cuota
            — y la papelera sigue contando hasta que la vacías.
          </p>
        </div>
      )}

      <SectionLabel>Caché local</SectionLabel>

      <p className="mb-3 max-w-lg text-[0.95rem] text-ink-soft">
        Las miniaturas que ya has visto se guardan en este navegador para que el
        álbum abra al instante la próxima vez. Borrarlas no toca tu Drive: se
        vuelven a descargar cuando hagan falta.
      </p>

      <div className="flex flex-wrap items-baseline gap-4">
        <p className="text-[0.95rem] tabular-nums">
          {cache === null
            ? "…"
            : cache.count === 0
              ? "Vacía"
              : `${cache.count} ${cache.count === 1 ? "imagen" : "imágenes"} · ${formatBytes(cache.bytes)}`}
        </p>

        {cache !== null && cache.count > 0 && (
          <button
            type="button"
            onClick={clear}
            disabled={clearing}
            className="t-label cursor-pointer text-accent hover:underline disabled:cursor-wait disabled:opacity-60"
          >
            {clearing ? "Borrando…" : "Vaciar caché"}
          </button>
        )}
      </div>
    </>
  );
}
