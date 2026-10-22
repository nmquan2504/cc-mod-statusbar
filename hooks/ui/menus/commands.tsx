import { ENTRY_INDENT } from './entry'
import { atom, read, update } from 'claude-code'
import { TOP_GROUP, toggleGroup } from '../../features/commands'
import { insertText } from '../../features/menu'

import { oneLine } from '../../lib/format'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const commands = atom({ plugin: 'cc-mod-statusbar', key: 'commands' } as const, [])
const collapsed = atom({ plugin: 'cc-mod-statusbar', key: 'collapsed' } as const, [])
// What is typed in the commands menu's search field.
const filter = atom({ plugin: 'cc-mod-statusbar', key: 'filter' } as const, '')

// The commands menu.
export async function drawCommandsMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const all = await read($, commands)
  const q = (await read($, filter)).trim().toLowerCase()
  // typed words narrow the list to the commands whose name or description holds them all
  const list = q ? all.filter(c => q.split(/\s+/).every(w => `${c.name} ${c.description}`.toLowerCase().includes(w))) : all
  // while a search is typed every group shows its matches, folded or not
  const shut = new Set(q ? [] : await read($, collapsed))
  const { Input } = els
  const isMine = (group: string) => group.startsWith('1 ·') || group === TOP_GROUP
  return (
    <Box flexDirection="column">
      {Input && (
        <Input key="cmd-search" label="⌕" placeholder="type to filter, Enter puts the first in the prompt" autoFocus
          onInput={(value: string) => void update($, filter, () => value)}
          onSubmit={(value: string) => {
            const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean)
            const first = all.find(c => words.every(w => `${c.name} ${c.description}`.toLowerCase().includes(w)))
            if (first) void insertText($, `/${first.name} `)
          }} />
      )}
      {q && <Text dimColor>{list.length ? `${list.length} of ${all.length} match` : 'nothing matches'}</Text>}
      {[...new Set(list.map(c => c.group))].map(group => {
        const rows = list.filter(c => c.group === group)
        const isShut = shut.has(group)
        return (
          <Box key={`box:${group}`} flexDirection="column" marginTop={1}>
            {/* a press folds the group away or opens it; the choice is kept across sessions */}
            <Button key={`g:${group}`} plain onPress={() => toggleGroup($, group)}>
              <Text color={isMine(group) ? 'claude' : 'subtle'} bold>{`${isShut ? '▸' : '▾'} ${group.replace(/^\d · /, '')}`}</Text>
              <Text dimColor>{`  ${rows.length}${isShut ? ' hidden' : ''}`}</Text>
            </Button>
            {/* indented by the row, not the label: a highlighted command starts at its slash */}
            {!isShut && rows.map(c => (
              <Box key={`row:${group === TOP_GROUP ? 'top' : 'c'}:${c.name}`} paddingLeft={ENTRY_INDENT}>
                <Button key={`${group === TOP_GROUP ? 'top' : 'c'}:${c.name}`} plain onPress={() => insertText($, `/${c.name} `)}>
                  <Text color={isMine(group) ? 'claude' : 'suggestion'}>/{c.name}</Text>
                  <Text dimColor>{`  ${oneLine(c.description)}`}</Text>
                </Button>
              </Box>
            ))}
          </Box>
        )
      })}
      <Text dimColor>The wheel or ↑ ↓ scroll the list; a heading folds its group.</Text>
    </Box>
  )
}
