"use client";

import { useEffect, useRef, useState } from "react";
import {
  ATTRIBUTION,
  SEARCH_DEBOUNCE_MS,
  search,
  type Found,
} from "@/lib/geocode";

/**
 * Type a city, pick it from the list, done.
 *
 * Replaces five hand-typed fields — city, country, ISO code, latitude,
 * longitude — with one search box, so the coordinates come from a gazetteer
 * instead of from copying numbers out of Google Maps.
 */
export function PlaceSearch({
  onPick,
  selected,
  onClear,
}: {
  onPick: (place: Found) => void;
  selected: Found | null;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Keeps the previous request from delivering after a newer one; without it,
  // fast typing shows results for a query the user already replaced.
  const inFlight = useRef<AbortController | null>(null);

  /**
   * Clearing on a too-short query happens here rather than in the effect.
   * Setting state straight from an effect body costs an extra render pass,
   * and an event handler is where a reset belongs anyway.
   */
  function onQueryChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setQuery(next);

    if (next.trim().length < 2) {
      inFlight.current?.abort();
      setResults([]);
      setSearched(false);
      setProblem(null);
      setSearching(false);
    }
  }

  useEffect(() => {
    if (selected) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const timer = setTimeout(async () => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setSearching(true);
      setProblem(null);
      try {
        const found = await search(trimmed, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResults(found);
        setSearched(true);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setResults([]);
        setProblem(
          cause instanceof Error
            ? cause.message
            : "No se pudo buscar el lugar.",
        );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, selected]);

  useEffect(() => () => inFlight.current?.abort(), []);

  if (selected) {
    return (
      <div className="flex flex-col gap-1">
        <span className="t-label text-ink-soft">Lugar</span>
        <div className="flex items-start justify-between gap-4 border border-teal bg-teal-bg px-3 py-2">
          <div>
            <p className="t-display font-semibold">
              {selected.city}
              <span className="ml-2 font-normal text-ink-soft">
                {selected.country}
              </span>
            </p>
            <p className="mt-0.5 font-mono text-xs text-ink-soft tabular-nums">
              {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)} ·{" "}
              {selected.countryCode}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClear();
              setQuery("");
              setResults([]);
              setSearched(false);
            }}
            className="t-label shrink-0 cursor-pointer text-accent hover:underline"
          >
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="t-label text-ink-soft">
          Lugar
          <span className="ml-2 normal-case tracking-normal">
            escribe la ciudad y elige
          </span>
        </span>
        <input
          value={query}
          onChange={onQueryChange}
          placeholder="Kioto"
          autoComplete="off"
          className="w-full border border-rule bg-surface px-3 py-2"
        />
      </label>

      {searching && (
        <p className="t-label text-ink-soft" role="status">
          Buscando…
        </p>
      )}

      {problem && (
        <p role="alert" className="text-sm text-accent">
          {problem}
        </p>
      )}

      {!searching && searched && results.length === 0 && (
        <p className="text-sm text-ink-soft">
          Sin resultados. Prueba solo con el nombre de la ciudad, o usa las
          coordenadas a mano más abajo.
        </p>
      )}

      {results.length > 0 && (
        <ul className="border border-rule bg-surface">
          {results.map((place) => (
            <li key={place.key} className="border-b border-rule last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  onPick(place);
                  setResults([]);
                }}
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-2"
              >
                <span className="t-display font-semibold">{place.city}</span>
                <span className="text-xs text-ink-soft">{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(results.length > 0 || searched) && (
        <p className="t-label text-ink-soft">{ATTRIBUTION}</p>
      )}
    </div>
  );
}
