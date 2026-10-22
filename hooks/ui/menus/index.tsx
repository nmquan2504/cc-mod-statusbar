import type { MenuKind } from '../../../types'

import { drawAddMenu } from './add'
import { drawCommandsMenu } from './commands'
import { drawEffortMenu } from './effort'
import { makeEntry } from './entry'
import { drawFilesMenu } from './files'
import { drawGitMenu } from './git'
import { drawGuardMenu } from './guard'
import { drawImagesMenu } from './images'
import { drawMcpMenu } from './mcp'
import { drawModeMenu } from './mode'
import { drawModelMenu } from './model'
import { drawSettingsMenu } from './settings'
import { drawTasksMenu } from './tasks'
import { drawUsageMenu } from './usage'
import { drawWebMenu } from './web'

// The open menu, drawn under the bar inside the band: the band keeps the keyboard, so Tab
// walks from the bar into the menu, a digit presses an entry, and a click works as well.
export async function drawMenu($: any, els: any, kind: MenuKind, isTerminal: boolean) {
  const { Text } = els
  const entry = makeEntry(els)
  // each by its name: the engine follows $ only into a function declaration it can see
  const drawn = await (async () => {
    switch (kind) {
      case 'add': return drawAddMenu($, els, isTerminal, entry)
      case 'files': return drawFilesMenu($, els, isTerminal, entry)
      case 'web': return drawWebMenu($, els, isTerminal, entry)
      case 'commands': return drawCommandsMenu($, els, isTerminal, entry)
      case 'effort': return drawEffortMenu($, els, isTerminal, entry)
      case 'model': return drawModelMenu($, els, isTerminal, entry)
      case 'mode': return drawModeMenu($, els, isTerminal, entry)
      case 'settings': return drawSettingsMenu($, els, isTerminal, entry)
      case 'images': return drawImagesMenu($, els, isTerminal, entry)
      case 'git': return drawGitMenu($, els, isTerminal, entry)
      case 'usage': return drawUsageMenu($, els, isTerminal, entry)
      case 'mcp': return drawMcpMenu($, els, isTerminal, entry)
      case 'tasks': return drawTasksMenu($, els, isTerminal, entry)
      case 'guard': return drawGuardMenu($, els, isTerminal, entry)
      default: return undefined
    }
  })()
  return drawn ?? <Text dimColor>Nothing to show.</Text>
}
