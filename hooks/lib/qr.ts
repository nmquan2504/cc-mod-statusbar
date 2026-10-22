// A QR code encoder for the remote menu's link: byte mode, error correction L or M, versions 1
// to 10 (up to 271 bytes at L), the mask with the lowest penalty unless one is given. The
// layout follows ISO/IEC 18004 as Nayuki's reference generator does; it holds no shell or I/O.

export type QrLevel = 'L' | 'M'

// per version 1..10: error-correction codewords per block, and the number of blocks
const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
}
const BLOCKS: Record<QrLevel, number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
}
const FORMAT_BITS: Record<QrLevel, number> = { L: 1, M: 0 }
export const QR_MAX_VERSION = 10

// the modules a version leaves for data and error correction, after every function pattern
function rawModules(ver: number) {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}
const dataCodewords = (ver: number, level: QrLevel) =>
  Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[level][ver - 1]! * BLOCKS[level][ver - 1]!

function alignPositions(ver: number) {
  if (ver === 1) return []
  const size = ver * 4 + 17
  const count = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const at = [6]
  for (let pos = size - 7; at.length < count; pos -= step) at.splice(1, 0, pos)
  return at
}

// GF(256) over x^8 + x^4 + x^3 + x^2 + 1
function gfMul(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
function rsDivisor(degree: number) {
  const result = Array.from({ length: degree }, () => 0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root)
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!
    }
    root = gfMul(root, 0x02)
  }
  return result
}
function rsRemainder(data: number[], divisor: number[]) {
  const result = Array.from({ length: divisor.length }, () => 0)
  for (const b of data) {
    const factor = b ^ result.shift()!
    result.push(0)
    divisor.forEach((c, i) => { result[i] = result[i]! ^ gfMul(c, factor) })
  }
  return result
}

// The data codewords for the bytes, padded to the version's capacity.
function encodeData(bytes: Uint8Array, ver: number, level: QrLevel) {
  const bits: number[] = []
  const put = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capacity = dataCodewords(ver, level) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0))
  return out
}

// The data split into blocks, each with its error correction, interleaved.
function interleave(data: number[], ver: number, level: QrLevel) {
  const blocks = BLOCKS[level][ver - 1]!
  const eccLen = ECC_PER_BLOCK[level][ver - 1]!
  const raw = Math.floor(rawModules(ver) / 8)
  const shortCount = blocks - (raw % blocks)
  const shortLen = Math.floor(raw / blocks)
  const divisor = rsDivisor(eccLen)
  const all: number[][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1))
    k += dat.length
    const block = [...dat, ...rsRemainder(dat, divisor)]
    if (i < shortCount) block.splice(shortLen - eccLen, 0, 0)
    all.push(block)
  }
  const out: number[] = []
  for (let i = 0; i < all[0]!.length; i++)
    all.forEach((block, j) => { if (i !== shortLen - eccLen || j >= shortCount) out.push(block[i]!) })
  return out
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

// One symbol: modules[y][x], true for a dark module.
function build(codewords: number[], ver: number, level: QrLevel, mask: number) {
  const size = ver * 4 + 17
  const dark = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const fixed = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const set = (x: number, y: number, on: boolean) => {
    dark[y]![x] = on
    fixed[y]![x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4)
      }
  const align = alignPositions(ver)
  align.forEach((ay, i) => align.forEach((ax, j) => {
    const isCorner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)
    if (isCorner) return
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  // format bits: the level and the mask, BCH-coded, in two copies
  const data = (FORMAT_BITS[level] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fmt = ((data << 10) | rem) ^ 0x5412
  const bit = (v: number, i: number) => ((v >>> i) & 1) !== 0
  for (let i = 0; i <= 5; i++) set(8, i, bit(fmt, i))
  set(8, 7, bit(fmt, 6))
  set(8, 8, bit(fmt, 7))
  set(7, 8, bit(fmt, 8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fmt, i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(fmt, i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(fmt, i))
  set(8, size - 8, true)
  if (ver >= 7) {
    let vrem = ver
    for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25)
    const vbits = (ver << 12) | vrem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, bit(vbits, i))
      set(b, a, bit(vbits, i))
    }
  }
  // the codewords, in the zigzag of two-module columns from the bottom right
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (fixed[y]![x] || i >= codewords.length * 8) continue
        dark[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7))
        i++
      }
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (!fixed[y]![x] && MASKS[mask]!(x, y)) dark[y]![x] = !dark[y]![x]
  return dark
}

// The penalty the standard scores a mask by: runs of five or more, 2x2 blocks, finder-like
// patterns, and the balance of dark and light.
function penalty(m: boolean[][]) {
  const size = m.length
  let score = 0
  const line = (get: (i: number) => boolean) => {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++
      else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    const pattern = [true, false, true, true, true, false, true]
    for (let i = 0; i + 7 <= size; i++) {
      if (!pattern.every((p, k) => get(i + k) === p)) continue
      const lightBefore = i >= 4 && [1, 2, 3, 4].every(k => !get(i - k))
      const lightAfter = i + 11 <= size && [7, 8, 9, 10].every(k => !get(i + k))
      if (lightBefore || lightAfter) score += 40
    }
  }
  for (let y = 0; y < size; y++) line(x => m[y]![x]!)
  for (let x = 0; x < size; x++) line(y => m[y]![x]!)
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y]![x]
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3
    }
  const darkCount = m.reduce((n, row) => n + row.filter(Boolean).length, 0)
  const total = size * size
  score += Math.max(0, Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10
  return score
}

// The symbol for `text` (UTF-8): the smallest version that holds it, the given mask or the one
// that scores lowest. Throws when the text is longer than version 10 holds.
export function qrMatrix(text: string, level: QrLevel = 'L', mask?: number) {
  const bytes = new TextEncoder().encode(text)
  let ver = 1
  while (ver <= QR_MAX_VERSION && 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver, level) * 8) ver++
  if (ver > QR_MAX_VERSION) throw new Error(`qr: ${bytes.length} bytes is more than version ${QR_MAX_VERSION} holds`)
  const codewords = interleave(encodeData(bytes, ver, level), ver, level)
  if (mask !== undefined) return build(codewords, ver, level, mask)
  let best: boolean[][] | undefined
  let bestScore = Infinity
  for (let k = 0; k < 8; k++) {
    const m = build(codewords, ver, level, k)
    const s = penalty(m)
    if (s < bestScore) {
      best = m
      bestScore = s
    }
  }
  return best!
}

// The symbol as rows of text, two module rows per text row: a light module is drawn (█ ▀ ▄), a
// dark one left blank, for white text on black. `quiet` light modules ring it.
export function qrRows(m: boolean[][], quiet = 2) {
  const size = m.length + quiet * 2
  const isLight = (x: number, y: number) => {
    const mx = x - quiet, my = y - quiet
    return mx < 0 || my < 0 || mx >= m.length || my >= m.length || !m[my]![mx]
  }
  const rows: string[] = []
  for (let y = 0; y < size; y += 2) {
    let row = ''
    for (let x = 0; x < size; x++) {
      const top = isLight(x, y), bottom = y + 1 < size ? isLight(x, y + 1) : false
      row += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    rows.push(row)
  }
  return rows
}
