import { noteCheck } from '../features/prompts'

import type { On } from 'claude-code'

export function registerPermissionCounts(on: On) {
  // A permission prompt the engine raises for the main loop: Claude Code's own dialog asks it. The
  // dialog hook (remote/dialog-hook.mjs) puts the same dialog on the phone; where that hook does not
  // run, the phone shows it while it waits. tickPrompts counts it toward the allow rules the shield
  // menu suggests once it has waited.
  on('tool.check', async ($, e: any, next) => {
    const r: any = await next(e)
    noteCheck(e, r ?? {}, Date.now())
    return r
  })
}
