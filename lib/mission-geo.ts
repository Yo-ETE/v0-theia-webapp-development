/**
 * Geodesic helpers shared by the mission views.
 *
 * `haversineM` lived twice -- once in the mission detail page, once in map-inner.tsx -- with
 * byte-identical bodies. Two copies of a distance formula is how two views end up disagreeing
 * about the length of the same wall, so it lives here now and both import it.
 */

/** Great-circle distance between two lat/lon points, in meters. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Where a sensor sits along its wall, as a human-readable distance.
 *
 * `side` is a SEGMENT INDEX written as a letter -- "A" is segment 0, "B" is segment 1 -- which
 * is the convention `map-inner.tsx` and `getDisplaySide` already read. This function used to
 * treat it as a bearing GROUP letter from `groupSidesByBearing` and search the groups for a
 * match. The two agree on a rectangle, where segments 0..3 fall into quadrants A..D in order,
 * so the disagreement stayed invisible: every zone and every side-remap test is a rectangle.
 *
 * Delete a vertex and it shows. A square minus one corner gives the groups [A, C, D] -- no B,
 * because no edge of the triangle points that way. A sensor correctly remapped to segment 1
 * ("B") then matched no group, and its distance came back empty while its marker and its face
 * label were both right.
 *
 * A polygon here is either lat/lon (a real building on the map) or pixels (a plan image
 * calibrated in the editor). Pixels have no metric meaning until the plan is calibrated, so
 * they are reported as a percentage of the wall rather than a fabricated distance -- hence the
 * coordinate-magnitude test rather than a flag: any |value| above 200 cannot be a latitude or
 * longitude, so the polygon is in pixel space.
 */
export function getSideDistanceM(
  polygon: [number, number][],
  side: string,
  sensorPos: number,
): string {
  if (!polygon || polygon.length < 3 || !side) return ""
  // Legacy rows can hold a facade NAME rather than a segment key. Those carry no index, and
  // guessing one would put a distance against the wrong wall, so they get no distance at all
  // -- which is what they got before, by falling through the group search.
  if (side.length !== 1 || side < "A" || side > "Z") return ""
  const i = side.charCodeAt(0) - 65
  if (i >= polygon.length) return ""
  const j = (i + 1) % polygon.length
  const isPixel = polygon.some(([a, b]: [number, number]) => Math.abs(a) > 200 || Math.abs(b) > 200)
  if (isPixel) return `${Math.round(sensorPos * 100)}%`
  const dist = haversineM(polygon[i][0], polygon[i][1], polygon[j][0], polygon[j][1]) * sensorPos
  return dist < 1 ? `${Math.round(dist * 100)}cm` : `${dist.toFixed(1)}m`
}
