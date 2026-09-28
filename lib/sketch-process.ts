/**
 * Turns a photo of a hand-drawn plan into ink on a transparent background.
 *
 * A single global threshold does not survive a phone photo of paper: the light falls off
 * across the sheet, the phone casts a shadow, and a pencil line on the bright side can be
 * lighter than bare paper on the dim side. So the paper brightness is estimated LOCALLY --
 * the brightest pixels in a coarse grid, spread to neighbours so a cell filled with ink still
 * gets a paper level -- and a pixel is ink when it is markedly darker than the paper around
 * it. What is left is recoloured, so the plan reads on a satellite photo.
 *
 * The core works on raw RGBA arrays, with no DOM, so it can be tested outside a browser.
 */

export interface SketchCrop {
  /** Fractions of the source image, 0..1. */
  x: number
  y: number
  w: number
  h: number
}

export interface SketchStyle {
  /** Keep the photo as is (a drone shot) or extract the ink (a drawing). */
  removeBackground: boolean
  /** 0..1. Higher keeps fainter strokes (pencil); lower keeps only firm ones (marker). */
  sensitivity: number
  /** Ink colour on the map, "#rrggbb". */
  inkColor: string
}

export const DEFAULT_CROP: SketchCrop = { x: 0, y: 0, w: 1, h: 1 }
export const DEFAULT_STYLE: SketchStyle = { removeBackground: true, sensitivity: 0.5, inkColor: "#22d3ee" }

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [34, 211, 238]
}

/** Local paper brightness for every pixel. */
export function estimatePaper(lum: Float32Array, w: number, h: number): Float32Array {
  const cell = Math.max(8, Math.round(Math.max(w, h) / 48))
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  const grid = new Float32Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell)
    for (let x = 0; x < w; x++) {
      const i = gy * gw + Math.floor(x / cell)
      const v = lum[y * w + x]
      if (v > grid[i]) grid[i] = v
    }
  }
  // Dilate: a cell entirely covered by a thick marker would otherwise take the ink's own
  // brightness as "paper", and the fill would vanish. One cell of reach only rescued the
  // EDGES of a filled area -- a 60 px block lost its centre in testing -- so the reach is
  // three cells: fills up to ~7 cells wide (about 2.5 cm of an A4 sheet at 1600 px) survive,
  // while the paper estimate still follows the lighting gradient closely.
  const R = 3
  const rows = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let best = 0
      for (let d = -R; d <= R; d++) {
        const xx = gx + d
        if (xx >= 0 && xx < gw) best = Math.max(best, grid[gy * gw + xx])
      }
      rows[gy * gw + gx] = best
    }
  }
  const dil = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let best = 0
      for (let d = -R; d <= R; d++) {
        const yy = gy + d
        if (yy >= 0 && yy < gh) best = Math.max(best, rows[yy * gw + gx])
      }
      dil[gy * gw + gx] = best
    }
  }
  // Bilinear between cell centres, so the estimate has no visible block edges.
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(gh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(gw - 1, x0 + 1)
      const tx = fx - x0
      const top = dil[y0 * gw + x0] * (1 - tx) + dil[y0 * gw + x1] * tx
      const bot = dil[y1 * gw + x0] * (1 - tx) + dil[y1 * gw + x1] * tx
      out[y * w + x] = top * (1 - ty) + bot * ty
    }
  }
  return out
}

/** RGBA in, RGBA out, same size. */
export function processSketchPixels(
  src: Uint8ClampedArray, w: number, h: number, style: SketchStyle,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  if (!style.removeBackground) {
    out.set(src)
    return out
  }
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]
  }
  const paper = estimatePaper(lum, w, h)
  const s = Math.min(1, Math.max(0, style.sensitivity))
  // A pixel at `cut` times the paper brightness is half ink; `soft` keeps edges anti-aliased.
  const cut = 0.62 + 0.3 * s
  const soft = 0.1
  const [r, g, b] = hexToRgb(style.inkColor)
  for (let i = 0; i < w * h; i++) {
    const ratio = lum[i] / Math.max(1, paper[i])
    const t = Math.min(1, Math.max(0, (cut - ratio) / soft + 0.5))
    const o = i * 4
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = Math.round(255 * t)
  }
  return out
}

// ── Browser side ────────────────────────────────────────────────────────────────────────

/**
 * Load an image the canvas is allowed to read back.
 *
 * The page and the API are different origins (:3000 and :8000), and a cross-origin <img>
 * taints the canvas: getImageData then throws and the ink extraction is impossible. Fetching
 * with the session cookie and going through a same-origin blob: URL sidesteps that without
 * relying on per-image CORS headers.
 */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) throw new Error(`Image introuvable (${res.status})`)
  const objectUrl = URL.createObjectURL(await res.blob())
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Image illisible"))
      img.src = objectUrl
    })
  } finally {
    // The decoded image survives revoking its URL; drawImage keeps working.
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Crop, downscale and process into a canvas. `maxDim` bounds the work on a phone: the
 * per-pixel pass is linear, and 1600 px is plenty to read a drawn wall.
 */
export function renderSketch(
  img: HTMLImageElement, crop: SketchCrop, style: SketchStyle, maxDim = 1600,
): HTMLCanvasElement {
  const sx = Math.round(crop.x * img.naturalWidth)
  const sy = Math.round(crop.y * img.naturalHeight)
  const sw = Math.max(1, Math.round(crop.w * img.naturalWidth))
  const sh = Math.max(1, Math.round(crop.h * img.naturalHeight))
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  if (style.removeBackground) {
    const data = ctx.getImageData(0, 0, w, h)
    data.data.set(processSketchPixels(data.data, w, h, style))
    ctx.putImageData(data, 0, 0)
  }
  return canvas
}
