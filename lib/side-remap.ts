/**
 * Keeping sensors on the wall they were placed on when the zone outline is edited.
 *
 * A sensor is not stored at a point in space. It is stored as **(segment index, t)** --
 * "wall C, 40% along it" -- in `device.side` / `device.sensor_position`, mirrored in
 * `mission.device_placements`. Dragging a vertex is therefore free: the wall moves and the
 * sensor moves with it, which is what an operator expects.
 *
 * Inserting or deleting a vertex is not free. It renumbers every later segment, so a sensor
 * still claiming "wall C" ends up on what used to be wall D. Nothing said so, and because
 * fusion and tracking derive the sensor's position and facing from that binding, detections
 * were then computed against the wrong wall of the building.
 *
 * Both transformations are exact, so no sensor has to be re-placed by hand. This module is
 * pure and has no React or I/O, so the arithmetic can be tested directly.
 *
 * One approximation, deliberate: lengths are Euclidean in whatever units the polygon uses
 * (degrees on the map, pixels on a plan). For an insert that is exact, because the two
 * halves are collinear and the metric cancels in the ratio. For a delete the two merged
 * walls are not collinear, so on the map the longitude scaling introduces an error of a few
 * percent in where along the merged wall the sensor sits. That is far below the placement
 * precision of a finger on a tablet, and the alternative -- threading a projection into a
 * pure module -- buys nothing an operator could notice.
 */

export type Pt = [number, number]

/** What an editor reports back so the parent can keep sensors on their wall. */
export type PolygonEdit =
  | { type: "insert"; edgeIndex: number; point: Pt }
  | { type: "delete"; vertexIndex: number }

/** What a caller needs remapped. Anything else on the object is preserved by the caller. */
export interface SidePlacement {
  /** Segment key: "A" is segment 0, "B" is segment 1. See resolveSideIdx. */
  side: string
  /** Position along that segment, 0..1. */
  sensor_position: number
}

const idxToLetter = (i: number) => String.fromCharCode(65 + i)
const letterToIdx = (s: string) => s.charCodeAt(0) - 65

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Clamp to the range placement already uses, so a remapped sensor never lands on a corner. */
function clampT(t: number): number {
  return Math.max(0.02, Math.min(0.98, t))
}

/**
 * A vertex was inserted on edge `edgeIndex`, splitting it in two.
 *
 * @param polygonBefore the outline as it was, before the insert
 * @param edgeIndex     the edge that was split (0 = the edge leaving vertex 0)
 * @param inserted      the new vertex; it lies on that edge
 */
export function remapForInsert<T extends SidePlacement>(
  placements: T[],
  polygonBefore: Pt[],
  edgeIndex: number,
  inserted: Pt,
): T[] {
  const n = polygonBefore.length
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return placements

  const a = polygonBefore[edgeIndex]
  const b = polygonBefore[(edgeIndex + 1) % n]
  const whole = dist(a, b)
  // Where along the old edge the split happened. A degenerate edge splits down the middle.
  const split = whole > 0 ? dist(a, inserted) / whole : 0.5

  return placements.map((p) => {
    const seg = letterToIdx(p.side)
    if (seg < 0 || seg >= n) return p

    if (seg < edgeIndex) return p

    if (seg > edgeIndex) {
      return { ...p, side: idxToLetter(seg + 1) }
    }

    // On the split edge: it belongs to whichever half it already sat in.
    const t = p.sensor_position
    if (split <= 0 || split >= 1) return p
    if (t < split) {
      return { ...p, sensor_position: clampT(t / split) }
    }
    return { ...p, side: idxToLetter(seg + 1), sensor_position: clampT((t - split) / (1 - split)) }
  })
}

/**
 * Vertex `vertexIndex` was removed, merging the two segments that met there.
 *
 * @param polygonBefore the outline as it was, before the deletion
 */
export function remapForDelete<T extends SidePlacement>(
  placements: T[],
  polygonBefore: Pt[],
  vertexIndex: number,
): T[] {
  const n = polygonBefore.length
  if (n < 4 || vertexIndex < 0 || vertexIndex >= n) return placements

  const prevSeg = (vertexIndex - 1 + n) % n // the segment arriving at the deleted vertex
  const nextSeg = vertexIndex               // the segment leaving it
  // In the new polygon the merged wall starts at the vertex before the one removed.
  const mergedIdx = vertexIndex === 0 ? n - 2 : vertexIndex - 1

  const lenPrev = dist(polygonBefore[prevSeg], polygonBefore[(prevSeg + 1) % n])
  const lenNext = dist(polygonBefore[nextSeg], polygonBefore[(nextSeg + 1) % n])
  const total = lenPrev + lenNext

  return placements.map((p) => {
    const seg = letterToIdx(p.side)
    if (seg < 0 || seg >= n) return p

    if (seg === prevSeg || seg === nextSeg) {
      // Both walls become one, so the position has to be rescaled onto the whole of it.
      const along = seg === prevSeg ? p.sensor_position * lenPrev : lenPrev + p.sensor_position * lenNext
      const t = total > 0 ? along / total : 0.5
      return { ...p, side: idxToLetter(mergedIdx), sensor_position: clampT(t) }
    }

    // Everything after the removed vertex shifts down one; everything before is untouched.
    return seg > vertexIndex ? { ...p, side: idxToLetter(seg - 1) } : p
  })
}
