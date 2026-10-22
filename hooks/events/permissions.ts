import { countAsk, rulesFor } from '../features/permissions'

import type { On } from 'claude-code'

export function registerPermissionCounts(on: On) {
  // every permission prompt counts toward the allow rules the shield menu suggests
  on('classic.PermissionRequest', async ($, e, next) => {
    await countAsk($, rulesFor(e))
    return next(e)
  }).catch(($, e, next) => next(e)) // counting never answers a permission prompt
}
