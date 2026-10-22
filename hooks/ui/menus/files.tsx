import { atom, read } from 'claude-code'
import { insertText, listDir } from '../../features/menu'

import { SENSITIVE } from '../../lib/catalog'
import { join, mention, parent } from '../../lib/format'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const dir = atom({ plugin: 'cc-mod-statusbar', key: 'dir' } as const, '')
const files = atom({ plugin: 'cc-mod-statusbar', key: 'files' } as const, [])

// The files menu.
export async function drawFilesMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
  const { Box, Button, Text } = els
  const here = await read($, dir)
  const list = await read($, files)
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="suggestion" bold>./{here}</Text>
        <Text dimColor>  {list.length} entries</Text>
      </Text>
      {here !== '' && (
        <Button key="up" plain onPress={() => listDir($, parent(here))}>
          ↩ <Text dimColor>up</Text>
        </Button>
      )}
      {list.map(f => {
        const path = join(here, f.name)
        const isLocked = SENSITIVE.test(path)
        if (isLocked) {
          return (
            <Button key={`${f.isDir ? 'd' : 'f'}:${f.name}`} plain dimColor
              onPress={() => $.ui.toast(`statusbar: ${f.name} holds secrets; it is not added as context`)}>
              ⊘ <Text color="error">{f.name}{f.isDir ? '/' : ''}</Text>
            </Button>
          )
        }
        return f.isDir ? (
          <Button key={`d:${f.name}`} plain onPress={() => listDir($, path)}>
            ▸ <Text color="suggestion">{f.name}/</Text>
          </Button>
        ) : (
          <Button key={`f:${f.name}`} plain onPress={() => insertText($, mention(path))}>
            · <Text>{f.name}</Text>
          </Button>
        )
      })}
      {list.length === 0 && <Text dimColor>Empty.</Text>}
    </Box>
  )
}
