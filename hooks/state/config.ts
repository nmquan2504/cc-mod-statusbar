

// What the person set in the bar's Settings menu (+ then s), kept across sessions in this mod's store.
export const cfg = {
  // what the bar shows, each its own switch (+ then Settings, On the bar); the arena is arcade
  barModel: true,
  barEffort: true,
  barFolder: true,
  barGit: true,
  barUsage: true,
  // ⇄, drawn only while Self remote is on: this switch hides the chip, not the remote
  barRemote: true,
  barImages: true,
  barMcp: true,
  barMode: true,
  barGuard: true,
  arcade: true,
  // the items' order, left to right, as BAR_ITEMS keys; those before the arena sit left of it
  barOrder: 'barModel,barEffort,barMode,barFolder,barGit,arcade,barUsage,barRemote,barImages,barMcp,barGuard',
  // on: the 4-cell gauge and the figure (5h ▰▱▱▱ 21%); off: the figure alone (5h 21%)
  usageGauge: true,
  gitMarks: true,
  ctxChip: true,
  turnToast: true,
  usageAlertLow: 80,
  usageAlertHigh: 90,
  ctxChipAt: 70,
  ctxToastAt: 85,
  turnToastSeconds: 10,
  // how many of the commands you type most head the commands menu
  topCommands: 5,
  // after a turn of summarySeconds or more, Haiku writes what was done and the result
  turnSummary: true,
  summarySeconds: 60,
  // + then Polish writes the prompt in English as well
  polishEnglish: false,
  // with no suggestion of Claude Code's own after an answer, Haiku proposes the chips
  haikuChips: true,
  // rm -rf, git push --force and the like always ask the person, whatever the mode
  dangerConfirm: true,
  // a turn stopped by the 5-hour or weekly limit gets "continue" once the window resets (usage menu)
  autoContinue: true,
  // "hi" every 5 hours from hiStartHour, Vietnam time, so a usage window starts on the hour
  hiSchedule: true,
  hiStartHour: 7,
  hiStartMinute: 0,
  // Self remote: the ⇄ chip, a link the phone opens through a Cloudflare quick tunnel; off by default
  selfRemote: false,
  // minutes with no phone watching before the hub stops; 0: never (it still stops with no session)
  remoteIdleMinutes: 30,
}

export type CfgKey = keyof typeof cfg

export const DEFAULTS = { ...cfg }

export const SETTINGS_KEY = 'settings'

// The remote's idle time as − and + step it: off, then minutes, hours and days, up to a week
export const REMOTE_IDLE_STOPS = [0, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 2880, 4320, 10080] as const

// A number row's next value, `dir` −1 or +1: its step held to its range, or its next stop (from a
// value between stops, the nearest one that way)
export function stepped(row: { step: number; min: number; max: number; stops?: readonly number[] }, n: number, dir: -1 | 1) {
  if (!row.stops) return Math.min(row.max, Math.max(row.min, n + dir * row.step))
  const next = dir > 0 ? row.stops.find(s => s > n) : [...row.stops].reverse().find(s => s < n)
  return next ?? n
}

// A value of the wrong type, or a number outside its row's range, keeps the default.
export function readOptions(stored: Readonly<Record<string, unknown>>) {
  for (const key of Object.keys(cfg) as CfgKey[]) {
    const v = stored[key]
    const row = SETTINGS.find(r => r.key === key)
    if (typeof v !== typeof cfg[key]) continue
    if (typeof v === 'number' && row?.kind === 'number' && (v < row.min || v > row.max)) continue
    ;(cfg as Record<string, unknown>)[key] = v
  }
}

// The bar's order as an earlier version shipped it (the mode at the right end): one saved
// unchanged was never moved by hand, so it takes the order shipped now.
const OLD_BAR_ORDERS = ['barModel,barEffort,barFolder,barGit,arcade,barUsage,barRemote,barImages,barMcp,barMode,barGuard']

export async function loadSettings($: any) {
  const stored = await $.store.get(SETTINGS_KEY).catch(() => undefined)
  if (stored && typeof stored === 'object') readOptions(stored as Record<string, unknown>)
  if (OLD_BAR_ORDERS.includes(cfg.barOrder)) cfg.barOrder = DEFAULTS.barOrder
}

// Every save keeps what it replaces, newest last, so Settings can put the one before back.
export const HISTORY_KEY = 'settings-history'
export const HISTORY_MAX = 20
export type SettingsSnapshot = { at: number; settings: Record<string, unknown> }
export async function saveSettings($: any) {
  const before = await $.store.get(SETTINGS_KEY).catch(() => undefined)
  const now = { ...cfg }
  if (before && typeof before === 'object' && JSON.stringify(before) !== JSON.stringify(now)) {
    const kept = ((await $.store.get(HISTORY_KEY).catch(() => undefined)) ?? []) as SettingsSnapshot[]
    await $.store.set(HISTORY_KEY, [...kept, { at: Date.now(), settings: before as Record<string, unknown> }].slice(-HISTORY_MAX))
  }
  await $.store.set(SETTINGS_KEY, now)
  $.ui.invalidate('ui.render')
}
// Puts the settings before the last change back, and drops that copy; false with none kept.
export async function restorePreviousSettings($: any) {
  const kept = ((await $.store.get(HISTORY_KEY).catch(() => undefined)) ?? []) as SettingsSnapshot[]
  const last = kept[kept.length - 1]
  if (!last) return false
  Object.assign(cfg, DEFAULTS)
  readOptions(last.settings)
  await $.store.set(SETTINGS_KEY, { ...cfg })
  await $.store.set(HISTORY_KEY, kept.slice(0, -1))
  $.ui.invalidate('ui.render')
  return true
}

// The settings as text for another machine: every switch, number and the bar's order. The
// vault's secrets live in the keychain and its store keys, never in cfg, so none goes with it.
export const settingsText = () => JSON.stringify({ 'cc-mod-statusbar': 'settings', settings: { ...cfg } }, null, 2)

// Takes settings pasted from settingsText (or a bare object of them) in place of the ones in force;
// a key it lacks gets its default, a bad value keeps it. Returns how many known keys it held, 0
// when the text holds no settings, and then changes nothing. Undo puts the earlier ones back.
export async function importSettings($: any, text: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 0
  }
  const wrapped = parsed && typeof parsed === 'object' ? (parsed as { settings?: unknown }).settings ?? parsed : undefined
  if (!wrapped || typeof wrapped !== 'object') return 0
  const given = wrapped as Record<string, unknown>
  const known = Object.keys(given).filter(k => k in DEFAULTS)
  if (!known.length) return 0
  Object.assign(cfg, DEFAULTS)
  readOptions(given)
  await saveSettings($)
  return known.length
}

// The Settings menu's rows, in order: a switch, or a number with its step and range. A number with
// `stops` steps through those values instead, and one with `span` is written as a span of time
// (spanText). A row with a group is drawn under that group's own heading, after the rows without one.
export const SETTINGS: ((
  | { key: CfgKey; kind: 'switch'; label: string; note: string }
  | { key: CfgKey; kind: 'number'; label: string; note: string; step: number; min: number; max: number; unit: string; stops?: readonly number[]; span?: true }
) & { group?: 'remote' })[] = [
  { key: 'usageGauge', kind: 'switch', label: 'Usage gauges', note: 'on: gauge and figure (5h ▰▱▱▱ 21%); off: the figure alone (5h 21%)' },
  { key: 'gitMarks', kind: 'switch', label: 'Git marks', note: 'files changed, commits to push and to pull' },
  { key: 'ctxChip', kind: 'switch', label: 'Context chip', note: 'ctx n% on the bar past the threshold below' },
  { key: 'turnToast', kind: 'switch', label: 'Turn toast', note: "a long turn's time and cost when it ends" },
  { key: 'usageAlertLow', kind: 'number', label: 'Usage alert, first', note: 'a toast', step: 5, min: 5, max: 100, unit: '%' },
  { key: 'usageAlertHigh', kind: 'number', label: 'Usage alert, second', note: 'a toast, and the figure blinks', step: 5, min: 5, max: 100, unit: '%' },
  { key: 'ctxChipAt', kind: 'number', label: 'Context chip from', note: 'of the context window', step: 5, min: 5, max: 100, unit: '%' },
  { key: 'ctxToastAt', kind: 'number', label: 'Context toast at', note: 'a toast once, the chip turns red', step: 5, min: 5, max: 100, unit: '%' },
  { key: 'turnToastSeconds', kind: 'number', label: 'Turn toast after', note: 'seconds a turn runs', step: 5, min: 0, max: 600, unit: ' s' },
  { key: 'topCommands', kind: 'number', label: 'Most used commands', note: 'how many head the commands menu', step: 1, min: 5, max: 10, unit: '' },
  { key: 'turnSummary', kind: 'switch', label: 'Turn summary', note: 'after a long turn, Haiku writes what was done and the result (tasks menu)' },
  { key: 'summarySeconds', kind: 'number', label: 'Summary after', note: 'seconds a turn runs', step: 10, min: 0, max: 600, unit: ' s' },
  { key: 'polishEnglish', kind: 'switch', label: 'Polish in English', note: '+ then Polish also translates the prompt to English' },
  { key: 'haikuChips', kind: 'switch', label: 'Haiku chips', note: "when Claude Code suggests nothing after an answer, Haiku proposes what to send (one call a turn); off: Claude Code's own suggestion alone" },
  { key: 'hiSchedule', kind: 'switch', label: 'Auto-start 5h window', note: 'a hidden Haiku agent says hi every 5 hours from the start hour below, Vietnam time, so each window opens on the hour; status in the usage menu' },
  { key: 'hiStartHour', kind: 'number', label: 'Schedule starts at', note: 'each day, Vietnam time (UTC+7)', step: 1, min: 0, max: 23, unit: 'h' },
  { key: 'hiStartMinute', kind: 'number', label: 'Schedule starts at, minute', note: 'past that hour, in steps of 15', step: 15, min: 0, max: 45, unit: 'm' },
  { key: 'dangerConfirm', kind: 'switch', label: 'Confirm dangerous commands', note: 'rm -rf, push --force, reset --hard, curl | sh ask you, even in auto mode' },
  { key: 'selfRemote', kind: 'switch', label: 'Self remote', note: 'the ⇄ chip on the bar', group: 'remote' },
  { key: 'remoteIdleMinutes', kind: 'number', label: 'Remote stops after', note: 'with no phone watching; off: it stops only when no session runs', step: 5, min: 0, max: 10080, unit: '', stops: REMOTE_IDLE_STOPS, span: true, group: 'remote' },
]

// The bar's items as Settings lists them, left to right, each with the switch that shows it.
export const BAR_ITEMS: { key: CfgKey; label: string }[] = [
  { key: 'barModel', label: '● model' },
  { key: 'barEffort', label: '◔ effort' },
  { key: 'barMode', label: '‖ mode' },
  { key: 'barFolder', label: '/folder' },
  { key: 'barGit', label: '⎇ git' },
  { key: 'arcade', label: '¬✻ arena' },
  { key: 'barUsage', label: '5h usage' },
  { key: 'barRemote', label: '⇄ remote' },
  { key: 'barImages', label: '▣ images' },
  { key: 'barMcp', label: '⌁ mcp' },
  { key: 'barGuard', label: '◈ guardrails' },
]

// The bar's items in the order Settings set: unknown or repeated keys dropped, a missing one put
// back where BAR_ITEMS has it, so an order saved by an older version still draws every item.
export function barOrder(): CfgKey[] {
  const known = BAR_ITEMS.map(i => i.key)
  const order = cfg.barOrder.split(',').filter((k, i, all): k is CfgKey => known.includes(k as CfgKey) && all.indexOf(k) === i)
  for (const k of known) if (!order.includes(k)) order.splice(Math.min(known.indexOf(k), order.length), 0, k)
  return order
}

// Moves an item one place left (-1) or right (1) on the bar; past the arena it changes sides.
export async function moveBarItem($: any, key: CfgKey, by: -1 | 1) {
  const order = barOrder()
  const at = order.indexOf(key)
  const to = at + by
  if (at < 0 || to < 0 || to >= order.length) return
  ;[order[at], order[to]] = [order[to]!, order[at]!]
  cfg.barOrder = order.join(',')
  await saveSettings($)
}

// The bar's looks, one press each: which of BAR_ITEMS each shows.
export const BAR_PRESETS: { name: string; note: string; on: CfgKey[] }[] = [
  { name: 'Full', note: 'every item', on: BAR_ITEMS.map(i => i.key) },
  { name: 'Focus', note: 'every item but the arena', on: BAR_ITEMS.map(i => i.key).filter(k => k !== 'arcade') },
  { name: 'Minimal', note: 'model, usage, remote, shield', on: ['barModel', 'barUsage', 'barRemote', 'barGuard'] },
]

// The preset the switches match now, or undefined for a mix of your own
export const barPresetNow = () => BAR_PRESETS.find(p => BAR_ITEMS.every(i => (cfg[i.key] as boolean) === p.on.includes(i.key)))

export async function applyBarPreset($: any, name: string) {
  const preset = BAR_PRESETS.find(p => p.name === name)
  if (!preset) return
  for (const i of BAR_ITEMS) (cfg as Record<string, unknown>)[i.key] = preset.on.includes(i.key)
  await saveSettings($)
  $.ui.toast(`statusbar: bar ${preset.name}, ${preset.note}`)
}
