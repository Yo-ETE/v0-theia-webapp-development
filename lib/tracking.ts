/**
 * Multi-target tracking for THEIA detections.
 *
 * Until now every detection was an independent point: nothing linked the blip at T to the blip
 * at T+1, so the map showed a flickering cloud with no identity, no reliable heading, and no
 * way to tell one person crossing a room from two people standing still. This turns that
 * stream of positions into persistent tracks.
 *
 * Design choices, and why:
 * - **Alpha-beta filter, not a full Kalman.** For constant-velocity targets in 2D, alpha-beta
 *   gives the same smoothing behaviour with two scalars instead of covariance matrices. It is
 *   auditable by eye, tunable by a non-specialist, and cannot blow up numerically -- worth more
 *   here than the theoretical optimality of a Kalman nobody on site can debug.
 * - **Greedy nearest-neighbour association, not Hungarian.** Optimal assignment matters when
 *   you have dozens of targets; a standoff has one to five. Greedy over distance-sorted pairs
 *   is a few lines and behaves identically at that scale.
 * - **Coasting is capped.** A track with no new detection keeps its last velocity for a short
 *   while (sensors drop frames), but stops extrapolating quickly: a marker confidently gliding
 *   through a wall on stale velocity is worse than one that simply stops.
 *
 * Pure module, no React and no I/O, so the behaviour can be tested directly.
 */

/** One projected detection, in the local meter-space used by the map. */
export interface Observation {
  x: number
  y: number
  /** epoch ms */
  t: number
  /** which sensor produced it -- kept for display ("seen by TX01, TX02") */
  deviceId?: string
}

export interface Track {
  id: string
  /** filtered position, meters */
  x: number
  y: number
  /** filtered velocity, m/s */
  vx: number
  vy: number
  /** epoch ms of the last associated observation */
  lastUpdate: number
  /** how many observations this track has absorbed */
  hits: number
  /** shown on the map only once confirmed (rejects one-off noise) */
  confirmed: boolean
  /** recent positions for the trail, oldest first */
  trail: Array<{ x: number; y: number; t: number }>
  /** sensors that contributed recently */
  deviceIds: string[]
}

export interface TrackerOptions {
  /** max distance (m) between a predicted track and an observation to associate them */
  gateM: number
  /** position gain: higher = follows measurements faster, noisier */
  alpha: number
  /** velocity gain: higher = reacts to speed changes faster, more jitter */
  beta: number
  /** observations needed before a track is displayed */
  confirmHits: number
  /** drop a track after this long with no observation (ms) */
  maxAgeMs: number
  /** stop extrapolating position after this long with no observation (ms) */
  coastMs: number
  /** clamp the estimated speed (m/s); a human on foot stays well under this */
  maxSpeedMps: number
  /**
   * Below this gap between two fixes, update the position but NOT the velocity.
   * Backend timestamps have one-second resolution, so two detections can legitimately share a
   * timestamp: dividing the residual by that ~zero interval sent the estimate straight to the
   * speed clamp (observed live: every track pinned at 8 m/s in a bedroom). You cannot measure
   * a speed over no elapsed time; refusing to try is the fix.
   */
  minDtForVelocityS: number
  /** trail length (ms) */
  trailMaxAgeMs: number
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  // Nodes report about once a second; someone walking briskly covers ~2m in that time, so 3m
  // still associates them while keeping two people in the same room apart.
  gateM: 3,
  alpha: 0.5,
  beta: 0.2,
  confirmHits: 2,
  maxAgeMs: 6000,
  coastMs: 1500,
  maxSpeedMps: 8,
  minDtForVelocityS: 0.3,
  trailMaxAgeMs: 20000,
}

let trackSeq = 0

function newTrack(o: Observation, now: number): Track {
  trackSeq += 1
  return {
    id: `T${trackSeq}`,
    x: o.x,
    y: o.y,
    vx: 0,
    vy: 0,
    lastUpdate: o.t || now,
    hits: 1,
    confirmed: false,
    trail: [{ x: o.x, y: o.y, t: o.t || now }],
    deviceIds: o.deviceId ? [o.deviceId] : [],
  }
}

/** Where a track is expected to be at `now`, given its last fix and velocity. */
export function predict(track: Track, now: number, coastMs: number): { x: number; y: number } {
  const dt = Math.min(Math.max(0, now - track.lastUpdate), coastMs) / 1000
  return { x: track.x + track.vx * dt, y: track.y + track.vy * dt }
}

/**
 * Advance the tracker by one step. Pure: returns a new array, never mutates `prev`.
 * Call it whenever a batch of detections arrives (and periodically, with an empty batch, to
 * let stale tracks expire).
 */
export function updateTracks(
  prev: Track[],
  observations: Observation[],
  now: number,
  options: Partial<TrackerOptions> = {},
): Track[] {
  const opt = { ...DEFAULT_TRACKER_OPTIONS, ...options }

  // Work on copies so the caller's array stays untouched (React state safety).
  const tracks: Track[] = prev.map((t) => ({ ...t, trail: [...t.trail], deviceIds: [...t.deviceIds] }))
  const predicted = tracks.map((t) => predict(t, now, opt.coastMs))

  // ── Association: every (track, observation) pair inside the gate, nearest first ──
  const pairs: Array<{ ti: number; oi: number; d: number }> = []
  for (let ti = 0; ti < tracks.length; ti++) {
    for (let oi = 0; oi < observations.length; oi++) {
      const dx = observations[oi].x - predicted[ti].x
      const dy = observations[oi].y - predicted[ti].y
      const d = Math.hypot(dx, dy)
      if (d <= opt.gateM) pairs.push({ ti, oi, d })
    }
  }
  pairs.sort((a, b) => a.d - b.d)

  const takenTrack = new Set<number>()
  const takenObs = new Set<number>()
  for (const p of pairs) {
    if (takenTrack.has(p.ti) || takenObs.has(p.oi)) continue
    takenTrack.add(p.ti)
    takenObs.add(p.oi)

    const track = tracks[p.ti]
    const obs = observations[p.oi]
    const tObs = obs.t || now
    const dt = Math.max(0.001, (tObs - track.lastUpdate) / 1000)

    // Alpha-beta update around the prediction.
    const px = track.x + track.vx * Math.min(dt, opt.coastMs / 1000)
    const py = track.y + track.vy * Math.min(dt, opt.coastMs / 1000)
    const rx = obs.x - px
    const ry = obs.y - py

    track.x = px + opt.alpha * rx
    track.y = py + opt.alpha * ry

    // Only touch velocity when enough time actually elapsed (see minDtForVelocityS).
    if (dt >= opt.minDtForVelocityS) {
      track.vx += (opt.beta / dt) * rx
      track.vy += (opt.beta / dt) * ry

      // Clamp: a bad fix must not launch the track across the map.
      const speed = Math.hypot(track.vx, track.vy)
      if (speed > opt.maxSpeedMps) {
        const k = opt.maxSpeedMps / speed
        track.vx *= k
        track.vy *= k
      }
    }

    track.lastUpdate = tObs
    track.hits += 1
    if (track.hits >= opt.confirmHits) track.confirmed = true
    track.trail.push({ x: track.x, y: track.y, t: tObs })
    if (obs.deviceId && !track.deviceIds.includes(obs.deviceId)) track.deviceIds.push(obs.deviceId)
  }

  // ── Birth: anything left over starts a tentative track ──
  for (let oi = 0; oi < observations.length; oi++) {
    if (takenObs.has(oi)) continue
    tracks.push(newTrack(observations[oi], now))
  }

  // ── Death + trail pruning ──
  return tracks
    .filter((t) => now - t.lastUpdate <= opt.maxAgeMs)
    .map((t) => ({
      ...t,
      trail: t.trail.filter((p) => now - p.t <= opt.trailMaxAgeMs),
    }))
}

/** Tracks worth drawing: confirmed ones only, newest activity first. */
export function visibleTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.confirmed).sort((a, b) => b.lastUpdate - a.lastUpdate)
}

/** Speed in m/s of a track, for display. */
export function trackSpeed(t: Track): number {
  return Math.hypot(t.vx, t.vy)
}

/** Heading in degrees from north (clockwise), or null if essentially stationary. */
export function trackHeading(t: Track): number | null {
  if (trackSpeed(t) < 0.15) return null // below this it is noise, not a direction
  const deg = (Math.atan2(t.vx, t.vy) * 180) / Math.PI
  return (deg + 360) % 360
}

/** Reset the id counter -- tests only. */
export function __resetTrackIds() {
  trackSeq = 0
}
