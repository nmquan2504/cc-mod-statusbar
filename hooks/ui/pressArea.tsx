// Desktop draws a button's text in one color and no background, so a control whose state has a
// color is drawn as Text, each part in its color, under one blank Button laid over the whole of it
// (Desktop honours position="absolute"): a press anywhere on it is the Button's press. Measured on
// Desktop (0.23.4 to 0.23.6): with blankOf's widths the area fits its text, a pad at each end.

// The blank text of a Button laid over `text`, as wide as it: a figure space (a digit's width) for
// each character, a four-per-em space for each space (a space is about a quarter em in the
// desktop's font, a figure space twice that), a pad as itself, less one figure space for the
// Button's own padding.
const FIGURE_SPACE = ' '
const SPACE = ' '
// the small room each press area keeps left and right of its text: a three-per-em space
export const PAD = ' '
export const blankOf = (text: string) => {
  const blank = [...text].map(ch => (ch === ' ' ? SPACE : ch === PAD ? PAD : FIGURE_SPACE)).join('')
  const at = blank.lastIndexOf(FIGURE_SPACE)
  return at > 0 ? blank.slice(0, at) + blank.slice(at + 1) : blank
}

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
        <Button key={key} plain onPress={onPress}>{blankOf(shown.map(([t]) => t).join(''))}</Button>
      </Box>
    </Box>
  )
}
