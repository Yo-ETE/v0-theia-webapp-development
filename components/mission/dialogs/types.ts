/**
 * State shapes shared between the mission detail page and its dialogs.
 *
 * These were inline `useState<{...}>` annotations, which was fine while the dialogs lived in
 * the same file. Now that they do not, a named type is what keeps the page and the dialog
 * from drifting apart.
 */

/** Tuning for a Gravity MW node, which sees through some materials and not others. */
export interface GravityConfig {
  /** Meters. How far the node actually reaches through whatever is in front of it. */
  effectiveRange: number
  /** Degrees. The usable part of its cone, narrowed by the material it shoots through. */
  effectiveFov: number
}

/**
 * Where the assignment wizard has got to.
 *
 * `side` distinguishes three states and the difference matters: `undefined` means the side has
 * not been chosen yet, so the picker shows; `""` means deliberately no side, which is how a
 * Gravity MW covering a whole room is recorded; a letter is a specific facade.
 */
export interface AssignStep {
  deviceId: string
  deviceName: string
  side?: string
  deviceType?: string
  gravityConfig?: GravityConfig
}

/** A pending click-on-the-map placement: the node is chosen, the spot is not. */
export interface SensorPlaceMode {
  zoneId: string
  side: string
  deviceId: string
  deviceName: string
  deviceType?: string
}

/** A placed Gravity MW awaiting its range/FOV before the assignment is written. */
export interface GravityConfigTarget {
  deviceId: string
  deviceName: string
  zoneId: string
  side: string
  sensorPosition: number
  config: GravityConfig
}
