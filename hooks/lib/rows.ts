// How many rows a drawn tree takes, reckoned from the tree itself, for a menu that scrolls under a
// pinned head: the band draws the menu clipped to a window and moves it by the wheel, so it needs
// the menu's height to stop at its end. A reckoning, not the layout: text wraps at `width` cells
// (each character one cell), a Box in a row is as tall as its tallest child, in a column the sum,
// with its margins, paddings and border. A little over is harmless (a blank row at the end); under
// would hide the last rows, so it rounds up.
type Node = string | number | boolean | null | undefined | { type?: unknown; props?: Record<string, unknown> | null; children?: unknown } | readonly unknown[]

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const kidsOf = (n: any): unknown[] => {
  const kids = n?.children ?? n?.props?.children
  return kids === undefined || kids === null ? [] : Array.isArray(kids) ? kids : [kids]
}
// the text a Text holds, its nested Texts flattened
function textIn(node: unknown): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textIn).join('')
  return kidsOf(node).map(textIn).join('')
}
const linesOf = (text: string, width: number) =>
  text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil([...line].length / Math.max(1, width))), 0)

export function rowsOf(node: Node | unknown, width: number): number {
  if (node === null || node === undefined || node === false || node === true) return 0
  if (typeof node === 'string' || typeof node === 'number') return linesOf(String(node), width)
  if (Array.isArray(node)) return node.reduce((n: number, k) => n + rowsOf(k, width), 0)
  const n = node as any
  const p = (n.props ?? {}) as Record<string, unknown>
  if (p.display === 'none') return 0
  const type = typeof n.type === 'string' ? n.type : ''
  if (type === 'Text') return linesOf(textIn(n), width)
  // a picture: its own height in rows when it names one
  if (type === 'Svg' || type === 'Raster' || type === 'Image') return Math.max(1, Math.ceil(num(p.rows) || num(p.height) / 16 || 1))
  const border = p.borderStyle ? 2 : 0
  const padY = num(p.paddingY) * 2 + num(p.padding) * 2 + num(p.paddingTop) + num(p.paddingBottom)
  const padX = num(p.paddingX) * 2 + num(p.padding) * 2 + num(p.paddingLeft) + num(p.paddingRight)
  const marginY = num(p.marginY) * 2 + num(p.margin) * 2 + num(p.marginTop) + num(p.marginBottom)
  const inner = Math.max(1, width - padX - border)
  const kids = kidsOf(n).filter(k => k !== null && k !== undefined && k !== false && k !== true)
  // a Button lays out its label as a row; a Box is a row unless it says column
  const isColumn = type === 'Box' && String(p.flexDirection ?? 'row').startsWith('column')
  const gap = isColumn ? num(p.rowGap) || num(p.gap) : 0
  const body = !kids.length ? 0 : isColumn
    ? kids.reduce((s: number, k) => s + rowsOf(k, inner), 0) + gap * (kids.length - 1)
    // in a row the children share the width: their text together wraps as one line would
    : Math.max(...kids.map(k => rowsOf(k, inner)), kids.every(k => typeof k === 'string' || ['Text', 'Button'].includes(String((k as any)?.type))) ? linesOf(textIn(kids), inner) : 0)
  const fixed = num(p.height)
  return (fixed || body + padY + border) + marginY
}

// The row each keyed Button starts on, reckoned as rowsOf reckons the tree: for a focus ring that
// walks to a Button out of the window, so the window can follow it
export function keyRows(node: unknown, width: number, at = 0, into = new Map<string, number>()): Map<string, number> {
  if (node === null || node === undefined || typeof node !== 'object') return into
  if (Array.isArray(node)) {
    let row = at
    for (const k of node) {
      keyRows(k, width, row, into)
      row += rowsOf(k, width)
    }
    return into
  }
  const n = node as any
  const p = (n.props ?? {}) as Record<string, unknown>
  const key = typeof p.key === 'string' ? p.key : typeof n.key === 'string' ? n.key : ''
  const top = at + num(p.marginY) + num(p.margin) + num(p.marginTop)
  if (key && !into.has(key)) into.set(key, top)
  if (n.type === 'Text') return into
  const border = p.borderStyle ? 1 : 0
  const inner = Math.max(1, width - (num(p.paddingX) * 2 + num(p.padding) * 2 + num(p.paddingLeft) + num(p.paddingRight)) - border * 2)
  const start = top + border + num(p.paddingY) + num(p.padding) + num(p.paddingTop)
  const kids = kidsOf(n).filter(k => k !== null && k !== undefined && k !== false && k !== true)
  const isColumn = n.type === 'Box' && String(p.flexDirection ?? 'row').startsWith('column')
  const gap = isColumn ? num(p.rowGap) || num(p.gap) : 0
  let row = start
  for (const k of kids) {
    keyRows(k, inner, row, into)
    if (isColumn) row += rowsOf(k, inner) + gap
  }
  return into
}
