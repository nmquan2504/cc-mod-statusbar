import { rewritePrompt } from '../../features/assist'
import { closeMenu, insertText, openMenu } from '../../features/menu'
import { acquire, dialog } from '../../features/vault'
import { mention, oneLine } from '../../lib/format'
import { cfg } from '../../state/config'
import { rt } from '../../state/runtime'
import { ENTRY_INDENT } from './entry'
import type { Entry } from './entry'

// The add menu.
export async function drawAddMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  // three groups: what goes into the prompt as context, what rewrites the prompt, the bar itself
  const heading = (key: string, title: string, note: string, isFirst = false) => (
    <Text key={key}>
      {isFirst ? '' : '\n'}<Text color={isFirst ? 'claude' : 'subtle'} bold>{`${isFirst ? '◆' : '◇'} ${title}`}</Text>
      <Text dimColor>{`  ${note}`}</Text>
    </Text>
  )
  return (
    <Box flexDirection="column">
      {heading('h:context', 'Add context', 'goes into the prompt', true)}
      {entry('upload', '1', '↥', 'Upload a file', 'pick one in a dialog', async () => {
        const r = await $.process.run(['osascript', '-e', 'POSIX path of (choose file with prompt "Add a file as context")'])
        const path = r.stdout.trim()
        if (r.exitCode === 0 && path) await insertText($, mention(path))
        else $.ui.toast('statusbar: no file chosen')
      })}
      {entry('files', '2', '▸', 'Browse project files', 'goes in as an @-mention', () => openMenu($, 'files'))}
      {entry('web', '3', '◎', 'Add a web page', 'a URL the model fetches', () => openMenu($, 'web'))}
      {entry('secret', '4', '#', 'Add a secret', 'hidden dialog -> keychain; Claude sees only its NAME', async () => {
        await closeMenu($)
        const r = await acquire($, {})
        if ('error' in r) $.ui.toast(`statusbar vault: nothing saved (${r.error})`)
      })}
      <Box key="row:never" paddingLeft={ENTRY_INDENT}><Text dimColor>⊘ .env, secrets/, exports/ and key files are never added.</Text></Box>
      {heading('h:prompt', 'Prompt', 'Haiku rewrites the draft in the prompt box; nothing is sent')}
      {entry('polish', '5', '✎', 'Polish the prompt', `Haiku rewrites the draft clear and specific${cfg.polishEnglish ? ', in English' : ''}`, async () => {
        await closeMenu($)
        await rewritePrompt($, 'polish')
      })}
      {entry('translate', '6', '⇄', 'Translate the prompt to English', 'code, paths and names kept as they are', async () => {
        await closeMenu($)
        await rewritePrompt($, 'translate')
      })}
      {rt.lastDraft ? entry('undraft', '7', '↩', 'Put back the draft', oneLine(rt.lastDraft, 60), async () => {
        await closeMenu($)
        await $.prompt.fill({ text: rt.lastDraft, mode: 'replace' })
        rt.lastDraft = ''
      }) : null}
      {heading('h:bar', 'Bar', 'this status bar')}
      {entry('settings', 's', '⊞', 'Settings', 'what the bar shows, and when it warns', () => openMenu($, 'settings'))}
    </Box>
  )
}
