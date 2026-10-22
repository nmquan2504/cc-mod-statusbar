import { atom, read } from 'claude-code'
import { closeMenu } from '../../features/menu'

import { MODES, shiftTabs } from '../../lib/catalog'
import { rt } from '../../state/runtime'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})

// The mode menu.
export async function drawModeMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const now = rt.probedMode ?? rt.hintMode ?? (await read($, bar)).mode
  return (
    <Box flexDirection="column">
      {MODES.slice(0, 4).map((m, i) => {
        const isNow = m.mode === now
        return (
          <Button key={`p:${m.mode}`} plain hotkey={String(i + 1)} onPress={async () => {
            await closeMenu($)
            if (isNow) return
            // /plan enters plan mode; the EnterPlanMode tool only runs inside a model turn.
            if (m.mode === 'plan') {
              await $.command.run({ command: 'plan' }).catch(() =>
                $.ui.toast('statusbar: could not enter plan mode; press shift+tab'))
              return
            }
            // A mod has no call that sets any other mode: the person's shift+tab does.
            const steps = shiftTabs(now, m.mode)
            $.ui.toast(`statusbar: press shift+tab ${steps ? `${steps}×` : 'until the hint says'} for "${m.label.split(' (')[0]}"`)
          }}>
            <Text color={m.color}>{m.icon}</Text> <Text color={m.color} bold={isNow}>{m.label}</Text>
            {isNow ? <Text color="success">  ✓ now</Text> : ''}
            <Text dimColor>  {m.note}</Text>
          </Button>
        )
      })}
      <Text dimColor>Plan is entered from here (/plan). A mod cannot set the others: the toast says how many shift+tab.</Text>
    </Box>
  )
}
