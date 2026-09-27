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
  groupSides: (p: [number, number][]) => { segmentToGroup: Record<number, string> },
): string {
  if (!polygon || polygon.length < 3 || !side) return ""
  const { segmentToGroup } = groupSides(polygon)
  // Find the first polygon edge matching this side letter
  for (let i = 0; i < polygon.length; i++) {
    const groupKey = segmentToGroup[i] ?? String.fromCharCode(65 + i)
    if (groupKey === side) {
      const j = (i + 1) % polygon.length
      const isPixel = polygon.some(([a, b]: [number, number]) => Math.abs(a) > 200 || Math.abs(b) > 200)
      if (isPixel) {
        const pct = Math.round(sensorPos * 100)
        return `${pct}%`
      }
      const edgeLen = haversineM(polygon[i][0], polygon[i][1], polygon[j][0], polygon[j][1])
      const dist = edgeLen * sensorPos
      return dist < 1 ? `${Math.round(dist * 100)}cm` : `${dist.toFixed(1)}m`
    }
  }
  return ""
}
