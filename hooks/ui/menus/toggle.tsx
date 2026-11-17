// One on/off row of a menu. The terminal draws it as a Button with [on] or [off] in the row's
// color. The desktop draws a button's text in one color and has no switch element, so there the
// switch is an Svg in the row's color, with the label as a Button beside it on the same line. A
// blank Button laid over the Svg (the desktop honours position="absolute"; a Button with no label
// draws its blank children, measured in the pet spike of 2026-11-16) makes the switch itself a
// press too. A Markdown image put the switch on a line of its own, above the label.

export type ToggleTone = 'success' | 'error' | 'warning' | 'inactive'

const TONE_HEX: Record<ToggleTone, string> = {
  success: '#22c55e',
  error: '#ef4444',
  warning: '#eab308',
  inactive: '#9ca3af',
}

// A 32 by 18 switch: the track in the row's color, the knob right when on, left when off.
export const SWITCH_PX = { width: 32, height: 18 }
export function switchSvg(isOn: boolean, tone: ToggleTone) {
  const fill = TONE_HEX[tone]
  const knobX = isOn ? 23 : 9
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18" viewBox="0 0 32 18"><rect x="1" y="1" width="30" height="16" rx="8" fill="${fill}"/><circle cx="${knobX}" cy="9" r="6" fill="#ffffff"/></svg>`
}

export type ToggleRow = {
  key: string
  isOn: boolean
  // the color while off: inactive for a setting, red or yellow for a guardrail
  offTone?: ToggleTone
  // the color while on: green unless the row says otherwise (a guardrail that warns)
  onTone?: ToggleTone
  label: string
  note?: string
  hotkey?: string
  onPress: () => unknown
}

export function drawToggle(els: any, isTerminal: boolean, r: ToggleRow) {
  const { Box, Button, Svg, Text } = els
  const tone: ToggleTone = r.isOn ? (r.onTone ?? 'success') : (r.offTone ?? 'inactive')
  if (isTerminal || !Svg) {
    return (
      <Button key={r.key} plain hotkey={r.hotkey} onPress={r.onPress}>
        <Text color={tone} bold>{r.isOn ? '[on] ' : '[off]'}</Text>
        {' '}<Text bold>{r.label}</Text>
        {r.note ? <Text dimColor>{`  ${r.note}`}</Text> : ''}
      </Button>
    )
  }
  return (
    <Box key={`toggle:${r.key}`} flexDirection="row" alignItems="center" gap={1}>
      <Box key={`switch:${r.key}`} flexShrink={0}>
        <Svg source={switchSvg(r.isOn, tone)} alt={r.isOn ? 'on' : 'off'} width={SWITCH_PX.width} height={SWITCH_PX.height} />
        <Box position="absolute" top={0} left={0}>
          <Button key={`${r.key}:switch`} plain onPress={r.onPress}>{'    '}</Button>
        </Box>
      </Box>
      <Button key={r.key} plain hotkey={r.hotkey} onPress={r.onPress}>
        <Text bold>{r.label}</Text>
        {r.note ? <Text dimColor>{`  ${r.note}`}</Text> : ''}
      </Button>
    </Box>
  )
}
