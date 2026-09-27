/** Constants for the mission detail view: poll cadences, event cap, zone palette and types. */

/*
 * Two different cadences, because freshness and cost peak at opposite moments.
 *
 * Live markers, tracks and the Detection Feed come straight off SSE and are never affected
 * by any of this. But the heatmap and the occupancy grid are built from `events`, the
 * polled history -- so slowing the poll down would make a room you just swept stay
 * "unknown" on the grid for longer, which is the opposite of useful.
 *
 * So: the periodic poll goes slow, because polling while nothing is happening is pure
 * waste; and a detection arriving on the stream pulls the history promptly, because that is
 * exactly when the overlays have something new to show.
 */
export const IDLE_POLL_MS = 30000
export const SSE_DOWN_POLL_MS = 5000
export const AFTER_DETECTION_SYNC_MS = 8000

/** How many events the console loads. Past this the backend drops the OLDEST ones. */
export const EVENTS_LIMIT = 10000

export const ZONE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
]

export const ZONE_TYPES = [
  { value: "facade", label: "Facade / Wall" },
  { value: "perimeter", label: "Perimeter" },
  { value: "interior", label: "Interior" },
  { value: "roof", label: "Roof" },
  { value: "floor", label: "Floor / Etage" },
  { value: "section", label: "Section / Troncon" },
  { value: "custom", label: "Custom" },
] as const

/** How long the Detection Feed keeps asserting SSE detections as current. */
export const FEED_TTL_MS = 5 * 60 * 1000

export const FLOOR_LABELS: Record<number, string> = {
  0: "RDC",
  1: "1er",
  2: "2ème",
  3: "3ème",
  [-1]: "Sous-sol",
}
