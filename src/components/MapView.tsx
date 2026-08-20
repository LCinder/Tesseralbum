"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { boundsOf, clusterPins, type Cluster, type Pin } from "@/lib/map";

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
  pins,
  onSelect,
}: {
  pins: Pin[];
  onSelect: (cluster: Cluster) => void;
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
        // The stylesheet is not optional: without it Leaflet renders as a pile
        // of unpositioned tiles.
        await import("leaflet/dist/leaflet.css");

        if (disposed || !container.current) return;

        const instance = L.map(container.current, {
          worldCopyJump: true,
          // The default zoom control sits under our own header on mobile.
          zoomControl: true,
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

  // Redraw markers whenever the pins change or the user zooms.
  useEffect(() => {
    if (!ready) return;

    const instance = map.current;
    const layer = markers.current;
    if (!instance || !layer) return;

    let disposed = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed) return;

      const draw = () => {
        layer.clearLayers();

        for (const cluster of clusterPins(pins, instance.getZoom())) {
          const count = cluster.pins.length;
          const size = count > 1 ? 34 : 22;

          const marker = L.marker([cluster.lat, cluster.lng], {
            icon: L.divIcon({
              className: "",
              html: pinHtml(count, cluster.approximate),
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            }),
            keyboard: true,
            title:
              count > 1
                ? `${count} fotos${cluster.approximate ? " · ubicación aproximada" : ""}`
                : cluster.pins[0].name,
          });

          marker.on("click", () => select.current(cluster));
          marker.addTo(layer);
        }
      };

      draw();
      instance.on("zoomend", draw);

      // Fit once to whatever is showing, so a filter change reframes the map.
      const bounds = boundsOf(pins);
      if (bounds) {
        instance.fitBounds(
          [
            [bounds.south, bounds.west],
            [bounds.north, bounds.east],
          ],
          { padding: [20, 20], maxZoom: 14 },
        );
      }

      return () => instance.off("zoomend", draw);
    })();

    return () => {
      disposed = true;
    };
  }, [pins, ready]);

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
 * Marker markup.
 *
 * A hollow ring for an approximate pin and a solid dot for an exact one, so
 * the difference is visible at a glance without reading a legend. Colours come
 * from CSS variables, which keeps the markers correct in both themes.
 */
function pinHtml(count: number, approximate: boolean): string {
  const border = approximate
    ? "border:2px dashed var(--accent);background:var(--paper);color:var(--accent);"
    : "border:2px solid var(--accent);background:var(--accent);color:var(--accent-ink);";

  const label = count > 1 ? String(count) : "";

  return `<div style="
    ${border}
    width:100%;height:100%;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-family:var(--font-plex-mono),monospace;font-size:0.7rem;
    font-variant-numeric:tabular-nums;
    box-shadow:0 1px 4px rgba(0,0,0,0.35);
  ">${label}</div>`;
}
