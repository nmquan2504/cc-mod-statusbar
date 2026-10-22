import type { Register } from 'claude-code'
import { registerAsk } from './events/ask'
import { registerCommands } from './events/commands'
import { registerPermissionCounts } from './events/permissions'
import { registerPrompt } from './events/prompt'
import { registerSecretTools } from './events/secret-tools'
import { registerSession } from './events/session'
import { registerSettingsHooks } from './events/settings-hooks'
import { registerTools } from './events/tools'
import { registerTurn } from './events/turn'
import { registerUi } from './events/ui'


// ---------------------------------------------------------------------------
// cc-mod-statusbar: a clickable status bar in the band above the prompt.
//
//   [+] [⁄] [● Opus 5.5] [◕ xhigh] /guardrails-hands-on ⎇ main   arena   5h [ 23% ] wk [ 41% ] [⌁ 1] [‖ manual] [◈]
//
// Where it lives:
//   events/     the hooks, one file per group, registered below in their old order
//   ui/         band.tsx (the bar; none in Claude Code for VS Code), menus/ (one per menu)
//   features/   what the menus and hooks do: the vault, guardrails, usage, automation, arena, ...
//   lib/        plain helpers;  state/  the shared values and the settings
// ---------------------------------------------------------------------------

// The hooks, in the order they were always registered: a chain runs them in this order.
export const register: Register = on => {
  registerSession(on)
  registerPermissionCounts(on)
  registerCommands(on)
  registerSecretTools(on)
  registerTools(on)
  registerAsk(on)
  registerPrompt(on)
  registerTurn(on)
  registerSettingsHooks(on)
  registerUi(on)
}
