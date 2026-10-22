import { atom, read } from 'claude-code'
import { ask, closeAsk, showAsk, waitForAnswer } from '../features/ask'
import { allowRule, countAsk, rulesFor } from '../features/permissions'
import { noteCheck, permissionQuestion, verdictOf } from '../features/prompts'
import { notifyRemote, remote } from '../features/remote'
import { describeCall } from '../features/work'
import { oneLine } from '../lib/format'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

import type { On } from 'claude-code'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})

// Tools whose dialog is the person's own (a question, a plan to approve): a hook's allow does not
// dismiss it, so the engine asks them as it would.
const OWN_DIALOG = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])

// Whether this ask is put to the person in the band and on the phone: Self remote linked, a band
// to draw it, nothing else asked meanwhile, the main loop's own call, and the person the one who
// decides. In auto mode the engine's ask goes to its classifier first, so only an ask a plugin
// made (one the classifier cannot settle) is taken; an organization's ceiling is left to the engine.
async function isAskedHere($: any, e: any, r: any) {
  if (r?.decision !== 'ask' || !cfg.selfRemote || !remote.isJoined || ask.pending) return false
  if (!e.tool_use_id || e.agentId !== undefined || e.approver !== 'person' || e.ceiling !== undefined || OWN_DIALOG.has(e.tool)) return false
  if ((rt.probedMode ?? rt.hintMode) === 'auto' && !r.plugin) return false
  const surfaces: readonly string[] = await $.session.surfaces().catch(() => [])
  return surfaces.includes('terminal')
}

export function registerPermissionCounts(on: On) {
  // A permission prompt the engine raises for the main loop. With Self remote on it is asked in
  // the band and on the phone; otherwise the phone shows it while it waits, and tickPrompts counts
  // it toward the allow rules the shield menu suggests once it has waited.
  on('tool.check', async ($, e: any, next) => {
    const r: any = await next(e)
    if (!(await isAskedHere($, e, r))) {
      noteCheck(e, r ?? {}, Date.now())
      return r
    }
    const input = (e.input && typeof e.input === 'object' ? e.input : {}) as Record<string, unknown>
    const rule = rulesFor({ tool_name: e.tool, tool_input: input })[0]!
    ask.pending = { id: `permission:${e.tool_use_id}`, questions: [permissionQuestion(e.tool, input, rule, String(r.reason ?? ''))], draft: { picks: {}, other: {} } }
    await showAsk($)
    await countAsk($, [rule]).catch(() => undefined)
    void notifyRemote($, `Claude needs you · /${(await read($, bar)).folder}`, oneLine(`Asks to run ${describeCall({ tool: e.tool, ...input })}`, 200)).catch(() => undefined)
    try {
      await waitForAnswer($, next.signal)
      const v = verdictOf(ask.pending?.result, rule)
      if (v.isAlways) await allowRule($, rule).catch(() => $.ui.toast(`statusbar: ${rule} was not added to .claude/settings.local.json`))
      return { decision: v.decision, reason: v.reason }
    } finally {
      await closeAsk($)
    }
  }).catch(async $ => {
    // the band failed: the engine's own dialog asks instead
    await closeAsk($).catch(() => undefined)
    return { decision: 'ask' }
  })
}
