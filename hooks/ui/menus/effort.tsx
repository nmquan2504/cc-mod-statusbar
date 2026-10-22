import { atom, read, update } from 'claude-code'
import { closeMenu } from '../../features/menu'

import { EFFORTS } from '../../lib/catalog'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})

// The effort menu.
export async function drawEffortMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const now = (await read($, bar)).effort
  return (
    <Box flexDirection="column">
      {EFFORTS.map((f, i) => {
        const isNow = f.level === now
        return (
          <Button key={`ef:${f.level}`} plain hotkey={String(i + 1)} onPress={async () => {
            await closeMenu($)
            if (isNow) return
            await $.command.run({ command: 'effort', args: f.level })
            await update($, bar, b => ({ ...b, effort: f.level }))
          }}>
            <Text color={f.color}>{f.icon}</Text> <Text color={f.color} bold={isNow}>{f.level}</Text>
            {isNow ? <Text color="success">  ✓ now</Text> : ''}
            <Text dimColor>{`  ${f.note}`}</Text>
          </Button>
        )
      })}
      <Text dimColor>A pick runs /effort, which also makes it the default for new sessions.</Text>
    </Box>
  )
}
