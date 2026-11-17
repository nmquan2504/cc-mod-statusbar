// One on/off row of a menu. The terminal draws it as a Button with [on] or [off] in the row's
// color. The desktop draws a button's text in one color and has no switch element, so there the
// row is a Markdown whose switch is an SVG image linked to a file: address: the desktop draws a
// data: image in Markdown, and a press on the link comes back through onLinkPress (measured in the
// pet spike, 2026-11-16). The label and the note follow the switch in the same Markdown.

export type ToggleTone = 'success' | 'error' | 'warning' | 'inactive'

const TONE_HEX: Record<ToggleTone, string> = {
  success: '#22c55e',
  error: '#ef4444',
  warning: '#eab308',
  inactive: '#9ca3af',
}

// A 36 by 20 switch: the track in the row's color, the knob right when on, left when off.
export function switchSvg(isOn: boolean, tone: ToggleTone) {
  const fill = TONE_HEX[tone]
  const knobX = isOn ? 26 : 10
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="20" viewBox="0 0 36 20"><rect x="1" y="1" width="34" height="18" rx="9" fill="${fill}"/><circle cx="${knobX}" cy="10" r="7" fill="#ffffff"/></svg>`
}

export const switchUri = (isOn: boolean, tone: ToggleTone) => `data:image/svg+xml;utf8,${encodeURIComponent(switchSvg(isOn, tone))}`

// The address a switch's link points at: never opened, only matched by pressableLinks.
export const toggleHref = (key: string) => `file:///qsb-toggle/${encodeURIComponent(key)}`

// Markdown's own marks in a label or note, escaped so they draw as written.
const md = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, '\\$1')

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
  const { Button, Markdown, Text } = els
  const tone: ToggleTone = r.isOn ? (r.onTone ?? 'success') : (r.offTone ?? 'inactive')
  if (isTerminal || !Markdown) {
    return (
      <Button key={r.key} plain hotkey={r.hotkey} onPress={r.onPress}>
        <Text color={tone} bold>{r.isOn ? '[on] ' : '[off]'}</Text>
        {' '}<Text bold>{r.label}</Text>
        {r.note ? <Text dimColor>{`  ${r.note}`}</Text> : ''}
      </Button>
    )
  }
  const href = toggleHref(r.key)
  const alt = r.isOn ? 'on' : 'off'
  const text = `[![${alt}](${switchUri(r.isOn, tone)})](${href}) **${md(r.label)}**${r.note ? ` ${md(r.note)}` : ''}`
  return <Markdown key={r.key} text={text} pressableLinks={[href]} onLinkPress={() => void r.onPress()} />
}
