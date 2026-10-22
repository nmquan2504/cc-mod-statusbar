
// The one-entry row most menus list. Every menu takes ($, els, isTerminal, entry): the engine
// lets $ pass from file to file only as an argument, never inside an object.
export type Entry = ReturnType<typeof makeEntry>

// One entry: a hotkey, an icon, a title and a dim line under it, two cells in from its group's
// heading (the engine draws the hotkey before the label, so the row is indented, not the label).
export const ENTRY_INDENT = 2
export const makeEntry = (els: any) => {
  const { Box, Button, Text } = els
  return (key: string, hotkey: string | undefined, icon: string, title: string, note: string, onPress: () => void, color = 'text') => (
    <Box key={`row:${key}`} paddingLeft={ENTRY_INDENT}>
      <Button key={key} plain hotkey={hotkey} onPress={onPress}>
        {icon} <Text color={color} bold>{title}</Text>
        {note ? <Text dimColor>  {note}</Text> : ''}
      </Button>
    </Box>
  )
}
