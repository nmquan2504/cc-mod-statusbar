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
    if (isStale() || !(cfg.haikuChips || cfg.forceSuggest)) return
    const ask = () => $.model.complete({ model: ASSIST_MODEL, prompt: suggestPrompt(scrub(request), scrub(answer), cfg.forceSuggest), maxTokens: 200, timeoutMs: 15_000 }).catch(() => undefined)
    // forceSuggest asks once more when Haiku fails or times out
    let r = await ask()
    if (cfg.forceSuggest && !r?.isAnswered && !isStale()) r = await ask()
    if (isStale() || !r?.isAnswered) return
    rt.answerChips = suggestionsFrom(r.text)
    $.ui.invalidate('ui.render')
    // forceSuggest: Claude Code said nothing, so the first chip goes in the prompt box as its dim
    // suggestion (Tab takes it); the box holding text or a turn running shows none
    if (cfg.forceSuggest && rt.answerChips[0]) await $.prompt.suggest({ text: rt.answerChips[0] }).catch(() => undefined)
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
