import { answerText, ask, closeAsk, showAsk, waitForAnswer } from '../features/ask'
import { notifyRemote, remote } from '../features/remote'
import { oneLine } from '../lib/format'
import { cfg } from '../state/config'

import type { On } from 'claude-code'

export function registerAsk(on: On) {
  // With Self remote on and its hub running, Claude's questions go in the band and on the phone,
  // never in the engine's dialog: the hook answers the call itself. With the remote off, where no
  // band draws (VS Code, a -p run), or while another question waits, the engine's dialog asks.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e: any, next) => {
    const questions = Array.isArray(e.questions) ? e.questions : []
    if (!cfg.selfRemote || !remote.isJoined) return next(e)
    const surfaces: readonly string[] = await $.session.surfaces().catch(() => [])
    if (!surfaces.includes('terminal') || ask.pending || !questions.length) {
      // say why the engine's dialog asks: no band here, or a question already waits
      if (questions.length) $.ui.toast(`statusbar: the dialog asks (${ask.pending ? 'another question waits' : `no band on ${surfaces.join(', ') || 'this surface'}`})`)
      return next(e)
    }
    ask.pending = { id: String(e.tool_use_id ?? Date.now()), questions, draft: { picks: {}, other: {} } }
    await showAsk($)
    void notifyRemote($, 'Claude asks you', oneLine(String(questions[0]?.question ?? ''), 200)).catch(() => undefined)
    try {
      await waitForAnswer($, next.signal)
      const r = ask.pending?.result
      if (!r || r === 'dismissed')
        return { deny: 'The person dismissed the question without answering. Go on with your best judgment, or ask in plain text if you cannot.' }
      return { result: { questions, answers: r.answers }, text: answerText(r.answers) }
    } finally {
      await closeAsk($)
    }
  }).catch(async ($, e, next) => {
    // the band failed before anyone answered: the engine's own dialog asks instead, and says why
    await closeAsk($).catch(() => undefined)
    $.ui.toast(`statusbar: the band could not ask (${JSON.stringify((next as any).error ?? 'unknown').slice(0, 140)}); the dialog asks instead`)
    return next(e)
  })
}
