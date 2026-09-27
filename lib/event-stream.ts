/**
 * Accumulating a mission's event history instead of re-downloading it.
 *
 * The console used to ask for the whole history on every tick: measured on the hub at 415
 * events / 204KB / 130ms, and it grows for as long as the mission runs. Slowing the poll down
 * bought time; it did not change the shape of the problem. The backend already accepts
 * `from_ts`, so the client can keep what it has and ask only for what is new.
 *
 * Two details decide whether that works, and both come from the hardware rather than theory:
 *
 * - **Timestamps have one-second resolution.** Several events share the last second we know
 *   about, so the query must be inclusive (`>=`) and the merge must dedupe. Asking for
 *   strictly newer would silently drop every event that landed in the same second as the
 *   previous poll -- the same class of bug as the velocity blow-up.
 * - **Events can disappear.** Purging a mission deletes them server-side, and an accumulator
 *   that only ever adds would keep showing them. Callers reset rather than merge in that case.
 *
 * Pure module, no React and no I/O, so the merge can be tested directly.
 */

export interface StreamEvent {
  id: string
  timestamp: string
}

/**
 * Combine what we already had with what just arrived.
 *
 * `incoming` wins on conflict: a re-fetched row is the fresher copy of the same id. The result
 * is newest first, which is the order the API returns and the order every consumer expects.
 */
export function mergeEvents<T extends StreamEvent>(existing: T[], incoming: T[], cap: number): T[] {
  if (incoming.length === 0) return existing.length > cap ? existing.slice(0, cap) : existing

  const byId = new Map<string, T>()
  // Existing first so that incoming overwrites it, not the other way round.
  for (const e of existing) byId.set(String(e.id), e)
  for (const e of incoming) byId.set(String(e.id), e)

  const merged = [...byId.values()]
  merged.sort((a, b) => {
    if (a.timestamp === b.timestamp) {
      // Same second: fall back to id so the order is stable between renders. Ids are numeric
      // strings from SQLite's AUTOINCREMENT, so compare them as numbers when we can.
      const na = Number(a.id), nb = Number(b.id)
      if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na
      return String(b.id).localeCompare(String(a.id))
    }
    return a.timestamp < b.timestamp ? 1 : -1
  })

  return merged.length > cap ? merged.slice(0, cap) : merged
}

/**
 * The timestamp to ask `from_ts` for next. Inclusive by design -- see the note above about
 * one-second resolution -- so the caller will re-receive the last second and dedupe it.
 */
export function newestTimestamp<T extends StreamEvent>(events: T[]): string | null {
  let newest: string | null = null
  for (const e of events) {
    if (!e.timestamp) continue
    if (newest === null || e.timestamp > newest) newest = e.timestamp
  }
  return newest
}
