import { atom, read } from 'claude-code'
import { insertText } from '../../features/menu'

import { SENSITIVE } from '../../lib/catalog'
import { mention } from '../../lib/format'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
// The files git reports changed, for the menu the folder opens.
const changes = atom({ plugin: 'cc-mod-statusbar', key: 'changes' } as const, [])

// The git menu.
export async function drawGitMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const b = await read($, bar)
  const list = await read($, changes)
  if (!b.branch && list.length === 0 && !b.ahead) return <Text dimColor>Not a git repository, or a detached HEAD with nothing changed.</Text>
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="suggestion" bold>{b.branch ? `⎇ ${b.branch}` : '⎇ detached HEAD'}</Text>
        <Text dimColor>{`  ${list.length} changed · ${b.ahead} to push · ${b.behind} to pull`}</Text>
      </Text>
      {list.slice(0, 20).map(f => {
        const isLocked = SENSITIVE.test(f.path)
        return (
          <Button key={`c:${f.path}`} plain dimColor={isLocked} onPress={() =>
            isLocked ? $.ui.toast(`statusbar: ${f.path} holds secrets; it is not added as context`) : insertText($, mention(f.path))}>
            <Text color={f.code === '??' ? 'success' : f.code.includes('D') ? 'error' : 'warning'}>{f.code.padEnd(2)}</Text>
            {' '}<Text color={isLocked ? 'error' : 'text'}>{f.path}</Text>
          </Button>
        )
      })}
      {list.length > 20 && <Text dimColor>{`  and ${list.length - 20} more`}</Text>}
      {list.length > 0 && <Text dimColor>A file goes into the prompt as an @-mention.</Text>}
    </Box>
  )
}
