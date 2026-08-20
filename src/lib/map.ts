/**
 * Turning a pile of photos into pins on a map.
 *
 * All of this is pure so it can be tested without a map, a token, or a
 * browser: the clustering, the filtering and the bounds are where the bugs
 * would hide, not in the Leaflet call that draws the result.
 */

export type Pin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** "exif" is a real spot; anything else is the souvenir's city. */
  geoSource: string;
  takenAt: Date | null;
  placeId: string | null;
  thumbnailLink?: string;
  mimeType: string;
};

export type Cluster = {
  /** Stable across renders at the same zoom, so markers are not recreated. */
  key: string;
  lat: number;
  lng: number;
  pins: Pin[];
  /** True when every pin in it is only as precise as a city. */
  approximate: boolean;
};

/**
 * Cell size in degrees for each zoom level.
 *
 * Grid clustering rather than a distance algorithm: at a given zoom the cell
 * is a fixed number of pixels, so a grid is both cheap and stable — the same
 * photos always land in the same cluster, which stops markers from jumping
 * when the list is reordered.
 */
export function cellSize(zoom: number): number {
  // 360 degrees across the world at zoom 0, halving each level. Dividing by 8
  // puts roughly eight cells across the viewport, which reads as grouped
  // without hiding detail.
  return 360 / 2 ** zoom / 8;
}

export function clusterPins(pins: Pin[], zoom: number): Cluster[] {
  const size = cellSize(zoom);
  const cells = new Map<string, Pin[]>();

  for (const pin of pins) {
    const row = Math.floor(pin.lat / size);
    const column = Math.floor(pin.lng / size);
    const key = `${row}:${column}`;

    const cell = cells.get(key);
    if (cell) cell.push(pin);
    else cells.set(key, [pin]);
  }

  return [...cells.entries()]
    .map(([key, members]) => ({
      key: `${zoom}:${key}`,
      // The centroid, so a cluster sits among its photos rather than on the
      // corner of an invisible grid cell.
      lat: mean(members.map((pin) => pin.lat)),
      lng: mean(members.map((pin) => pin.lng)),
      pins: members.slice().sort(byDate),
      approximate: members.every((pin) => pin.geoSource !== "exif"),
    }))
    .sort((a, b) => b.pins.length - a.pins.length);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function byDate(a: Pin, b: Pin): number {
  const at = a.takenAt?.getTime();
  const bt = b.takenAt?.getTime();
  if (at === undefined && bt === undefined) return a.name.localeCompare(b.name);
  if (at === undefined) return 1;
  if (bt === undefined) return -1;
  return at - bt;
}

/** Every year that has photos, newest first. */
export function yearsOf(pins: Pin[]): number[] {
  const years = new Set<number>();
  for (const pin of pins) {
    if (pin.takenAt) years.add(pin.takenAt.getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

/** `null` means every year, including photos with no date at all. */
export function filterByYear(pins: Pin[], year: number | null): Pin[] {
  if (year === null) return pins;
  return pins.filter((pin) => pin.takenAt?.getFullYear() === year);
}

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
export function boundsOf(pins: Pin[]): Bounds | null {
  if (pins.length === 0) return null;

  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;

  for (const pin of pins) {
    south = Math.min(south, pin.lat);
    north = Math.max(north, pin.lat);
    west = Math.min(west, pin.lng);
    east = Math.max(east, pin.lng);
  }

  // A single pin has no extent, and fitting a zero-size box zooms to maximum.
  const padLat = Math.max((north - south) * 0.1, 0.05);
  const padLng = Math.max((east - west) * 0.1, 0.05);

  return {
    south: Math.max(-90, south - padLat),
    north: Math.min(90, north + padLat),
    west: Math.max(-180, west - padLng),
    east: Math.min(180, east + padLng),
  };
}
