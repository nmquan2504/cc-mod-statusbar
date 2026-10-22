import { remote } from '../features/remote'

import type { On } from 'claude-code'

export function registerRemote(on: On) {
  // Claude Code's guess at the next prompt (the dim line): the phone shows it under its + menu
  on('prompt.suggest', async ($, e, next) => {
    remote.suggestion = String(e.text ?? '').trim()
    return next(e)
  }).catch(($, e, next) => next(e))

  // a folder /add-dir added: the phone may browse it, and its Context tab lists it
  on('classic.DirectoryAdded', ($, e: any, next) => {
    const dir = String(e.directory ?? '')
    if (dir && !remote.addedDirs.includes(dir)) remote.addedDirs = [...remote.addedDirs, dir]
    return next(e)
  }).catch(($, e, next) => next(e))
}
