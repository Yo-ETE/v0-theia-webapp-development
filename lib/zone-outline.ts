/**
 * Draws zone walls onto an overlay canvas (heatmap or occupancy grid).
 *
 * The overlay canvases are mounted on the map CONTAINER at z-index 449/450, i.e. above the
 * whole Leaflet map pane (z 400) -- so every Leaflet vector, the zone polygons included, sits
 * under the heat. On top of that, heatmap mode styled the polygon as a 1px, 50%-opacity grey
 * dashed line. Over satellite imagery and 65%-opaque cells the walls simply vanished, and a
 * heatmap without walls cannot be read: the whole point is WHERE in the building the red is.
 *
 * So the canvas draws the walls itself, last, over its own cells: a light line on a dark halo,
 * which stays legible over red, blue, satellite and OSM alike. At night it uses the same dim
 * orange as the night-mode labels instead of white, which would wreck dark adaptation.
 */

type Polygon = [number, number][]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function strokeZoneOutlines(ctx: CanvasRenderingContext2D, map: any, polygons: Polygon[]) {
  if (!polygons?.length) return
  const night =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "night"
  const passes: [number, string][] = [
    [4, night ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.55)"],
    // Matches oklch(0.72 0.14 40), the night-mode label colour in globals.css.
    [2, night ? "rgba(224, 135, 90, 0.9)" : "rgba(255, 255, 255, 0.95)"],
  ]

  ctx.save()
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  for (const [width, colour] of passes) {
    ctx.lineWidth = width
    ctx.strokeStyle = colour
    for (const poly of polygons) {
      if (!poly || poly.length < 2) continue
      ctx.beginPath()
      for (let i = 0; i < poly.length; i++) {
        const p = map.latLngToContainerPoint([poly[i][0], poly[i][1]])
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      // A two-point zone is a facade: one wall, not a closed shape.
      if (poly.length > 2) ctx.closePath()
      ctx.stroke()
    }
  }
  ctx.restore()
}
