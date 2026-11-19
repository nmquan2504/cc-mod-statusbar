import { cfg, claudeGlyph } from '../state/config'
import { rt } from '../state/runtime'

// ---- arcade: while Claude works, monsters walk in from the left and Claude shoots them ----
// It plays in the gap between the bar's two groups:  [✻] [● model] folder  3 ✝ ᗣ  Ѫ ✺ - -  ─━╦✻  5h … ◈
// A plain simulation in module variables: a 120 ms clock steps it and asks for a redraw,
// the band only reads it. Every glyph is one cell wide (East Asian width N or Na), but for some guns.

// `pos` moves `speed` cells a tick; `x` is the cell it is drawn in.
// isError: the boss a failed tool call sends in. Bullets do not touch it; the next call that
// succeeds bursts it, and until then it waits in front of Claude.
export type Monster = { x: number; pos: number; speed: number; hp: number; glyph: string; color: string; age: number; isBoss?: boolean; isError?: boolean }

export type Blast = { x: number; ttl: number }

// Every glyph is one cell (East Asian width N) and drawn by a font macOS ships, so the VS Code
// terminal shows them; ☠ is left out, as macOS draws it as a two-cell emoji.
export const MONSTERS = [
  { glyph: 'ᗣ', hp: 1 },
  { glyph: 'ᗤ', hp: 1 },
  { glyph: 'Ѫ', hp: 2 },
  { glyph: '⍤', hp: 1 },
  { glyph: 'Ӝ', hp: 2 },
  { glyph: 'Ѯ', hp: 1 },
  { glyph: 'ʬ', hp: 1 },
  { glyph: 'ᘛ', hp: 1 },
  { glyph: '⍢', hp: 2 },
  { glyph: '⍨', hp: 1 },
]

// A random hue at a fixed saturation and lightness: every monster bright on a dark terminal.
export function monsterColor() {
  const h = Math.random() * 360, sat = 0.85, light = 0.62
  const k = (n: number) => (n + h / 30) % 12
  const f = (n: number) => light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

// Every BOSS_EVERY kills a boss walks in: slow, five hits, and it bursts three cells wide.
export const BOSS = { glyph: 'Ѭ', hp: 5, color: 'claude', speed: 0.08 }

// The tools Claude calls, each as the monster it sends into the arena.
export const TOOL_MONSTER: { re: RegExp; glyph: string; hp: number }[] = [
  { re: /^Bash$/, glyph: 'ᗣ', hp: 1 },
  { re: /^(Edit|Write|NotebookEdit)$/, glyph: 'Ѫ', hp: 2 },
  { re: /^(Read|Grep|Glob)$/, glyph: '⍤', hp: 1 },
  { re: /^mcp__/, glyph: 'Ӝ', hp: 2 },
  { re: /^(Agent|Task)$/, glyph: 'Ѯ', hp: 2 },
  { re: /^Web/, glyph: 'ᘛ', hp: 1 },
]

export const toolMonster = (tool: string) => TOOL_MONSTER.find(t => t.re.test(tool)) ?? { glyph: '⍨', hp: 1 }

// Ж (U+0416): East Asian width A, one cell in the VS Code terminal and any non-CJK locale
export const ERROR_BOSS = { glyph: 'Ж', color: '#ff4d4f', speed: 0.1 }

// How long Claude shows a hit, in 120 ms ticks: about a second.
export const HURT_TICKS = 8

// What the tool calls ask of the arena, taken on its next step: a monster for each call, a
// boss for each failure, a burst for each success after one, a volley for a task done.
export const arenaEvents = { spawns: [] as string[], errors: 0, fixes: 0, volleys: 0, lastToolAt: 0 }

// Without a tool call for this long, a monster of its own walks in now and then.
export const QUIET_MS = 4000

export const BOSS_EVERY = 10

// A monster's speed in cells a tick, drawn evenly from this range: a crawler crosses a cell in
// about a second, a runner in 150 ms.
export const SPEED_MIN = 0.12

export const SPEED_MAX = 0.8

// Ticks between two monsters, drawn evenly from this range: 0.5 to 3 seconds at 120 ms a tick.
export const SPAWN_MIN = 4

export const SPAWN_MAX = 25

export const randomWait = () => SPAWN_MIN + Math.floor(Math.random() * (SPAWN_MAX - SPAWN_MIN + 1))

export const arena = {
  // hits: monsters that reached Claude this turn; hurtUntil: the tick Claude shows red until
  // isFiring: Claude fired this tick, so the muzzle flashes 💥 (cfg.muzzleFlash)
  width: 60, tick: 0, kills: 0, hits: 0, hurtUntil: 0, nextSpawn: SPAWN_MIN, bossDue: BOSS_EVERY, isFiring: false,
  monsters: [] as Monster[], bullets: [] as number[], blasts: [] as Blast[],
}

// After the turn ends Claude stays on the field this long, the monsters left bursting, then it clears.
export const LINGER_MS = 3000

// The turn ended: every monster still walking bursts, and Claude stands a while.
export function endRound() {
  const a = arena
  for (const m of a.monsters) a.blasts.push({ x: m.x, ttl: 3 })
  a.monsters = []
  a.bullets = []
  a.isFiring = false
  rt.lingerUntil = Date.now() + LINGER_MS
}

// The blasts fade while Claude lingers; true once the linger is over and the field is cleared.
export function stepLinger(): boolean {
  arena.blasts = arena.blasts.map(b => ({ ...b, ttl: b.ttl - 1 })).filter(b => b.ttl > 0)
  if (Date.now() < rt.lingerUntil) return false
  rt.lingerUntil = 0
  resetArena()
  return true
}

// The cells a string takes: two for a wide character (CJK, fullwidth forms, an emoji), else one
export function cellsOf(text: string) {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    const isWide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
      || (c >= 0x1f300 && c <= 0x1faff)
    n += isWide ? 2 : 1
  }
  return n
}

// Claude with the gun Settings picked (config's GUNS), muzzle on the left, ✻ at the right end
export const claudeCells = () => cellsOf(claudeGlyph())
export const gunAt = () => arena.width - claudeCells() // the gun's first cell; ✻ sits at its right end

// Ticks a monster is on the field before Claude fires at it: about half a second.
export const SIGHT = 4

// Cells between the arena and its neighbours: the branch on its left, the clock on its right.
export const ARENA_GAP = 2

// Below this many cells the gap is too narrow to play in, and the bar draws without it.
export const ARENA_MIN = 16

export function stepArena() {
  const a = arena
  a.tick++
  a.isFiring = false
  // each monster walks at its own random speed; the next one comes after a random wait
  // (SPAWN_MIN to SPAWN_MAX ticks), held back while the door is still taken
  for (const m of a.monsters) {
    m.pos = m.isError ? Math.min(m.pos + m.speed, gunAt() - 2) : m.pos + m.speed
    m.x = Math.floor(m.pos)
  }
  const ev = arenaEvents
  // a failed call: its boss walks in at once
  for (; ev.errors > 0; ev.errors--)
    a.monsters.push({ x: 0, pos: 0, speed: ERROR_BOSS.speed, hp: 1, glyph: ERROR_BOSS.glyph, color: ERROR_BOSS.color, age: 0, isError: true })
  // a call that succeeded: the oldest error boss bursts, three cells wide
  for (; ev.fixes > 0; ev.fixes--) {
    const boss = a.monsters.find(m => m.isError && m.hp > 0)
    if (!boss) { ev.fixes = 0; break }
    boss.hp = 0
    a.kills++
    for (const dx of [-1, 0, 1]) if (boss.x + dx >= 0) a.blasts.push({ x: boss.x + dx, ttl: 4 })
  }
  // a task done: a volley clears the field, error bosses aside
  if (ev.volleys > 0) {
    ev.volleys = 0
    for (const m of a.monsters) if (m.hp > 0 && !m.isError) {
      m.hp = 0
      a.kills++
      a.blasts.push({ x: m.x, ttl: 4 })
    }
    a.bullets = Array.from({ length: Math.floor(gunAt() / 3) }, (_, i) => gunAt() - 1 - i * 3)
    a.isFiring = true
  }
  // a tool call: its monster walks in as soon as the door is free
  if (ev.spawns.length && !a.monsters.some(m => m.x < 2)) {
    const kind = toolMonster(ev.spawns.shift()!)
    const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN)
    a.monsters.push({ x: 0, pos: 0, speed, hp: kind.hp, glyph: kind.glyph, color: monsterColor(), age: 0 })
  }
  const isQuiet = Date.now() - ev.lastToolAt > QUIET_MS
  if (isQuiet && a.tick >= a.nextSpawn && !a.monsters.some(m => m.x < 3)) {
    if (a.kills >= a.bossDue && !a.monsters.some(m => m.isBoss)) {
      a.monsters.push({ x: 0, pos: 0, speed: BOSS.speed, hp: BOSS.hp, glyph: BOSS.glyph, color: BOSS.color, age: 0, isBoss: true })
    } else {
      const kind = MONSTERS[Math.floor(Math.random() * MONSTERS.length)]!
      const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN)
      a.monsters.push({ x: 0, pos: 0, speed, hp: kind.hp, glyph: kind.glyph, color: monsterColor(), age: 0 })
    }
    a.nextSpawn = a.tick + randomWait()
  }
  // bullets fly two cells a tick. Claude fires every third tick, and only at a monster it has
  // seen for a moment (SIGHT ticks) that the bullets already flying will not finish off
  for (const m of a.monsters) m.age++
  a.bullets = a.bullets.map(x => x - 2)
  const targets = a.monsters.filter(m => m.age >= SIGHT && !m.isError).reduce((hp, m) => hp + m.hp, 0)
  if (a.tick % 3 === 0 && targets > a.bullets.length) {
    a.bullets.push(gunAt() - 1)
    a.isFiring = true
  }
  // a bullet hits the nearest monster it has reached or passed this tick
  for (const m of [...a.monsters].sort((p, q) => q.x - p.x)) {
    if (m.isError) continue // bullets pass an error boss by: only a success bursts it
    const hit = a.bullets.findIndex(x => x <= m.x)
    if (hit < 0) continue
    a.bullets.splice(hit, 1)
    if (--m.hp === 0) {
      a.kills++
      if (m.isBoss) {
        a.bossDue = a.kills + BOSS_EVERY
        for (const dx of [-1, 0, 1]) if (m.x + dx >= 0) a.blasts.push({ x: m.x + dx, ttl: 4 })
      } else a.blasts.push({ x: m.x, ttl: 3 })
    }
  }
  // one that reaches Claude bursts on the gun: a hit, counted, and Claude shows red a second
  for (const m of a.monsters) if (m.hp > 0 && !m.isError && m.x >= gunAt() - 1) {
    m.hp = 0
    a.hits++
    a.hurtUntil = a.tick + HURT_TICKS
    a.blasts.push({ x: m.x, ttl: 3 })
  }
  a.monsters = a.monsters.filter(m => m.hp > 0)
  a.bullets = a.bullets.filter(x => x >= 0)
  a.blasts = a.blasts.map(b => ({ ...b, ttl: b.ttl - 1 })).filter(b => b.ttl > 0)
}

export function resetArena() {
  Object.assign(arenaEvents, { spawns: [], errors: 0, fixes: 0, volleys: 0 })
  Object.assign(arena, { tick: 0, kills: 0, hits: 0, hurtUntil: 0, nextSpawn: randomWait(), bossDue: BOSS_EVERY, isFiring: false, monsters: [], bullets: [], blasts: [] })
}

// The row as runs of one color: [text, color].
export function arenaRuns(): [string, string][] {
  const a = arena
  const cells: [string, string][] = Array.from({ length: a.width }, () => [' ', 'text'])
  for (const x of a.bullets) if (x < a.width) cells[x] = ['-', 'claude']
  for (const m of a.monsters) if (m.x < a.width) cells[m.x] = [m.glyph, m.color]
  for (const b of a.blasts) if (b.x < a.width) cells[b.x] = [b.ttl > 1 ? '✺' : '⁕', 'warning']
  // the flash takes the two cells before the muzzle: 💥 is two cells wide, so the second stays empty
  if (cfg.muzzleFlash && a.isFiring && gunAt() >= 2) {
    cells[gunAt() - 2] = ['💥', 'warning']
    cells[gunAt() - 1] = ['', 'warning']
  }
  cells.length = gunAt() // the band draws the gun and Claude as a Button after these cells
  const runs: [string, string][] = []
  for (const [ch, color] of cells) {
    const last = runs[runs.length - 1]
    if (last && last[1] === color) last[0] += ch
    else runs.push([ch, color])
  }
  return runs
}
