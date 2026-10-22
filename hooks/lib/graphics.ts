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
