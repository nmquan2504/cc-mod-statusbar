import { countCommand } from '../features/commands'
import { acquire, forgetSecret, listSecrets } from '../features/vault'

import type { On } from 'claude-code'

export function registerCommands(on: On) {
  // every slash command you type counts toward the top five of the commands menu
  on('command.run', ($, e, next) => {
    if (e.origin?.kind === 'composer') void countCommand($, e.command).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e)) // counting never holds up a command

  // ---- the vault: commands, tools, the prompt and the shell ----------------
  on('command.run', { command: 'secret' }, async ($, e) => {
    const r = await acquire($, { name: e.args.trim() || undefined })
    return { text: 'error' in r ? `Nothing saved: ${r.error}.` : `${r.name} saved to ${r.where}; sent only to ${r.binding.host}.` }
  }).catch(() => ({ text: 'statusbar vault: could not save the secret.' }))

  on('command.run', { command: 'secrets' }, async $ => ({ text: await listSecrets($) }))
    .catch(() => ({ text: 'statusbar vault: could not list secrets.' }))

  on('command.run', { command: 'secret-forget' }, async ($, e) => ({ text: await forgetSecret($, e.args) }))
    .catch(() => ({ text: 'statusbar vault: could not delete the secret.' }))
}
