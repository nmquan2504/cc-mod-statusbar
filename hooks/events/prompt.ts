import { keepTaskNotes } from '../features/work'
import { imageNotes, readImages } from '../features/images'
import { maskPrompt } from '../features/vault'
import { oneLine } from '../lib/format'

import type { On } from 'claude-code'

export function registerPrompt(on: On) {
  // a token pasted into the prompt is vaulted and masked before the model sees it
  on('prompt.submit', async ($, e, next) => {
    // a background command ended: the engine's notification says how
    if ((e as { origin?: { kind?: string } }).origin?.kind === 'task-notification' || /<task-notification>/.test(e.text ?? '')) {
      keepTaskNotes(e.text ?? '')
      $.ui.invalidate('ui.render')
    }
    // the words each [Image #n] came with, for the images menu
    const said = oneLine((e.text ?? '').replace(/\[Image #\d+\]/g, '').replace(/\s+/g, ' '), 40)
    for (const m of (e.text ?? '').matchAll(/\[Image #(\d+)\]/g)) imageNotes[Number(m[1])] = said
    const text = await maskPrompt($, e.text ?? '')
    const result = await next(text === e.text ? e : { ...e, text })
    if (e.attachments?.some(a => a.type === 'image') || /\[Image #\d+\]/.test(e.text ?? '')) await readImages($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e)) // a failed mask never loses the prompt
}
