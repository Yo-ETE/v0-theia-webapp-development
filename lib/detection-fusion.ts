/**
 * Fuses simultaneous detections from several sensors into ONE position before tracking.
 *
 * Measured on a real two-sensor run (4.5m room, sensors 4.2m apart, 23 simultaneous pairs):
 * the LD2450 and the C4001 place the same person 1.34m apart on median (0.69 - 2.57m). Feeding
 * both into the tracker makes the track alternate between them, which is what produced a
 * "3.8 m/s" reading for someone walking around a bedroom: the position averages out fine, but
 * the velocity and heading are junk.
 *
 * The gap is not noise and no tracker tuning fixes it. A depth-only sensor (C4001) has no
 * bearing, so on its own it can only be drawn straight along its axis. The fix is to reconcile
 * the readings geometrically first, then hand the tracker a single, stable point.
 *
 * Pure module: no React, no I/O.
 */

/** One sensor's reading, already projected into meter-space by the caller. */
export interface RawDetection {
  deviceId: string
  /** epoch ms */
  t: number
  /** sensor position */
  sensorM: [number, number]
  /** unit vector the sensor faces */
  normalM: [number, number]
  /** measured range, meters */
  distM: number
  /** true when the sensor reports a real lateral offset (LD2450), false for depth-only */
  hasBearing: boolean
  /** this sensor's own projected point */
  pointM: [number, number]
}

export interface FusedObservation {
  x: number
  y: number
  t: number
  /** every sensor that contributed */
  deviceIds: string[]
  /** how the position was obtained, for display and for debugging in the field */
  method: "single" | "bearing-average" | "range-corrected" | "trilateration"
}

/**
 * Intersect two range circles. With two bearing-less sensors this is the only way to get a
 * real fix: averaging each one's straight-ahead guess does not converge to the true position
 * unless the target happens to sit on both axes.
 * Returns 0, 1 or 2 points; `noiseM` tolerates circles that should touch but measured slightly
 * short or long.
 */
export function circleIntersections(
  c1: [number, number], r1: number,
  c2: [number, number], r2: number,
  noiseM = 0.5,
): [number, number][] {
  const dx = c2[0] - c1[0]
  const dy = c2[1] - c1[1]
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return []
  if (d > r1 + r2 + noiseM || d < Math.abs(r1 - r2) - noiseM) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const mx = c1[0] + (a * dx) / d
  const my = c1[1] + (a * dy) / d
  const ux = -dy / d
  const uy = dx / d
  if (h < 1e-6) return [[mx, my]]
  return [[mx + h * ux, my + h * uy], [mx - h * ux, my - h * uy]]
}

/**
 * Pull a starting position toward satisfying each depth-only sensor's measured range.
 * A couple of damped Gauss-Newton style steps: for each sensor, slide the estimate along the
 * sensor->estimate ray by the range error. Damped because two sensors can disagree, and we
 * want the compromise rather than an oscillation between them.
 */
function correctByRanges(
  start: [number, number],
  rangeOnly: RawDetection[],
  iterations = 3,
  gain = 0.5,
): [number, number] {
  let pos: [number, number] = [start[0], start[1]]
  for (let it = 0; it < iterations; it++) {
    let dx = 0
    let dy = 0
    for (const r of rangeOnly) {
      const vx = pos[0] - r.sensorM[0]
      const vy = pos[1] - r.sensorM[1]
      const d = Math.hypot(vx, vy)
      if (d < 1e-6) continue
      const err = r.distM - d
      dx += (vx / d) * err
      dy += (vy / d) * err
    }
    pos = [pos[0] + (dx / rangeOnly.length) * gain, pos[1] + (dy / rangeOnly.length) * gain]
  }
  return pos
}

/** A recent fused position, usable as the starting point for a lone range-only reading. */
export interface Prior {
  x: number
  y: number
  t: number
}

/** How old a prior may be, and how far off the measured range, before we stop trusting it. */
const PRIOR_MAX_AGE_MS = 5000
const PRIOR_MAX_RANGE_ERR_M = 2

/**
 * Fuse one batch of detections considered simultaneous.
 *
 * `prior` matters more than it looks: sensors do not report in step, so plenty of instants have
 * only one sensor talking. A lone depth-only reading carries no bearing at all -- projecting it
 * straight ahead is what put the C4001 1.25m off in testing. Sliding the last known position
 * onto its measured range keeps the estimate honest between joint fixes.
 */
export function fuseGroup(group: RawDetection[], prior?: Prior | null): FusedObservation | null {
  if (group.length === 0) return null
  const t = Math.max(...group.map((d) => d.t))
  const deviceIds = group.map((d) => d.deviceId)

  if (group.length === 1) {
    const only = group[0]
    // A lone bearing-capable sensor already knows where the target is.
    if (only.hasBearing || !prior) {
      return { x: only.pointM[0], y: only.pointM[1], t, deviceIds, method: "single" }
    }
    const age = t - prior.t
    const priorRange = Math.hypot(prior.x - only.sensorM[0], prior.y - only.sensorM[1])
    const usable = age >= 0 && age <= PRIOR_MAX_AGE_MS &&
      Math.abs(priorRange - only.distM) <= PRIOR_MAX_RANGE_ERR_M
    if (!usable) {
      // Stale or contradicting the measurement: trust the sensor, not the memory.
      return { x: only.pointM[0], y: only.pointM[1], t, deviceIds, method: "single" }
    }
    const corrected = correctByRanges([prior.x, prior.y], [only])
    return { x: corrected[0], y: corrected[1], t, deviceIds, method: "range-corrected" }
  }

  const withBearing = group.filter((d) => d.hasBearing)
  const rangeOnly = group.filter((d) => !d.hasBearing)

  // No bearing anywhere: two range circles give a true fix (up to the mirror ambiguity, which
  // we resolve by staying closest to the sensors' own naive guesses).
  if (withBearing.length === 0 && rangeOnly.length >= 2) {
    const [a, b] = rangeOnly
    const candidates = circleIntersections(a.sensorM, a.distM, b.sensorM, b.distM)
    if (candidates.length > 0) {
      const naive: [number, number] = [
        (a.pointM[0] + b.pointM[0]) / 2,
        (a.pointM[1] + b.pointM[1]) / 2,
      ]
      candidates.sort(
        (p, q) =>
          (p[0] - naive[0]) ** 2 + (p[1] - naive[1]) ** 2 -
          ((q[0] - naive[0]) ** 2 + (q[1] - naive[1]) ** 2),
      )
      return { x: candidates[0][0], y: candidates[0][1], t, deviceIds, method: "trilateration" }
    }
    // Circles do not meet (bad geometry or a stale reading): fall back to the average rather
    // than inventing a fix.
    return {
      x: rangeOnly.reduce((s, d) => s + d.pointM[0], 0) / rangeOnly.length,
      y: rangeOnly.reduce((s, d) => s + d.pointM[1], 0) / rangeOnly.length,
      t, deviceIds, method: "bearing-average",
    }
  }

  // At least one sensor knows where the target actually is: start from it.
  const base: [number, number] = [
    withBearing.reduce((s, d) => s + d.pointM[0], 0) / withBearing.length,
    withBearing.reduce((s, d) => s + d.pointM[1], 0) / withBearing.length,
  ]
  if (rangeOnly.length === 0) {
    return { x: base[0], y: base[1], t, deviceIds, method: "bearing-average" }
  }

  const corrected = correctByRanges(base, rangeOnly)
  return { x: corrected[0], y: corrected[1], t, deviceIds, method: "range-corrected" }
}

/**
 * Group detections into simultaneous batches (one reading per sensor, most recent wins) and
 * fuse each batch. Input order does not matter.
 */
export function fuseDetections(
  dets: RawDetection[],
  windowMs = 2000,
  initialPrior: Prior | null = null,
): FusedObservation[] {
  if (dets.length === 0) return []
  const sorted = [...dets].sort((a, b) => a.t - b.t)
  const out: FusedObservation[] = []
  let batch: RawDetection[] = []
  // Each fused position seeds the next batch, so a lone range-only reading has something
  // better than its own axis to start from.
  let prior: Prior | null = initialPrior

  const flush = () => {
    if (batch.length === 0) return
    // Keep only the freshest reading per sensor inside the batch.
    const bySensor = new Map<string, RawDetection>()
    for (const d of batch) {
      const prev = bySensor.get(d.deviceId)
      if (!prev || d.t > prev.t) bySensor.set(d.deviceId, d)
    }
    const fused = fuseGroup([...bySensor.values()], prior)
    if (fused) {
      out.push(fused)
      prior = { x: fused.x, y: fused.y, t: fused.t }
    }
    batch = []
  }

  for (const d of sorted) {
    if (batch.length > 0 && d.t - batch[0].t > windowMs) flush()
    batch.push(d)
  }
  flush()
  return out
}

/**
 * Association gate scaled to the space being watched.
 * A fixed 3m gate covers two thirds of a 4.5m bedroom, which would merge two people standing
 * apart; in a large hall the same 3m is too tight for someone walking between frames. Tie it
 * to the zone diagonal, clamped to values that still make sense for a person on foot.
 */
export function gateForExtent(extentM: number, min = 1.2, max = 3): number {
  if (!Number.isFinite(extentM) || extentM <= 0) return max
  return Math.min(max, Math.max(min, extentM / 4))
}
