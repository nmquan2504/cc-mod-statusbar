import { ASSIST_MODEL } from './assist'
import { suggestPrompt, suggestionChips, suggestionsFrom } from '../lib/suggest'
import { noteAddDir, remote } from './remote'
import { scrub } from './vault'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The chips under Claude's last answer, while no turn runs: Claude Code's own next-prompt
// suggestion, else what Haiku proposes (lib/suggest.ts), three at most.
export const chipsNow = () => (rt.isBusy ? [] : suggestionChips(remote.suggestion, rt.answerChips))

// How long Claude Code gets to make its own suggestion after an answer before Haiku is asked.
export const SUGGEST_WAIT_MS = 3000

// After a main-loop answer: Claude Code's own suggestion if it comes in SUGGEST_WAIT_MS, else
// Haiku's. A turn started, a chip sent or ✕ in the meantime drops what Haiku says (rt.suggestRound).
export function suggestNext($: any, request: string, answer: string) {
  const round = ++rt.suggestRound
  const isStale = () => round !== rt.suggestRound || rt.isBusy || Boolean(remote.suggestion)
  $.clock.after(SUGGEST_WAIT_MS, async () => {
    if (isStale() || !cfg.haikuChips) return
    const r = await $.model.complete({ model: ASSIST_MODEL, prompt: suggestPrompt(scrub(request), scrub(answer)), maxTokens: 200, timeoutMs: 15_000 }).catch(() => undefined)
    if (isStale() || !r?.isAnswered) return
    rt.answerChips = suggestionsFrom(r.text)
    $.ui.invalidate('ui.render')
  })
}

// ✕ on the row: the chips go until the next answer brings its own (the phone's with them)
export function dismissChips($: any) {
  rt.suggestRound++
  rt.answerChips = []
  remote.suggestion = ''
  $.ui.invalidate('ui.render')
}

// A chip pressed is sent at once: a /command runs (a plugin's prompt runs none), anything else
// goes in as your prompt.
export async function sendChip($: any, text: string) {
  const m = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  rt.suggestRound++
  rt.answerChips = []
  remote.suggestion = ''
  $.ui.invalidate('ui.render')
  if (m) {
    noteAddDir(m[1]!, m[2] ?? '') // a plugin's own command.run passes its hooks by
    return $.command.run({ command: m[1]!, args: (m[2] ?? '').trim() })
  }
  return $.prompt.submit({ text, asUser: true })
}
