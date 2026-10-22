import { insertText } from '../../features/menu'

import type { Entry } from './entry'

// The web menu.
export async function drawWebMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
  const { Box, Text } = els
  if (!('Input' in els)) return <Text dimColor>This surface has no text field.</Text>
  const { Input } = els
  return (
    <Box flexDirection="column">
      <Input key="url" label="◎ URL" placeholder="https://…" autoFocus submitLabel="Add" onSubmit={(value: string) => {
        const url = value.trim()
        if (!/^https?:\/\//i.test(url)) return void $.ui.toast('statusbar: a URL starts with http:// or https://')
        void insertText($, `Read ${url} and use it as context. `)
      }} />
      <Text color="warning">! Fetching a page taints the session: outbound curl/wget is then blocked.</Text>
    </Box>
  )
}
