import { MODES } from '../lib/catalog'
import { rt } from '../state/runtime'
import { drawBand } from '../ui/band'
import { noteSpinner } from '../features/prompts'
import type { On } from 'claude-code'

export function registerUi(on: On) {
  // A click on the band (or ctrl+x tab) hands it the keyboard, and the engine then puts the
  // focus ring on the first Button, drawing it inverted as if it were picked. That first move
  // comes after a quiet spell, so it is refused and the ring starts on nothing; a Tab right
  // after it is let through, so the keyboard still walks the bar.
  let lastFocusAt = 0
  // the first Button drawn: [+] with the menus shut, the menu's close button with one open
  const FIRST = new Set(['add', 'close-menu'])
  on('ui.focus', { component: 'AbovePrompt' }, ($, e, next) => {
    const now = Date.now()
    const isTake = e.origin.kind === 'person' && FIRST.has(e.element ?? '') && now - lastFocusAt > 1500
    lastFocusAt = now
    return isTake ? {} : next(e)
  }).catch(($, e, next) => next(e)) // the ring moves as the engine would

  // Between turns (a shift+tab), the hint line under the prompt is the first to show it.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    // The hint names every mode but the default one: there it reads "? for shortcuts" alone.
    rt.lastHint = e.props.hint
    const named = MODES.find(m => m.re.test(e.props.hint))?.mode
    rt.hintMode = named ?? (/\? for shortcuts/.test(e.props.hint) ? 'manual' : rt.hintMode)
    return next(e)
  })

  // ---- the bar ---------------------------------------------------------------
  //  ╭───────────────────────────────────────────────────────────────────────────╮
  //  │ [ + ][ ⁄ ][ ● Opus 5.5 ]  guardrails-hands-on ⎇ main  …  5h █▍   12% wk ██▍  33% [ ‖ manual ][ ◈ 2/4 ] │
  //  ╰───────────────────────────────────────────────────────────────────────────╯
  // Chips are square buttons (a label on a colored cell background) and stay Buttons; the gauges
  // are truecolor cells in one color by the percentage, where the surface draws them.
  // The spinner's step: tool-input while a permission dialog waits, tool-use once the call runs
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    noteSpinner(String(e.props.mode ?? ''))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, drawBand)
}
