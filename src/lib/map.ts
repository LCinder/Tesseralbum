import type { Place } from "@/lib/catalog";

/**
 * Turning places into pins on a map.
 *
 * One pin per place, not per photo. The coordinates come from the catalogue,
 * which is already in memory, so the map draws itself without reading a single
 * photo — and clicking a pin goes to that city's album rather than trying to
 * be an album itself.
 *
 * Previews are a few photos per place, fetched as small independent queries.
 * The alternative — listing every photo everywhere to group them client-side —
 * costs one round trip per hundred files for a picture that only ever shows
 * one dot per city.
 */

export type Preview = {
  id: string;
  name: string;
  thumbnailLink?: string;
  mimeType: string;
};

export type PlacePin = {
  place: Place;
  previews: Preview[];
  /** True until its previews have been fetched. */
  loading: boolean;
};

export type Bounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/**
 * A box containing every pin, with a little air around it.
 *
 * Returns `null` for an empty set rather than a degenerate box, so the caller
 * shows the whole world instead of zooming to nowhere.
 */
export function boundsOf(places: Place[]): Bounds | null {
  if (places.length === 0) return null;

  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;

  for (const place of places) {
    south = Math.min(south, place.lat);
    north = Math.max(north, place.lat);
    west = Math.min(west, place.lng);
    east = Math.max(east, place.lng);
  }

  // A single place has no extent, and fitting a zero-size box zooms to
  // maximum, which lands the viewer on a street corner.
  const padLat = Math.max((north - south) * 0.1, 0.4);
  const padLng = Math.max((east - west) * 0.1, 0.4);

  return {
    south: Math.max(-90, south - padLat),
    north: Math.min(90, north + padLat),
    west: Math.max(-180, west - padLng),
    east: Math.min(180, east + padLng),
  };
}

/**
 * Places whose markers would sit on top of each other at the given zoom.
 *
 * Only used to hide labels when they would collide: two nearby cities still
 * get two pins, because each leads to a different album. Merging them would
 * hide a destination behind a number.
 *
 * Pairwise distance rather than a grid, because a grid has a boundary problem
 * — Dublín and Cork are 160 km apart but land either side of a cell edge, so
 * a grid calls them far apart at the very zoom where they overlap. There are
 * dozens of places at most, so comparing every pair costs nothing.
 */
export function overlapping(places: Place[], zoom: number): Set<string> {
  // Degrees covered by roughly 40 screen pixels at this zoom: 360 degrees span
  // 256 pixels at zoom 0, doubling each level.
  const threshold = (360 / (256 * 2 ** zoom)) * 40;

  const crowded = new Set<string>();

  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const a = places[i];
      const b = places[j];

      // Longitude degrees narrow towards the poles; without this correction
      // two Nordic cities read as further apart than they look.
      const scale = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
      const dLat = a.lat - b.lat;
      const dLng = (a.lng - b.lng) * scale;

      if (Math.hypot(dLat, dLng) < threshold) {
        crowded.add(a.id);
        crowded.add(b.id);
      }
    }
  }

  return crowded;
}

/** Countries visited, for the counter above the map. */
export function countriesOf(places: Place[]): string[] {
  return [...new Set(places.map((place) => place.country))].sort((a, b) =>
    a.localeCompare(b),
  );
}
