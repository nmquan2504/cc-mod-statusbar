import { MODES } from '../lib/catalog'
import { rt } from '../state/runtime'
import { drawBand, drawMenuPane } from '../ui/band'
import { MENU_PANE, closeMenu } from '../features/menu'
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
    if (isTake) return {}
    // the ring walked to a Button of a menu scrolled out of its window: the window follows it
    const row = rt.menuKeyRows.get(e.element ?? '')
    if (row !== undefined && rt.menuWindow && rt.menuRows > rt.menuWindow) {
      const to = row < rt.menuOffset ? row : row >= rt.menuOffset + rt.menuWindow ? row - rt.menuWindow + 1 : rt.menuOffset
      if (to !== rt.menuOffset) {
        rt.menuOffset = Math.min(Math.max(0, to), rt.menuRows - rt.menuWindow)
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // the ring moves as the engine would

  // Between turns (a shift+tab), the hint line under the prompt is the first to show it.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    // The hint names every mode but the default one: "auto mode on", "accept edits on", "plan mode
    // on", with "(shift+tab to cycle)" or, while shells or agents run, "· 1 shell · ← 1 agent" after
    // it. The default mode shows no name: "? for shortcuts", or only the shells and agents. So a hint
    // that names no mode, drawn at rest (no turn, no draft), is the default; one drawn mid-turn or
    // over a draft may have left the name out, and the last reading stands.
    rt.lastHint = e.props.hint
    const named = MODES.find(m => m.re.test(e.props.hint))?.mode
    const isAtRest = !e.props.isWorking && !e.props.isDraft
    rt.hintMode = named ?? (/\? for shortcuts/.test(e.props.hint) || isAtRest ? 'manual' : rt.hintMode)
    return next(e)
  })

  // ---- the bar ---------------------------------------------------------------
  //  ╭───────────────────────────────────────────────────────────────────────────╮
  //  │ [ + ][ ⁄ ][ ● Opus 5.5 ][ ‖ manual ]  guardrails-hands-on ⎇ main  …  5h █▍   12% wk ██▍  33% [ ◈ 2/4 ] │
  //  ╰───────────────────────────────────────────────────────────────────────────╯
  // Chips are square buttons (a label on a colored cell background) and stay Buttons; the gauges
  // are truecolor cells in one color by the percentage, where the surface draws them.
  // The spinner's step: tool-input while a permission dialog waits, tool-use once the call runs
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    noteSpinner(String(e.props.mode ?? ''))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, drawBand)
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, drawMenuPane)
  // the person closed the menu's pane: the menu closes with it, its chip no longer marked
  on('ui.close', { id: MENU_PANE }, async ($, e, next) => {
    const r = await next(e)
    if (e.origin.kind !== 'plugin' && rt.isMenuPaneOpen) {
      rt.isMenuPaneOpen = false
      await closeMenu($)
    }
    return r
  }).catch(($, e, next) => next(e))

  // An open menu taller than its window (band.tsx): the wheel and the scroll keys move the menu
  // inside it, the head and the bar staying where they are; the band itself does not move. With no
  // such menu the band scrolls as the engine moves it.
  on('ui.scroll', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!rt.menuWindow || rt.menuRows <= rt.menuWindow) return next(e)
    const last = rt.menuRows - rt.menuWindow
    const by = Math.abs(e.by) >= e.bodyRows && e.bodyRows > 1 ? Math.sign(e.by) * (rt.menuWindow - 1) : e.by
    const to = Math.min(last, Math.max(0, rt.menuOffset + by))
    if (to !== rt.menuOffset) {
      rt.menuOffset = to
      $.ui.invalidate('ui.render')
    }
    // the band's own window stays at its top, where the head and the bar are
    return e.offset === 0 ? {} : next({ ...e, offset: 0 })
  }).catch(($, e, next) => next(e))
}
