/**
 * Bayesian occupancy grid for THEIA.
 *
 * The heatmap answers "where did detections pile up?". This answers a different and, for a
 * standoff, more useful question: "for each square of this building, how likely is it that
 * someone is there, given everything every sensor has said?"
 *
 * The practical difference is that a NON-detection is evidence too. A sensor covering a room
 * and reporting nothing actively lowers the probability in its cone -- a heatmap simply has no
 * points there, which looks identical to "no sensor ever looked". Being able to show a cleared
 * area with confidence is worth as much tactically as showing an occupied one.
 *
 * Stored as log-odds so evidence accumulates by addition and never saturates at 0 or 1:
 *   l = log(p / (1-p));  p = 1 / (1 + exp(-l))
 *
 * Pure module: no React, no I/O, deterministic -- so the sensor models can be tested directly.
 */

export interface GridSpec {
  /** meter-space coordinate of cell (0,0)'s corner */
  originX: number
  originY: number
  /** cell size in meters */
  res: number
  cols: number
  rows: number
}

export interface OccupancyGrid extends GridSpec {
  /** log-odds per cell, row-major (index = row * cols + col) */
  data: Float32Array
}

/** What one sensor reported at one instant, already in meter-space. */
export interface SensorReading {
  /** sensor position */
  sx: number
  sy: number
  /** unit vector the sensor faces */
  nx: number
  ny: number
  /** unit vector to the sensor's right (perpendicular to the normal) */
  rx: number
  ry: number
  /** half field of view, radians */
  halfFovRad: number
  /** max usable range, meters */
  maxRangeM: number
  /** true if the sensor reported presence */
  presence: boolean
  /** measured range in meters; 0/undefined for presence-only sensors */
  distM?: number
  /** exact target offset in meters when the sensor provides it (LD2450): lateral + forward */
  targetX?: number
  targetY?: number
  /** presence-only sensors carry no geometry beyond their cone */
  presenceOnly?: boolean
  /**
   * Stable identity of the reading, for incremental accumulation (see extendGrid). The
   * event id does the job. Without it a grid must be rebuilt from the whole history on
   * every tick, which is what this exists to avoid.
   */
  key?: string
}

export interface GridOptions {
  /** log-odds added to a cell believed occupied */
  lOccupied: number
  /** log-odds added to a cell believed free */
  lFree: number
  /** weaker evidence used when a presence-only sensor fires (whole cone, no distance) */
  lConePresence: number
  /** clamp so no cell becomes unrevisable */
  lClamp: number
  /** thickness of the "occupied" shell around a range measurement, meters */
  wallThicknessM: number
}

export const DEFAULT_GRID_OPTIONS: GridOptions = {
  lOccupied: 0.85,
  lFree: -0.4,
  // A presence-only sensor says "someone is somewhere in this cone". Spreading strong evidence
  // over the whole cone would paint a huge certain blob, so each cell gets only a nudge.
  lConePresence: 0.12,
  lClamp: 5,
  wallThicknessM: 0.4,
}

export function createGrid(spec: GridSpec): OccupancyGrid {
  return { ...spec, data: new Float32Array(spec.cols * spec.rows) }
}

/** Grid covering the given meter-space points, padded, at the requested resolution. */
export function gridForBounds(
  pts: Array<[number, number]>,
  res = 0.5,
  padM = 3,
  maxCells = 250_000,
): OccupancyGrid | null {
  if (pts.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  minX -= padM; minY -= padM; maxX += padM; maxY += padM
  let cols = Math.ceil((maxX - minX) / res)
  let rows = Math.ceil((maxY - minY) / res)
  // Guard against a stray coordinate blowing the grid up to gigabytes on a Pi.
  if (cols * rows > maxCells) {
    const k = Math.sqrt((cols * rows) / maxCells)
    cols = Math.max(1, Math.floor(cols / k))
    rows = Math.max(1, Math.floor(rows / k))
  }
  return createGrid({ originX: minX, originY: minY, res, cols: Math.max(1, cols), rows: Math.max(1, rows) })
}

function idx(g: GridSpec, col: number, row: number): number {
  return row * g.cols + col
}

function inBounds(g: GridSpec, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < g.cols && row < g.rows
}

function bump(g: OccupancyGrid, col: number, row: number, delta: number, clamp: number) {
  if (!inBounds(g, col, row)) return
  const i = idx(g, col, row)
  const v = g.data[i] + delta
  g.data[i] = v > clamp ? clamp : v < -clamp ? -clamp : v
}

/** Cell containing a meter-space point. */
export function cellOf(g: GridSpec, x: number, y: number): [number, number] {
  return [Math.floor((x - g.originX) / g.res), Math.floor((y - g.originY) / g.res)]
}

/** Center of a cell, in meter-space. */
export function cellCenter(g: GridSpec, col: number, row: number): [number, number] {
  return [g.originX + (col + 0.5) * g.res, g.originY + (row + 0.5) * g.res]
}

/**
 * Fold one sensor reading into the grid.
 *
 * Walks the cells inside the sensor cone once and classifies each:
 *  - beyond the measured range (or beyond max range): unknown, left untouched -- the sensor
 *    genuinely cannot see there, and pretending otherwise is how you "clear" a room you never
 *    actually looked into;
 *  - around the measured range: occupied;
 *  - closer than the measured range: free (the beam reached the target, so it passed through).
 */
export function integrateReading(
  grid: OccupancyGrid,
  r: SensorReading,
  options: Partial<GridOptions> = {},
): void {
  const opt = { ...DEFAULT_GRID_OPTIONS, ...options }
  const reach = r.maxRangeM
  const [c0, r0] = cellOf(grid, r.sx - reach, r.sy - reach)
  const [c1, r1] = cellOf(grid, r.sx + reach, r.sy + reach)

  // Exact target position, when the sensor gives one (LD2450).
  let targetPt: [number, number] | null = null
  if (r.presence && (r.targetX !== undefined || r.targetY !== undefined)) {
    const tx = r.targetX ?? 0
    const ty = r.targetY ?? 0
    if (tx !== 0 || ty !== 0) {
      targetPt = [r.sx + ty * r.nx + tx * r.rx, r.sy + ty * r.ny + tx * r.ry]
    }
  }

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!inBounds(grid, col, row)) continue
      const [cx, cy] = cellCenter(grid, col, row)
      const dx = cx - r.sx
      const dy = cy - r.sy
      const dist = Math.hypot(dx, dy)
      if (dist > reach || dist < 1e-6) continue

      // Inside the cone?
      const forward = dx * r.nx + dy * r.ny
      const lateral = dx * r.rx + dy * r.ry
      const ang = Math.atan2(lateral, forward)
      if (Math.abs(ang) > r.halfFovRad || forward <= 0) continue

      if (r.presenceOnly) {
        // No range, no bearing: the whole cone is weak evidence either way.
        bump(grid, col, row, r.presence ? opt.lConePresence : opt.lFree * 0.5, opt.lClamp)
        continue
      }

      if (!r.presence) {
        // Sensor is looking and sees nothing: its cone is evidence of absence.
        bump(grid, col, row, opt.lFree, opt.lClamp)
        continue
      }

      if (targetPt) {
        const td = Math.hypot(cx - targetPt[0], cy - targetPt[1])
        if (td <= Math.max(opt.wallThicknessM, grid.res)) {
          bump(grid, col, row, opt.lOccupied, opt.lClamp)
        } else if (dist < Math.hypot(targetPt[0] - r.sx, targetPt[1] - r.sy) - opt.wallThicknessM) {
          bump(grid, col, row, opt.lFree, opt.lClamp)
        }
        continue
      }

      const measured = r.distM ?? 0
      if (measured <= 0) continue
      if (Math.abs(dist - measured) <= Math.max(opt.wallThicknessM, grid.res * 0.5)) {
        // The arc at the measured range: with no bearing, the target is somewhere on it.
        bump(grid, col, row, opt.lOccupied, opt.lClamp)
      } else if (dist < measured - opt.wallThicknessM) {
        bump(grid, col, row, opt.lFree, opt.lClamp)
      }
      // dist > measured: shadowed by the target, unknown -- deliberately untouched.
    }
  }
}

/** Pull every cell toward unknown, so stale evidence fades instead of freezing the map. */
export function decayGrid(grid: OccupancyGrid, factor: number): void {
  const k = Math.min(1, Math.max(0, factor))
  for (let i = 0; i < grid.data.length; i++) grid.data[i] *= k
}

export function probabilityAt(grid: OccupancyGrid, col: number, row: number): number {
  if (!inBounds(grid, col, row)) return 0.5
  return 1 / (1 + Math.exp(-grid.data[idx(grid, col, row)]))
}

/** Build a grid from a batch of readings, oldest first. */
export function buildGrid(
  readings: SensorReading[],
  res = 0.5,
  options: Partial<GridOptions> = {},
): OccupancyGrid | null {
  const pts: Array<[number, number]> = []
  for (const r of readings) {
    pts.push([r.sx, r.sy])
    pts.push([r.sx + r.nx * r.maxRangeM, r.sy + r.ny * r.maxRangeM])
  }
  const grid = gridForBounds(pts, res)
  if (!grid) return null
  for (const r of readings) integrateReading(grid, r, options)
  return grid
}


/**
 * An occupancy grid kept across updates, with the readings already folded into it.
 *
 * Rebuilding from the entire history on every tick was the last thing tying the cumulative
 * overlays to how much history fits in memory: past the event cap the grid quietly forgot
 * the rooms swept first. It does not have to work that way -- the grid is log-odds, so
 * integrating a reading is `+=`, and the order does not matter. Keeping the grid and folding
 * in only what is new gives exactly the same numbers for a fraction of the work.
 */
export interface IncrementalGrid {
  grid: OccupancyGrid
  /** Keys already integrated, so a reordered or re-delivered list changes nothing. */
  consumed: Set<string>
  /** The point cloud the grid was sized around; a reading outside it forces a rebuild. */
  bounds: PointBounds
}

/** The two points buildGrid uses to size the grid around a reading. */
function extentPoints(r: SensorReading): Array<[number, number]> {
  return [
    [r.sx, r.sy],
    [r.sx + r.nx * r.maxRangeM, r.sy + r.ny * r.maxRangeM],
  ]
}

/**
 * The point cloud a full rebuild would measure -- NOT the grid's own extent.
 *
 * gridForBounds pads around the points, so comparing a new reading against the grid box was
 * wrong: a reading can sit comfortably inside the padding while still pushing the bounds a
 * rebuild would compute outward. The test caught it -- accumulating gave a 41x42 grid where
 * rebuilding gave 44x42, and 329 cells disagreed. Track what buildGrid tracks.
 */
interface PointBounds { minX: number; maxX: number; minY: number; maxY: number }

function boundsOf(readings: SensorReading[]): PointBounds | null {
  let b: PointBounds | null = null
  for (const r of readings) {
    for (const [x, y] of extentPoints(r)) {
      if (!b) b = { minX: x, maxX: x, minY: y, maxY: y }
      else {
        if (x < b.minX) b.minX = x
        if (x > b.maxX) b.maxX = x
        if (y < b.minY) b.minY = y
        if (y > b.maxY) b.maxY = y
      }
    }
  }
  return b
}

function within(b: PointBounds, r: SensorReading): boolean {
  return extentPoints(r).every(([x, y]) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY)
}

/**
 * Fold new readings into an existing grid, rebuilding only when it cannot be avoided.
 *
 * Rebuilds when there is no grid yet, when a reading has appeared that the current bounds do
 * not cover (a sensor moved, or one was added), or when a reading that had been integrated
 * is no longer in the list -- a purge or a changed filter, where carrying the old evidence
 * forward would be wrong.
 *
 * Readings without a `key` cannot be tracked, so their presence forces the full rebuild the
 * caller would have done anyway. Nothing silently half-updates.
 */
export function extendGrid(
  prev: IncrementalGrid | null,
  readings: SensorReading[],
  res = 0.5,
  options: Partial<GridOptions> = {},
): IncrementalGrid | null {
  if (readings.length === 0) return null

  const rebuild = (): IncrementalGrid | null => {
    const grid = buildGrid(readings, res, options)
    const bounds = boundsOf(readings)
    if (!grid || !bounds) return null
    return { grid, bounds, consumed: new Set(readings.map((r, i) => r.key ?? `#${i}`)) }
  }

  if (!prev || readings.some((r) => !r.key)) return rebuild()

  const keys = new Set(readings.map((r) => r.key!))
  // A reading we had integrated is gone: a purge, or a changed filter. Carrying its evidence
  // forward would draw something the operator has explicitly cleared.
  if ([...prev.consumed].some((k) => !keys.has(k))) return rebuild()

  const fresh = readings.filter((r) => !prev.consumed.has(r.key!))
  if (fresh.length === 0) return prev
  // Anything outside the cloud the grid was sized around changes the grid a rebuild would
  // produce, so accumulating into the current one would no longer match.
  if (fresh.some((r) => !within(prev.bounds, r))) return rebuild()

  for (const r of fresh) {
    integrateReading(prev.grid, r, options)
    prev.consumed.add(r.key!)
  }
  return prev
}
