/**
 * Projective transform ("homography") between two quadrilaterals.
 *
 * Used to lay an image on the map by four points. A hand-drawn plan is not to scale and a
 * photo of a sheet of paper taken at an angle is perspective-distorted; a similarity
 * (move / rotate / scale) can fix neither, and an affine map (three points) cannot fix the
 * perspective. Four points pin both.
 *
 * Convention: H maps (x, y) to ((a x + b y + c) / (g x + h y + 1), (d x + e y + f) / (g x + h y + 1)),
 * stored as [a, b, c, d, e, f, g, h].
 */

export type Pt = [number, number]
export type Homography = [number, number, number, number, number, number, number, number]

/** Solve the 8x8 system for the homography taking src[i] to dst[i]. Null if degenerate. */
export function solveHomography(src: Pt[], dst: Pt[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const sol = solveLinear(A, b)
  return sol ? (sol as Homography) : null
}

/** Apply H to a point. */
export function applyHomography(H: Homography, [x, y]: Pt): Pt {
  const [a, b, c, d, e, f, g, h] = H
  const w = g * x + h * y + 1
  return [(a * x + b * y + c) / w, (d * x + e * y + f) / w]
}

/**
 * CSS `matrix3d` for an element whose own pixel box is the source space.
 *
 * Needs `transform-origin: 0 0`. The 3x3 homography sits in a 4x4 matrix with the z row and
 * column left as identity; CSS reads it column-major.
 */
export function homographyToMatrix3d(H: Homography): string {
  const [a, b, c, d, e, f, g, h] = H
  const m = [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1]
  return `matrix3d(${m.map((n) => (Number.isFinite(n) ? +n.toFixed(10) : 0)).join(",")})`
}

/**
 * True when the four points make a convex quadrilateral in order. A crossed ("bow-tie")
 * quad still has a homography, but it folds the image through infinity -- the picture would
 * vanish or explode on screen. The UI refuses to commit such a placement.
 */
export function isConvexQuad(p: Pt[]): boolean {
  if (p.length !== 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % 4]
    const [x3, y3] = p[(i + 2) % 4]
    const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2)
    if (Math.abs(cross) < 1e-12) return false
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    if (Math.abs(M[pivot][col]) < 1e-12) return null
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col] / M[col][col]
      if (factor === 0) continue
      for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}
