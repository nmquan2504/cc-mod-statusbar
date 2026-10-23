import { atom, read, update } from 'claude-code'
import type { HiRow } from '../../../types'

import { span } from '../../lib/format'
import { CONTINUE_TEXT, DAY, HI_KEY, clockNow, hiSlotsOf, hiStart, nextHiSlot, vnClock, vnMidnight } from '../../lib/schedule'
import { cfg, saveSettings } from '../../state/config'
import type { CfgKey } from '../../state/config'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// A turn the rate limit stopped, waiting for its window to reset; and the "hi" schedule's last slots.
const autoContinue = atom({ plugin: 'cc-mod-statusbar', key: 'autoContinue' } as const, null)

// The usage menu's Automation section: auto-continue after a limit, with what waits and a cancel;
// the "hi" schedule, with today's slots and what came of each.
export async function drawAutomation($: any, els: any) {
  const { Box, Button, Text } = els
  const now: number = await clockNow($)
  const pending = await read($, autoContinue)
  const kept = ((await $.store.get(HI_KEY).catch(() => undefined)) ?? {}) as { log?: HiRow[] }
  const flip = async (key: CfgKey) => {
    ;(cfg as Record<string, unknown>)[key] = !cfg[key]
    await saveSettings($)
  }
  const sw = (isOn: boolean) => <Text color={isOn ? 'success' : 'inactive'} bold>{isOn ? '[on] ' : '[off]'}</Text>
  const next = nextHiSlot(now)
  // 07:00 ✓  12:00 next, in 2h10  17:00  22:00
  const slotText = (slot: number) => {
    const row = (kept.log ?? []).find(r => r.slot === slot)
    if (row?.status === 'sent') return { text: `${vnClock(slot)} ✓`, color: 'success' }
    if (row?.status === 'busy') return { text: `${vnClock(slot)} · in use`, color: 'inactive' }
    if (row?.status === 'missed') return { text: `${vnClock(slot)} · missed`, color: 'inactive' }
    if (row?.status === 'failed') return { text: `${vnClock(slot)} ✗ failed`, color: 'error' }
    if (slot === next) return { text: `${vnClock(slot)} next, in ${span(slot - now)}`, color: 'claude' }
    return { text: vnClock(slot), color: slot < now ? 'inactive' : 'text' }
  }
  return (
    <Box key="automation" flexDirection="column" marginTop={1}>
      <Text color="subtle" bold>◇ Automation</Text>
      <Button key="auto:continue" plain hotkey="a" onPress={() => flip('autoContinue')}>
        {sw(cfg.autoContinue)} <Text bold>Auto-continue</Text>
        <Text dimColor>{`  a turn the 5-hour or weekly limit stopped gets "${CONTINUE_TEXT}" once the window resets`}</Text>
      </Button>
      {pending ? (
        <Box key="auto:pending" flexDirection="row" gap={1}>
          <Text color="claude">{`  ⏵ "${CONTINUE_TEXT}" at ${vnClock(pending.at)}, in ${span(pending.at - now)}: after the ${pending.window} window resets${pending.tries > 1 ? ` · try ${pending.tries}` : ''}`}</Text>
          <Button key="auto:cancel" plain onPress={async () => {
            await update($, autoContinue, () => null)
            $.ui.toast('statusbar: auto-continue cancelled')
          }}>
            <Text backgroundColor="subtle" color="inverseText" bold>{' cancel '}</Text>
          </Button>
        </Box>
      ) : cfg.autoContinue ? <Text dimColor>  nothing waiting</Text> : null}
      <Button key="auto:hi" plain hotkey="h" onPress={() => flip('hiSchedule')}>
        {sw(cfg.hiSchedule)} <Text bold>Auto-start 5h window</Text>
        <Text dimColor>{`  every 5 hours from ${hiStart()}, Vietnam time; the start time is in + then Settings`}</Text>
      </Button>
      {cfg.hiSchedule ? (
        <Text>
          {'  '}
          {hiSlotsOf(vnMidnight(now)).map((slot, i) => {
            const t = slotText(slot)
            return <Text key={`hi-${slot}`} color={t.color}>{`${i ? '   ' : ''}${t.text}`}</Text>
          })}
          {next >= vnMidnight(now) + DAY ? <Text color="claude">{`   next: tomorrow ${vnClock(next)}`}</Text> : null}
        </Text>
      ) : null}
    </Box>
  )
}
