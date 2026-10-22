import { atom, read } from 'claude-code'
import { deleteImages, imageNotes } from '../../features/images'
import { insertText } from '../../features/menu'

import { hhmm, mention } from '../../lib/format'
import { ARM_MS } from '../../features/permissions'
import { rt } from '../../state/runtime'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The images pasted this session, for the images menu, and the prompt each came with.
const images = atom({ plugin: 'cc-mod-statusbar', key: 'images' } as const, [])

// The images menu.
export async function drawImagesMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
  const { Box, Button, Text } = els
  const list = await read($, images)
  const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
  const show = async (path: string) => {
    const r = await $.process.run(['open', path]).catch(() => undefined)
    if (r?.exitCode !== 0) $.ui.toast(`statusbar: could not open ${path}`)
  }
  // a delete takes a second press within ARM_MS, as a settings write does
  const isArmed = (key: string) => rt.armedRule === key && Date.now() - rt.armedAt < ARM_MS
  const del = async (key: string, paths: string[], what: string) => {
    if (!isArmed(key)) {
      rt.armedRule = key
      rt.armedAt = Date.now()
      $.ui.toast(`statusbar: press again within 5 s to delete ${what}`)
      $.ui.invalidate('ui.render')
      return
    }
    rt.armedRule = ''
    const n = await deleteImages($, paths)
    $.ui.toast(n ? `statusbar: deleted ${what}` : `statusbar: could not delete ${what}`)
  }
  const chip = (label: string, isHot: boolean) => (
    <Text backgroundColor={isHot ? 'error' : 'subtle'} color="inverseText" bold>{label}</Text>
  )
  return (
    <Box flexDirection="column">
      {list.length === 0 && <Text dimColor>No image pasted in this session yet.</Text>}
      {list.length > 0 && <Text dimColor>A row or its digit opens it in Preview; @ puts it in the prompt for Claude to look at again; ✕ deletes its file (twice).</Text>}
      {list.map(img => (
        <Box key={`imgrow:${img.n}`} flexDirection="row" gap={1}>
          <Button key={`img@:${img.n}`} plain onPress={() => insertText($, mention(img.path))}>
            <Text backgroundColor="subtle" color="inverseText" bold>{' @ '}</Text>
          </Button>
          <Button key={`imgdel:${img.n}`} plain onPress={() => del(`imgdel:${img.n}`, [img.path], `[Image #${img.n}]`)}>
            {chip(isArmed(`imgdel:${img.n}`) ? ' ✕ again ' : ' ✕ ', isArmed(`imgdel:${img.n}`))}
          </Button>
          <Button key={`img:${img.n}`} plain hotkey={img.n <= 9 ? String(img.n) : undefined} onPress={() => show(img.path)}>
            ▣ <Text color="suggestion" bold>{`[Image #${img.n}]`}</Text>
            <Text dimColor>{`  ${hhmm(img.at)} · ${size(img.bytes)}`}</Text>
            {imageNotes[img.n] ? <Text>{`  ${imageNotes[img.n]}`}</Text> : ''}
          </Button>
        </Box>
      ))}
      {list.length > 0 && (
        <Box key="img:actions" flexDirection="row" gap={2} marginTop={1}>
          <Button key="img:folder" plain onPress={() => show(list[0]!.path.replace(/\/[^/]+$/, ''))}>
            ↗ <Text dimColor>Open the folder in Finder</Text>
          </Button>
          <Button key="img:delete-all" plain onPress={() => del('img:delete-all', list.map(img => img.path), `all ${list.length} images`)}>
            {chip(isArmed('img:delete-all') ? ` ✕ Delete all ${list.length}: press again ` : ` ✕ Delete all ${list.length} `, isArmed('img:delete-all'))}
          </Button>
        </Box>
      )}
    </Box>
  )
}
