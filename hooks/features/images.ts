import { atom, update } from 'claude-code'
import type { ImageRow } from '../../types'
import { parent } from '../lib/format'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The images pasted this session, for the images menu, and the prompt each came with.
const images = atom({ plugin: 'cc-mod-statusbar', key: 'images' } as const, [])

export const imageNotes: Record<number, string> = {}

// The servers Claude started: TCP ports in LISTEN held by a process under this Claude Code
// process (a background Bash, a dev server it ran, an MCP server). The root is the parent of a
// shell this mod starts; every process under it is walked from `ps`, and `lsof` names the
// ports of those pids alone, so a server the person started elsewhere stays out.
// The engine saves a pasted image as <n>.png under /tmp/claude-<uid>/<project>/<session>/images,
// n being the number in its [Image #n]: list that folder, newest last.
export async function readImages($: any) {
  const id = await $.session.id().catch(() => '')
  if (!id) return
  const script = 'for d in /private/tmp/claude-$(id -u)/*/"$1"/images /tmp/claude-$(id -u)/*/"$1"/images; do [ -d "$d" ] && { stat -f "%m %z %N" "$d"/*; break; }; done'
  const r = await $.process.run(['sh', '-c', script, 'sh', id]).catch(() => undefined)
  const rows: ImageRow[] = []
  for (const line of String(r?.stdout ?? '').split('\n')) {
    const m = /^(\d+) (\d+) (.*\/(\d+)\.\w+)$/.exec(line.trim())
    if (m) rows.push({ n: Number(m[4]), path: m[3]!, at: Number(m[1]) * 1000, bytes: Number(m[2]) })
  }
  await update($, images, () => rows.sort((a, b) => a.n - b.n))
}

// Deletes pasted images from the session's images folder: their files alone (a path must end in
// images/<n>.<ext>), never what the conversation already holds of them; then lists the folder again.
export const IMAGE_FILE = /\/images\/\d+\.\w+$/
export async function deleteImages($: any, paths: string[]) {
  const files = paths.filter(path => IMAGE_FILE.test(path))
  if (files.length === 0) return 0
  const r = await $.process.run(['rm', '-f', '--', ...files]).catch(() => undefined)
  await readImages($)
  return r?.exitCode === 0 ? files.length : 0
}
