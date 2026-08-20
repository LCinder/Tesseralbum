"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Place } from "@/lib/catalog";
import { boundsOf, overlapping } from "@/lib/map";

/**
 * Leaflet, driven directly rather than through a React wrapper.
 *
 * Leaflet owns its own DOM and mutates it imperatively, which is exactly what
 * React wrappers spend their effort papering over. Calling it from an effect
 * is less code and has no version-compatibility surface.
 *
 * Both the library and its stylesheet load on demand: 150 KB has no business
 * in the bundle of someone who only ever looks at one album.
 */
export function MapView({
  places,
  selectedId,
  onSelect,
}: {
  places: Place[];
  selectedId: string | null;
  onSelect: (place: Place) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);

  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Read inside the redraw effect without making it a dependency: a new
  // callback identity should not tear down every marker. Assigned in an
  // effect, because a ref must not be written during render.
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        // Not optional: without the stylesheet Leaflet renders as a pile of
        // unpositioned tiles.
        await import("leaflet/dist/leaflet.css");

        if (disposed || !container.current) return;

        const instance = L.map(container.current, {
          worldCopyJump: true,
        }).setView([20, 0], 2);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(instance);

        markers.current = L.layerGroup().addTo(instance);
        map.current = instance;
        setReady(true);
      } catch {
        if (!disposed) setProblem("No se pudo cargar el mapa.");
      }
    })();

    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      markers.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const instance = map.current;
    const layer = markers.current;
    if (!instance || !layer) return;

    let disposed = false;
    let detach: (() => void) | undefined;

    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed) return;

      const draw = () => {
        layer.clearLayers();

        // Labels are hidden where markers would collide, but every place keeps
        // its own pin: each one leads to a different album.
        const crowded = overlapping(places, instance.getZoom());

        for (const place of places) {
          const marker = L.marker([place.lat, place.lng], {
            icon: L.divIcon({
              className: "",
              html: pinHtml(place.city, {
                labelled: !crowded.has(place.id),
                active: place.id === selectedId,
              }),
              // Generous box so the label has room; the anchor puts the dot,
              // not the box, on the coordinates.
              iconSize: [160, 34],
              iconAnchor: [80, 17],
            }),
            keyboard: true,
            title: `${place.city} · ${place.country}`,
          });

          marker.on("click", () => select.current(place));
          marker.addTo(layer);
        }
      };

      draw();
      instance.on("zoomend", draw);
      detach = () => instance.off("zoomend", draw);

      const bounds = boundsOf(places);
      if (bounds) {
        instance.fitBounds(
          [
            [bounds.south, bounds.west],
            [bounds.north, bounds.east],
          ],
          { padding: [30, 30], maxZoom: 9 },
        );
      }
    })();

    return () => {
      disposed = true;
      detach?.();
    };
  }, [places, ready, selectedId]);

  if (problem) {
    return (
      <p
        role="alert"
        className="border-l-[3px] border-accent bg-accent-bg px-4 py-3 text-[0.95rem]"
      >
        {problem}
      </p>
    );
  }

  return (
    <div className="relative">
      <div
        ref={container}
        className="h-[60vh] min-h-[20rem] w-full border border-rule bg-surface-2"
      />
      {!ready && (
        <p
          className="t-label absolute inset-0 flex items-center justify-center text-ink-soft"
          role="status"
        >
          Cargando el mapa…
        </p>
      )}
    </div>
  );
}

/**
 * A dot with the city name beside it.
 *
 * Colours come from CSS variables so the markers stay legible in both themes,
 * and the label carries its own background because it sits over map tiles of
 * unpredictable colour.
 */
function pinHtml(
  city: string,
  { labelled, active }: { labelled: boolean; active: boolean },
): string {
  const dot = `
    width:14px;height:14px;border-radius:50%;flex:none;
    background:var(--accent);
    border:2px solid var(--paper);
    box-shadow:0 1px 4px rgba(0,0,0,0.4);
    ${active ? "transform:scale(1.35);" : ""}
  `;

  const label = labelled
    ? `<span style="
        background:var(--paper);color:var(--ink);
        padding:1px 6px;border-radius:2px;white-space:nowrap;
        font-family:var(--font-archivo),sans-serif;
        font-size:0.75rem;font-weight:600;
        box-shadow:0 1px 3px rgba(0,0,0,0.25);
        ${active ? "outline:2px solid var(--accent);" : ""}
      ">${escapeHtml(city)}</span>`
    : "";

  return `<div style="
    display:flex;align-items:center;gap:5px;
    width:100%;height:100%;justify-content:center;
  "><span style="${dot}"></span>${label}</div>`;
}

/** City names are user data and land in an HTML string. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
