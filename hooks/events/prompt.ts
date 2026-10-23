import { HI_TASK } from '../features/automation'
import { keepTaskNotes } from '../features/work'
import { imageNotes, readImages } from '../features/images'
import { noteTyped } from '../features/remote'
import { maskPrompt } from '../features/vault'
import { oneLine } from '../lib/format'
import { rt } from '../state/runtime'

import type { On } from 'claude-code'

export function registerPrompt(on: On) {
  // a token pasted into the prompt is vaulted and masked before the model sees it
  on('prompt.submit', async ($, e, next) => {
    // a background command ended: the engine's notification says how
    const isNote = (e as { origin?: { kind?: string } }).origin?.kind === 'task-notification' || /<task-notification>/.test(e.text ?? '')
    if (isNote) {
      // the scheduled "hi" agent's end is the mod's business, not Claude's: no turn for it
      const hi = [...rt.hiAgents].find(id => (e.text ?? '').includes(id))
      if (hi || (e.text ?? '').includes(HI_TASK)) return (hi && rt.hiAgents.delete(hi), { drop: 'the scheduled hi agent ended' })
      keepTaskNotes(e.text ?? '')
      $.ui.invalidate('ui.render')
    }
    // the words each [Image #n] came with, for the images menu
    const said = oneLine((e.text ?? '').replace(/\[Image #\d+\]/g, '').replace(/\s+/g, ' '), 40)
    for (const m of (e.text ?? '').matchAll(/\[Image #(\d+)\]/g)) imageNotes[Number(m[1])] = said
    const text = await maskPrompt($, e.text ?? '')
    // the prompt as typed, for the phone (see noteTyped)
    if (!isNote && !e.command && !e.isMeta) await noteTyped($, text).catch(() => undefined)
    const result = await next(text === e.text ? e : { ...e, text })
    if (e.attachments?.some(a => a.type === 'image') || /\[Image #\d+\]/.test(e.text ?? '')) await readImages($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e)) // a failed mask never loses the prompt
}
