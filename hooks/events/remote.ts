import { remote } from '../features/remote'

import type { On } from 'claude-code'

export function registerRemote(on: On) {
  // a folder /add-dir added: the phone may browse it, and its Context tab lists it
  on('classic.DirectoryAdded', ($, e: any, next) => {
    const dir = String(e.directory ?? '')
    if (dir && !remote.addedDirs.includes(dir)) remote.addedDirs = [...remote.addedDirs, dir]
    return next(e)
  }).catch(($, e, next) => next(e))
}
