import { atom, read, update } from 'claude-code'
import type { AutoContinue, HiRow } from '../../types'
import { WINDOW_NAMES } from '../lib/format'
import { CONTINUE_TEXT, HI_GRACE, HI_KEY, RETRY_MS, clockNow, lastHiSlot } from '../lib/schedule'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// A turn the rate limit stopped, waiting for its window to reset; and the "hi" schedule's last slots.
const autoContinue = atom({ plugin: 'cc-mod-statusbar', key: 'autoContinue' } as const, null)
const hiLog = atom({ plugin: 'cc-mod-statusbar', key: 'hiLog' } as const, [])
// The full usage reading, for the usage menu the gauges open.
const usage = atom({ plugin: 'cc-mod-statusbar', key: 'usage' } as const, null)

// When "continue" should go in after a turn the limit stopped: a minute past the reset of the
// window that ran out (both: the later one), else past the soonest reset, else in 30 minutes.
export async function planContinue($: any, now: number): Promise<AutoContinue> {
  const limits = ((await read($, usage))?.rateLimits ?? []) as { kind: string; percentUsed: number; resetsAt?: string }[]
  const resetOf = (r: { resetsAt?: string }) => Date.parse(r.resetsAt ?? '')
  const out = limits.filter(r => r.percentUsed >= 100 && Number.isFinite(resetOf(r)))
  const known = limits.filter(r => Number.isFinite(resetOf(r)) && resetOf(r) > now)
  const pick = out.length ? out.reduce((a, b) => (resetOf(a) > resetOf(b) ? a : b)) : known.sort((a, b) => resetOf(a) - resetOf(b))[0]
  const at = pick && resetOf(pick) > now ? resetOf(pick) + 60_000 : now + RETRY_MS
  return { at, window: pick ? (WINDOW_NAMES[pick.kind] ?? pick.kind) : 'unknown', tries: rt.continueTries }
}

// The scheduled "hi": one Haiku completion through the session's own client and credentials, which
// starts the account's usage window as any request does. Nothing of it reaches the conversation: a
// subagent, which said it before, handed its end back to Claude as a message.
async function sayHi($: any): Promise<HiRow['status']> {
  const r = await $.model.complete({ model: 'haiku', prompt: 'hi', maxTokens: 5, timeoutMs: 30_000 }).catch(() => undefined)
  return r?.isAnswered ? 'sent' : 'failed'
}

// Every 15 seconds: send what is due, never into a running turn.
export async function runAutomation($: any) {
  const now: number = await clockNow($)
  const pending = await read($, autoContinue)
  if (pending && now >= pending.at && !rt.isBusy) {
    await update($, autoContinue, () => null)
    rt.isContinueTurn = true
    await $.prompt.submit({ text: CONTINUE_TEXT, asUser: true }).then(
      () => $.ui.toast(`statusbar: the ${pending.window} window reset; sent "${CONTINUE_TEXT}"`),
      () => { rt.isContinueTurn = false })
  }
  if (!cfg.hiSchedule) return
  const slot = lastHiSlot(now)
  if (slot === null) return
  // the store is shared by every session of this mod: one "hi" a slot, whichever session takes it
  // a store that cannot be read cannot keep which slots went out: send nothing rather than twice
  const stored = await $.store.get(HI_KEY).then((v: unknown) => v ?? {}, () => null)
  if (stored === null) return
  const kept = stored as { lastSlot?: number; log?: HiRow[] }
  if (kept.lastSlot === slot) return
  const log = (status: HiRow['status']) => $.store.set(HI_KEY, { lastSlot: slot, log: [...(kept.log ?? []), { slot, status }].slice(-12) })
  let status: HiRow['status'] = now - slot > HI_GRACE ? 'missed' : rt.isBusy ? 'busy' : 'sent'
  await log(status) // claimed before sending, so a second session does not send it too
  if (status === 'sent') {
    status = await sayHi($)
    if (status === 'failed') await log(status)
  }
  await update($, hiLog, () => [...(kept.log ?? []), { slot, status }].slice(-12))
}
