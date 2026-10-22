import { readGuard } from '../features/guard'
import { keepMode } from '../features/mode'


import type { On } from 'claude-code'

export function registerSettingsHooks(on: On) {
  // A settings file changed: the shield's score and menu read it again at once
  on('classic.ConfigChange', async ($, e, next) => {
    await readGuard($).catch(() => undefined)
    return next(e)
  })

  // The mode has no getter. Every settings-hook event carries it as `permission_mode`:
  // kept from each prompt and each turn's end.

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await keepMode($, e.permission_mode)
    return next(e)
  }).catch(($, e, next) => next(e)) // a status bar never holds up the session
  on('classic.Stop', async ($, e, next) => {
    await keepMode($, e.permission_mode)
    return next(e)
  }).catch(($, e, next) => next(e)) // a status bar never holds up the session
}
