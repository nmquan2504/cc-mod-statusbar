import { noteAddDir, remote } from '../features/remote'

import type { On } from 'claude-code'

export function registerRemote(on: On) {
  // Claude Code's guess at the next prompt (the dim line): the phone shows it under its + menu
  on('prompt.suggest', async ($, e, next) => {
    remote.suggestion = String(e.text ?? '').trim()
    return next(e)
  }).catch(($, e, next) => next(e))

  // a folder given to /add-dir: once the engine takes it, the phone may browse it and its Context tab lists it
  on('command.run', { command: 'add-dir' }, async ($, e, next) => {
    const r = await next(e)
    noteAddDir(e.command, e.args)
    return r
  }).catch(($, e, next) => next(e))
}
