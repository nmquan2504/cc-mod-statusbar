import { cfg } from '../state/config'

// ---- automation: continue after a rate limit, "hi" on a schedule ------------------------------
// Vietnam time is UTC+7 all year; the schedule's hours are its, whatever the machine's zone.
export const VN = 7 * 3_600_000

export const DAY = 86_400_000

export const HI_EVERY = 5 * 3_600_000

// A slot missed by more than this (Claude Code was not running) is not sent late: it would start
// the window off the hour.
export const HI_GRACE = 30 * 60_000

export const CONTINUE_TEXT = 'continue'

// After a reset with no time given, and between tries that hit the limit again.
export const RETRY_MS = 30 * 60_000

export const MAX_TRIES = 5

export const vnMidnight = (t: number) => Math.floor((t + VN) / DAY) * DAY - VN

// 07:00 in Vietnam time
export const vnClock = (t: number) => new Date(t + VN).toISOString().slice(11, 16)

// The day's slots: the start time, then every 5 hours before midnight (07:30, 12:30, 17:30, 22:30)
export const hiStart = () => `${String(cfg.hiStartHour).padStart(2, '0')}:${String(cfg.hiStartMinute).padStart(2, '0')}`

export const hiSlotsOf = (midnight: number) => {
  const slots: number[] = []
  for (let at = midnight + cfg.hiStartHour * 3_600_000 + cfg.hiStartMinute * 60_000; at < midnight + DAY; at += HI_EVERY) slots.push(at)
  return slots
}

export const lastHiSlot = (now: number) =>
  [...hiSlotsOf(vnMidnight(now) - DAY), ...hiSlotsOf(vnMidnight(now))].filter(at => at <= now).pop() ?? null

export const nextHiSlot = (now: number) =>
  [...hiSlotsOf(vnMidnight(now)), ...hiSlotsOf(vnMidnight(now) + DAY)].find(at => at > now)!

export const HI_KEY = 'hi-schedule'

// The engine's clock (a test moves it); the wall clock where none answers
export function clockNow($: any): Promise<number> {
  return $.clock.now().catch(() => Date.now())
}
