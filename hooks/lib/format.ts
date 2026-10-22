
// 1:05, 12:40, 1:02:03
export const clockOf = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

// claude-sonnet-5-5 -> Sonnet 5.5; anything else as it is.
export const shortModel = (id: string) => {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/i.exec(id)
  if (!m) return id || 'model'
  const name = m[1] ?? ''
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${m[2]}.${m[3]}`
}

// One line of a description, cut so a menu row stays one row.
export const oneLine = (text: string, max = 80) => {
  const first = text.split('\n')[0]?.trim() ?? ''
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`)

// ▰▰▱▱▱▱ for a percentage, and the theme color for how close it is to the limit.
export const meter = (n: number | null, width = 6) => {
  const full = n === null ? 0 : Math.max(0, Math.min(width, Math.round((n / 100) * width)))
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

export const level = (n: number | null) => (n === null ? 'inactive' : n < 50 ? 'success' : n < 80 ? 'warning' : 'error')


// An @-mention of a path, quoted when it has a space.
export const mention = (path: string) => (/\s/.test(path) ? `@"${path}" ` : `@${path} `)

export const join = (a: string, b: string) => (a ? `${a}/${b}` : b)

export const parent = (p: string) => p.split('/').slice(0, -1).join('/')

// 14:02: a moment as the clock on the wall reads it.
export const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// 2h 14m, 3d 4h, 45m: a span of milliseconds, coarse.
export const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`
}

export const WINDOW_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly', spend_limit: 'spend limit' }

export const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// 12.3k, 980: tokens as a person reads them.
export const kTok = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
