import { outputStyles } from '../../features/assist'

import { mix } from '../../lib/graphics'
import { BAR_ITEMS, BAR_PRESETS, DEFAULTS, HISTORY_KEY, SETTINGS, SETTINGS_KEY, applyBarPreset, barOrder, barPresetNow, cfg, importSettings, moveBarItem, restorePreviousSettings, saveSettings, settingsText } from '../../state/config'
import { hhmm } from '../../lib/format'
import type { CfgKey, SettingsSnapshot } from '../../state/config'
import type { Entry } from './entry'

// The settings menu.
export async function drawSettingsMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const history = ((await $.store.get(HISTORY_KEY).catch(() => undefined)) ?? []) as SettingsSnapshot[]
  const styles = await outputStyles($)
  const style = String(((await $.settings.read().catch(() => ({}))) as { outputStyle?: string }).outputStyle ?? 'default')
  const set = async (key: CfgKey, value: boolean | number) => {
    ;(cfg as Record<string, unknown>)[key] = value
    await saveSettings($)
  }
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Bar preset</Text>
        <Text dimColor>{barPresetNow() ? '  sets every item below at once' : '  sets every item below at once; yours is a mix of your own'}</Text>
      </Text>
      <Box key="bar-presets" flexDirection="row" gap={1} marginBottom={1}>
        {BAR_PRESETS.map(p => {
          const isNow = barPresetNow()?.name === p.name
          return (
            <Button key={`preset:${p.name}`} plain onPress={() => applyBarPreset($, p.name)}>
              <Text backgroundColor={isNow ? 'claude' : 'subtle'} color="inverseText" bold>{` ${isNow ? '● ' : ''}${p.name} `}</Text>
              <Text dimColor>{` ${p.note}`}</Text>
            </Button>
          )
        })}
      </Box>
      <Text>
        <Text bold>On the bar</Text>
        <Text dimColor>  a press shows or hides the item, ‹ › move it; left of the arena, the left group; + ⁄ and Claude's ✻ always stay</Text>
      </Text>
      <Box key="bar-items" flexDirection="row" gap={1} flexWrap="wrap" marginBottom={1}>
        {barOrder().map((key, i, order) => {
          const item = BAR_ITEMS.find(x => x.key === key)!
          const isOn = cfg[key] as boolean
          return (
            <Box key={`order:${key}`} flexDirection="row">
              {i > 0 ? (
                <Button key={`left:${key}`} plain onPress={() => moveBarItem($, key, -1)}>
                  <Text color="claude" bold>‹</Text>
                </Button>
              ) : <Text> </Text>}
              <Button key={`bar:${key}`} plain onPress={() => set(key, !isOn)}>
                <Text backgroundColor={isOn ? 'claude' : 'subtle'} color="inverseText" bold>{` ${isOn ? '✓' : '·'} ${item.label} `}</Text>
              </Button>
              {i < order.length - 1 ? (
                <Button key={`right:${key}`} plain onPress={() => moveBarItem($, key, 1)}>
                  <Text color="claude" bold>›</Text>
                </Button>
              ) : <Text> </Text>}
            </Box>
          )
        })}
      </Box>
      {SETTINGS.map((r, i) => {
        if (r.kind === 'switch') {
          const isOn = cfg[r.key] as boolean
          return (
            <Button key={`set:${r.key}`} plain hotkey={i < 9 ? String(i + 1) : undefined} onPress={() => set(r.key, !isOn)}>
              <Text color={isOn ? 'success' : 'inactive'} bold>{isOn ? '[on] ' : '[off]'}</Text>
              {' '}<Text bold>{r.label}</Text><Text dimColor>{`  ${r.note}`}</Text>
            </Button>
          )
        }
        const n = cfg[r.key] as number
        return (
          <Box key={`num:${r.key}`} flexDirection="row" gap={1}>
            <Button key={`dec:${r.key}`} plain onPress={() => set(r.key, Math.max(r.min, n - r.step))}>
              <Text backgroundColor="subtle" color="inverseText" bold>{' − '}</Text>
            </Button>
            <Text color="claude" bold>{`${n}${r.unit}`.padStart(5)}</Text>
            <Button key={`inc:${r.key}`} plain onPress={() => set(r.key, Math.min(r.max, n + r.step))}>
              <Text backgroundColor="subtle" color="inverseText" bold>{' + '}</Text>
            </Button>
            <Text><Text bold>{r.label}</Text><Text dimColor>{`  ${r.note}`}</Text></Text>
          </Box>
        )
      })}
      <Text>
        {'\n'}<Text bold>Output style</Text>
        <Text dimColor>  how Claude answers; a pick runs /output-style, kept in .claude/settings.local.json</Text>
      </Text>
      <Box key="styles" flexDirection="row" gap={1} flexWrap="wrap" marginBottom={1}>
        {styles.map(name => {
          const isNow = name === style
          return (
            <Button key={`style:${name}`} plain onPress={async () => {
              if (isNow) return
              await $.command.run({ command: 'output-style', args: name })
              $.ui.toast(`statusbar: output style ${name}`)
              $.ui.invalidate('ui.render')
            }}>
              <Text backgroundColor={isNow ? 'claude' : 'subtle'} color="inverseText" bold>{` ${isNow ? '● ' : ''}${name} `}</Text>
            </Button>
          )
        })}
      </Box>
      <Button key="set:reset" plain hotkey="r" onPress={async () => {
        await $.store.delete(SETTINGS_KEY).catch(() => undefined)
        Object.assign(cfg, DEFAULTS)
        $.ui.invalidate('ui.render')
      }}>
        <Text color="claude">→ Back to the defaults</Text>
      </Button>
      {history.length > 0 ? (
        <Button key="set:undo" plain hotkey="u" onPress={async () => {
          const isDone = await restorePreviousSettings($)
          $.ui.toast(isDone ? 'statusbar: settings put back as they were before the last change' : 'statusbar: no earlier settings kept')
        }}>
          <Text color="claude">↶ Undo the last change</Text>
          <Text dimColor>{`  back to the settings of ${hhmm(history[history.length - 1]!.at)}; ${history.length} kept`}</Text>
        </Button>
      ) : null}
      <Button key="set:copy" plain hotkey="c" onPress={async () => {
        const r = await $.ui.copy({ text: settingsText() }).catch(() => ({ isCopied: false, reason: 'refused' }))
        $.ui.toast(r.isCopied ? 'statusbar: settings copied; on another machine, copy them and press p here' : `statusbar: settings not copied (${r.reason})`)
      }}>
        <Text color="claude">⧉ Copy the settings</Text>
        <Text dimColor>  as JSON, for another machine or a teammate; no secrets go with them</Text>
      </Button>
      <Button key="set:paste" plain hotkey="p" onPress={async () => {
        const r = await $.process.run(['pbpaste']).catch(() => undefined)
        const n = r && r.exitCode === 0 ? await importSettings($, r.stdout) : 0
        $.ui.toast(n ? `statusbar: ${n} settings taken from the clipboard; u puts yours back` : 'statusbar: the clipboard holds no settings')
      }}>
        <Text color="claude">⇩ Paste settings</Text>
        <Text dimColor>  from the clipboard, in place of these; Undo puts these back</Text>
      </Button>
      <Text dimColor>Kept for every session in this mod's store.</Text>
    </Box>
  )
}
