import { atom, read, update } from 'claude-code'
import { summarizeTurn } from '../features/assist'
import { planContinue } from '../features/automation'
import { readGuard } from '../features/guard'
import { notifyRemote, readRemoteMessages } from '../features/remote'
import { refreshBar } from '../features/status'
import { keepUsage } from '../features/usage'

import { clockOf, oneLine } from '../lib/format'
import { CONTINUE_TEXT, MAX_TRIES, clockNow, vnClock } from '../lib/schedule'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
// A turn the rate limit stopped, waiting for its window to reset; and the "hi" schedule's last slots.
const autoContinue = atom({ plugin: 'cc-mod-statusbar', key: 'autoContinue' } as const, null)
// The full usage reading, for the usage menu the gauges open.
const usage = atom({ plugin: 'cc-mod-statusbar', key: 'usage' } as const, null)
// The files the main loop wrote this turn, with the lines each call added and removed.
const edited = atom({ plugin: 'cc-mod-statusbar', key: 'edited' } as const, [])

import type { On } from 'claude-code'

export function registerTurn(on: On) {
  // The engine pushes the figures the footer shows whenever a window moves a whole point:
  // the bar takes them from here, the 5-second read is the fallback.
  on('session.measure', async ($, e, next) => {
    const used = (kind: string) => e.rateLimits.find(r => r.kind === kind)?.percentUsed ?? null
    if (e.changed.includes('rateLimits')) await update($, bar, b => ({ ...b, five: used('five_hour'), week: used('seven_day') }))
    const kept = await read($, usage)
    await keepUsage($, e, kept?.startedAt)
    return next(e)
  }).catch(($, e, next) => next(e)) // a status bar never holds up the session

  // the effort the main loop's requests go out with, for the effort chip (turn.step streams)
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && typeof e.effort === 'string' && e.effort !== (await read($, bar)).effort) {
      const effort = e.effort
      await update($, bar, b => ({ ...b, effort }))
    }
    return yield* next(e)
  })

  // the turn's clock: started here, stopped and reported at turn.complete
  on('turn.start', async ($, e, next) => {
    rt.turnStartedAt = await $.clock.now()
    rt.turnEndedAt = 0
    rt.turnTools = []
    rt.turnPrompt = String((e as any).text ?? '')
    await update($, edited, () => [])
    rt.turnCostAt = (await $.session.usage().catch(() => undefined))?.cost?.usd ?? null
    if (cfg.selfRemote) void readRemoteMessages($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e)) // a status bar never holds up the session

  // Claude waits for the person (a permission prompt, an idle prompt): the phone hears of it
  on('classic.Notification', async ($, e: any, next) => {
    if (cfg.selfRemote) void notifyRemote($, `Claude needs you · /${(await read($, bar)).folder}`, oneLine(String(e.message ?? ''), 200)).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // StopFailure names the API error a turn died on; a turn.complete with reason 'error' follows
  on('classic.StopFailure', async ($, e: any, next) => {
    if (e.error === 'rate_limit') rt.isLimitStop = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refreshBar($)
    await readGuard($)
    // A main-loop turn the 5-hour or weekly limit stopped: "continue" once the window resets.
    // StopFailure says rate_limit; when it does not reach this mod, a window read at 100% or the
    // limit's own message in the answer does.
    // an agent's run ends: its answer, for the tasks menu's detail
    if (e.agentId) {
      const log = (rt.agentLog[e.agentId] ??= { startedAt: Date.now(), tools: [] })
      log.answer = String(e.answer ?? '')
      log.endedAt = Date.now()
    }
    if (!e.agentId) {
      const b = await read($, bar)
      const isLimit = e.reason === 'error' && (rt.isLimitStop || (b.five ?? 0) >= 100 || (b.week ?? 0) >= 100 || /usage limit|rate limit|hit your limit/i.test(e.answer ?? ''))
      rt.continueTries = isLimit && rt.isContinueTurn ? rt.continueTries + 1 : isLimit ? 1 : 0
      if (isLimit && cfg.autoContinue && rt.continueTries <= MAX_TRIES) {
        const plan = await planContinue($, await clockNow($))
        await update($, autoContinue, () => plan)
        $.ui.toast(`statusbar: stopped by the ${plan.window} limit; "${CONTINUE_TEXT}" goes in at ${vnClock(plan.at)}`)
      } else if (isLimit && cfg.autoContinue) $.ui.toast(`statusbar: the limit stopped ${MAX_TRIES} tries in a row; auto-continue gave up`)
      rt.isLimitStop = false
      rt.isContinueTurn = false
    }
    if (rt.turnStartedAt) {
      rt.turnEndedAt = await $.clock.now()
      const took = rt.turnEndedAt - rt.turnStartedAt
      const cost = (await read($, usage))?.costUsd
      const spent = rt.turnCostAt !== null && cost != null ? ` · $${(cost - rt.turnCostAt).toFixed(2)}` : ''
      // a quick answer needs no toast; a long one may have run while you looked away
      if (cfg.turnToast && took >= cfg.turnToastSeconds * 1000) $.ui.toast(`statusbar: done in ${clockOf(took)}${spent}`)
      // the phone hears of every main-loop turn's end, with the start of Claude's answer
      if (cfg.selfRemote && !e.agentId) {
        const folder = (await read($, bar)).folder
        void readRemoteMessages($)
          .then(() => notifyRemote($, `Done · /${folder} · ${clockOf(took)}`, oneLine(String(e.answer ?? ''), 200) || 'Claude finished.'))
          .catch(() => undefined)
      }
      // behind the turn's end, never holding it up
      if (cfg.turnSummary && took >= cfg.summarySeconds * 1000)
        void summarizeTurn($, took, rt.turnCostAt !== null && cost != null ? cost - rt.turnCostAt : null).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a status bar never holds up the session
}
