import { pct } from './format'

// ---- graphics: Raster cells, truecolor, for the terminal ---------------------
// A cell is [codePoint, foreground, background]; 0x01000000 is the terminal's own color.
export const DEFAULT = 0x01000000

export const TRACK = 0x3a3d4d

export const cellsOf = (cells: number[][]) =>
  (new Uint8Array(Uint32Array.from(cells.flat()).buffer) as unknown as { toBase64: () => string }).toBase64()

// One color for the whole fill, by how much is used: green, amber from 50%, red from 80%,
// the same steps as the figure's own color (level)
export const GREEN = 0x4ade80

export const AMBER = 0xfbbf24

export const RED = 0xf87171

export const fillColor = (n: number) => (n < 50 ? GREEN : n < 80 ? AMBER : RED)

export const mix = (a: number, b: number, t: number) => {
  const ch = (c: number, k: number) => (c >> k) & 0xff
  const one = (k: number) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t)
  return (one(16) << 16) | (one(8) << 8) | one(0)
}

// A gauge `width` cells wide, filled to n%: every cell is a space on a background color, so
// it fills the row at any line height. Filled cells take the one color of fillColor; the cell the fill
// ends in is blended with the track by how much of it is filled.
// Each cell's background, as 0xRRGGBB.
export const gaugeColors = (n: number | null, width: number) => {
  const fill = n === null ? 0 : Math.max(0, Math.min(1, n / 100)) * width
  const color = fillColor(n ?? 0)
  const row: number[] = []
  for (let i = 0; i < width; i++) {
    const part = Math.max(0, Math.min(1, fill - i))
    row.push(part >= 1 ? color : part > 0 ? mix(TRACK, color, part) : TRACK)
  }
  return row
}

export const gauge = (n: number | null, width: number) => cellsOf(gaugeColors(n, width).map(bg => [0x20, DEFAULT, bg]))

// The terminal's usage gauge: GAUGE_CELLS cells with the figure centred in them, ' 23% '.
export const GAUGE_CELLS = 5

export const inGauge = (n: number | null) => {
  const t = pct(n)
  const pad = Math.max(0, GAUGE_CELLS - t.length)
  return ' '.repeat(Math.floor(pad / 2)) + t + ' '.repeat(pad - Math.floor(pad / 2))
}

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

// ---- the desktop's usage gauge: an Svg ----------------------------------------
// A rounded bar `width` by `height` px filled to n% in fillColor on the track, for a surface that
// draws Svg (the desktop draws ▰▱ text as thin dashes). With `pace`, the share of the window's time
// already gone (0 to 1), a white tick stands there: a fill past the tick spends faster than the
// window runs.
export const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 24 * 3600_000 }

export const paceOf = (kind: string, resetsAt: string | undefined, now: number) => {
  const span = WINDOW_MS[kind]
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (!span || Number.isNaN(at)) return undefined
  return Math.max(0, Math.min(1, 1 - (at - now) / span))
}

export function gaugeSvg(n: number | null, opts: { width?: number; height?: number; pace?: number } = {}) {
  const w = opts.width ?? 200
  const h = opts.height ?? 10
  const r = h / 2
  const share = n === null ? 0 : Math.max(0, Math.min(1, n / 100))
  const fillW = share > 0 ? Math.max(h, share * w) : 0
  const fill = fillW ? `<rect x="0" y="0" width="${fillW.toFixed(1)}" height="${h}" rx="${r}" fill="${hex(fillColor(n ?? 0))}"/>` : ''
  const tickX = opts.pace === undefined ? null : Math.max(1, Math.min(w - 1, opts.pace * w))
  const tick = tickX === null ? '' : `<rect x="${(tickX - 1).toFixed(1)}" y="-2" width="2" height="${h + 4}" rx="1" fill="#ffffff" opacity="0.85"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 4}" viewBox="0 -2 ${w} ${h + 4}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="${hex(TRACK)}"/>${fill}${tick}</svg>`
}
