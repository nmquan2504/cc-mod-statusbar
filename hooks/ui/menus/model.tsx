import { atom, read } from 'claude-code'
import { closeMenu } from '../../features/menu'
import { refreshBar } from '../../features/status'

import { MODELS } from '../../lib/catalog'
import { shortModel } from '../../lib/format'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})

// The model menu.
export async function drawModelMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
  const { Box, Button, Text } = els
  const now = (await read($, bar)).model
  const pick = async (alias: string) => {
    await closeMenu($)
    await $.command.run({ command: 'model', args: alias })
    await refreshBar($)
  }
  return (
    <Box flexDirection="column">
      {MODELS.map((m, i) => {
        const isNow = shortModel(now) === m.label
        return (
          <Button key={`m:${m.alias}`} plain hotkey={String(i + 1)} onPress={() => pick(m.alias)}>
            <Text color={m.color}>●</Text> <Text bold={isNow}>{m.label}</Text>
            {isNow ? <Text color="success">  ✓ now</Text> : ''}
            {m.note ? <Text dimColor>  {m.note}</Text> : ''}
          </Button>
        )
      })}
      <Text dimColor>A pick runs /model, which also makes it the default for new sessions.</Text>
    </Box>
  )
}
