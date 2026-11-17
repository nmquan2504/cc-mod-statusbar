// Desktop draws a button's text in one color and no background, so a control whose state has a
// color is drawn as Text, each part in its color, under one blank Button laid over the whole of it
// (Desktop honours position="absolute"): a press anywhere on it is the Button's press. Every chip
// on the desktop bar is one, so their boxes and the gaps between them match.

// The blank text of a Button laid over `text`, as wide as it less the Button's own padding.
// 0.23.4 to 0.24.0 gave every character a figure space and took one off: the pads came out uneven,
// wide after ≡ 0, ⇄ and ◈ 2, narrow after wk 75%. Now each glyph has a width in em, as the
// desktop's sans font draws it, and the blank is made of the Unicode spaces of fixed em widths (em,
// en, three-, four- and six-per-em, hair) that add up to the text's width less the padding.
// the small room each press area keeps left and right of its text: a three-per-em space
export const PAD = '\u2004'
// the Button's own padding, both sides together, in em: from 0.23.4's usage group, which fit (its
// blank of figure and four-per-em spaces plus this padding came to the text's width)
export const BUTTON_PAD_EM = 1.3
// a colored part is bold, a little wider than regular
const BOLD = 1.06

const NARROW = new Set([...'iljtfrI.,:;!|\'`'])
const WIDE = new Set([...'mwMW%@'])
// one glyph's width in em: approximate, for a proportional sans
export const glyphEm = (ch: string) => {
  if (ch === ' ') return 0.27
  if (ch === PAD) return 1 / 3
  if (/[0-9]/.test(ch)) return 0.6
  if (NARROW.has(ch)) return 0.28
  if (WIDE.has(ch)) return 0.85
  if (/[A-Z]/.test(ch)) return 0.68
  if (/[a-z]/.test(ch)) return 0.54
  if (/[-_/()[\]{}·•]/.test(ch)) return 0.36
  if (/[\u2190-\u21ff]/.test(ch)) return 0.9 // arrows: ⇄ ⇡ ⇣
  return 0.78 // other symbols: ☰ ⌁ ◈ ✘ ✻ ▤ ⎇ ✎ ▣ ✦ ◔ ⏵
}
export const textEm = (text: string) => [...text].reduce((n, ch) => n + glyphEm(ch), 0)

// the fixed-width spaces, widest first, and their widths in em
const SPACES: [string, number][] = [['\u2003', 1], ['\u2002', 0.5], ['\u2004', 1 / 3], ['\u2005', 0.25], ['\u2006', 1 / 6], ['\u200a', 0.1]]
export const spacesFor = (em: number) => {
  let left = Math.max(0, em)
  let out = ''
  for (const [ch, w] of SPACES) {
    while (left >= w - 0.04) {
      out += ch
      left -= w
    }
  }
  return out
}
export const blankOf = (text: string) => spacesFor(textEm(text) - BUTTON_PAD_EM)
const partsEm = (parts: [string, string?][]) => parts.reduce((n, [t, color]) => n + textEm(t) * (color ? BOLD : 1), 0)

// One part of a press area: its text and its color (none: the text's own); bold when colored.
export type Part = [string, string?]

// `key` is the Button's, so a press and a test find it as before; the Box holding it is `chipbox:key`.
export function pressArea(els: any, key: string, onPress: () => unknown, parts: Part[]) {
  const { Box, Button, Text } = els
  const shown: Part[] = [[PAD], ...parts.filter(([t]) => t), [PAD]]
  return (
    <Box key={`chipbox:${key}`} flexDirection="row" alignItems="center">
      {shown.map(([t, color], i) => <Text key={`${key}:${i}`} color={color} bold={Boolean(color)}>{t}</Text>)}
      <Box position="absolute" top={0} left={0}>
        <Button key={key} plain onPress={onPress}>{spacesFor(partsEm(shown) - BUTTON_PAD_EM)}</Button>
      </Box>
    </Box>
  )
}
