/**
 * Groups polygon sides by their bearing, assigning the same letter to parallel edges.
 * Uses 90-degree rotations from edge 0's bearing to determine facade letters (A, B, C, D).
 */
export function groupSidesByBearing(polygon: [number, number][]): string[] {
  if (!polygon || polygon.length < 3) return []
  
  const n = polygon.length
  const segToGroup: string[] = new Array(n).fill("")

  // Calculate bearing for each segment
  const bearings: number[] = []
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = polygon[i]
    const [lat2, lon2] = polygon[(i + 1) % n]
    const dLon = lon2 - lon1
    const dLat = lat2 - lat1
    let bearing = Math.atan2(dLon, dLat) * 180 / Math.PI
    // Normalize to [0, 180) - treat opposite directions as same orientation
    bearing = ((bearing % 360) + 360) % 360
    if (bearing >= 180) bearing -= 180
    bearings.push(bearing)
  }

  // Reference bearing is edge 0
  const refBearing = bearings[0]

  // Assign facade letters based on rotation from reference bearing
  const LETTERS = ["A", "B", "C", "D"]
  
  for (let i = 0; i < n; i++) {
    // Calculate relative angle from reference bearing
    let relAngle = bearings[i] - refBearing
    // Normalize to [0, 180)
    relAngle = ((relAngle % 180) + 180) % 180
    
    // Determine which 45-degree quadrant this falls into
    // 0-22.5 or 157.5-180 -> same as reference (A)
    // 22.5-67.5 -> 90 degrees rotated (B)
    // 67.5-112.5 -> 180 degrees rotated (C)
    // 112.5-157.5 -> 270 degrees rotated (D)
    let quadrant: number
    if (relAngle < 22.5 || relAngle >= 157.5) {
      quadrant = 0 // A - same direction as edge 0
    } else if (relAngle < 67.5) {
      quadrant = 1 // B - 90 degrees clockwise
    } else if (relAngle < 112.5) {
      quadrant = 2 // C - 180 degrees (opposite)
    } else {
      quadrant = 3 // D - 270 degrees clockwise
    }
    
    const letter = LETTERS[quadrant]
    segToGroup[i] = letter
  }
  
  return segToGroup
}

/**
 * Gets unique facade letters for a polygon
 */
export function getUniqueFacades(polygon: [number, number][]): string[] {
  const facadeLetters = groupSidesByBearing(polygon)
  return [...new Set(facadeLetters)]
}
