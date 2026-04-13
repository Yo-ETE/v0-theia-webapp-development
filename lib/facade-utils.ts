/** Group polygon edges by edge bearing so parallel walls share the same facade letter
 *  Edge 0 = A, then letters assigned based on clockwise rotation from edge 0:
 *  0° = A, 90° = B, 180° = C, 270° = D
 *  
 *  Returns { labels, segmentToGroup } where:
 *  - segmentToGroup[i] = facade letter (A/B/C/D) for segment i
 *  - labels = object with used letters as keys
 */
export function groupSidesByBearing(polygon: [number, number][]): { labels: Record<string, string>; segmentToGroup: string[] } {
  const n = polygon.length
  if (n < 3) {
    const segmentToGroup = polygon.map((_, i) => String.fromCharCode(65 + i))
    const labels: Record<string, string> = {}
    segmentToGroup.forEach(l => { labels[l] = "" })
    return { labels, segmentToGroup }
  }

  const isPixelCoords = polygon.some(([a, b]) => Math.abs(a) > 200 || Math.abs(b) > 200)

  const edgeBearings: number[] = []
  for (let i = 0; i < n; i++) {
    const [y1, x1] = polygon[i]
    const [y2, x2] = polygon[(i + 1) % n]
    let deg: number
    if (isPixelCoords) {
      deg = Math.atan2(x2 - x1, y2 - y1) * 180 / Math.PI
    } else {
      const dLon = (x2 - x1) * Math.PI / 180
      const yy = Math.sin(dLon) * Math.cos(y2 * Math.PI / 180)
      const xx = Math.cos(y1 * Math.PI / 180) * Math.sin(y2 * Math.PI / 180) -
                 Math.sin(y1 * Math.PI / 180) * Math.cos(y2 * Math.PI / 180) * Math.cos(dLon)
      deg = Math.atan2(yy, xx) * 180 / Math.PI
    }
    edgeBearings.push(((deg % 360) + 360) % 360)
  }

  const refBearing = edgeBearings[0]

  const relativeRot = (bearing: number) => {
    let rot = bearing - refBearing
    while (rot < 0) rot += 360
    while (rot >= 360) rot -= 360
    return rot
  }

  const TOLERANCE = 30
  const getQuadrantLetter = (rot: number): string => {
    if (rot <= TOLERANCE || rot >= 360 - TOLERANCE) return 'A'
    if (rot >= 90 - TOLERANCE && rot <= 90 + TOLERANCE) return 'B'
    if (rot >= 180 - TOLERANCE && rot <= 180 + TOLERANCE) return 'C'
    if (rot >= 270 - TOLERANCE && rot <= 270 + TOLERANCE) return 'D'
    const distances = [
      { letter: 'A', dist: Math.min(rot, 360 - rot) },
      { letter: 'B', dist: Math.abs(rot - 90) },
      { letter: 'C', dist: Math.abs(rot - 180) },
      { letter: 'D', dist: Math.abs(rot - 270) },
    ]
    return distances.sort((a, b) => a.dist - b.dist)[0].letter
  }

  const segmentToGroup: string[] = []
  const usedLetters = new Set<string>()

  for (let i = 0; i < n; i++) {
    const letter = getQuadrantLetter(relativeRot(edgeBearings[i]))
    segmentToGroup.push(letter)
    usedLetters.add(letter)
  }

  const labels: Record<string, string> = {}
  for (const letter of Array.from(usedLetters).sort()) {
    labels[letter] = ""
  }

  return { labels, segmentToGroup }
}
