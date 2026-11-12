// A file of a session, asked by the page's Save or Open: its bytes fetched sealed from the hub and
// written to the app's cache as they come, then copied into the phone's Downloads
// (modules/downloads), or handed to the app Android picks by the file's type. A hub that serves
// files by the piece (2 MB a call) gives up to 500 MB, never held whole in memory; an older hub
// gives the whole file in one call, 20 MB at most. The page hears { name } (as saved) or an error,
// in English, as the hub's errors are (the page gives them in Vietnamese).
import { Directory, File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import Downloads from '../modules/downloads'
import { b64, call } from './e2e'
import type { Device } from './e2e'

// one file at a time in the cache: the one fetched last, gone at the next
const FETCHED = new Directory(Paths.cache, 'opened')

// a name Android's folders take: no slashes or control characters
const safeName = (name: string) => name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file'

type Fetched = { name: string; type: string; file: File }
export type OnPart = (done: number, size: number) => void

// a piece asked again twice before the fetch fails: a tunnel that drops one call need not end it
async function piece(dev: Device, a: Record<string, unknown>, at: number) {
  let r: Awaited<ReturnType<typeof call>> | null = null
  for (let tries = 0; tries < 3; tries++) {
    r = await call(dev, 'file', { ...a, raw: true, at }).catch(() => null)
    if (r?.s === 200 && typeof r.b?.b64 === 'string') return r
    if (r && r.s !== 0 && r.s < 500) break
  }
  throw new Error(String(r?.b?.error || 'Could not open the file.'))
}

async function fetchFile(dev: Device, a: Record<string, unknown>, onPart: OnPart): Promise<Fetched> {
  const where = { session: String(a.session ?? ''), path: String(a.path ?? '') }
  const info = await call(dev, 'file', where)
  if (info.s !== 200) throw new Error(String(info.b?.error || 'Could not open the file.'))
  const name = safeName(String(info.b.name || 'file'))
  const type = String(info.b.type || 'application/octet-stream')
  try { FETCHED.delete() } catch {}
  FETCHED.create({ intermediates: true, idempotent: true })
  const file = new File(FETCHED, name)
  file.create({ overwrite: true })
  // an older hub: the whole file in one call
  if (!info.b.piece) {
    const r = await call(dev, 'file', { ...where, raw: true })
    if (r.s !== 200 || typeof r.b?.b64 !== 'string') throw new Error(String(r.b?.error || 'Could not open the file.'))
    await file.write(b64.dec(r.b.b64))
    onPart(file.size, file.size)
    return { name, type, file }
  }
  const size = Number(info.b.size) || 0
  const handle = file.open()
  try {
    for (let at = 0; at < size;) {
      const r = await piece(dev, where, at)
      if (Number(r.b.size) !== size) throw new Error('The file changed on the computer while it was sent. Try again.')
      const bytes = b64.dec(r.b.b64)
      if (!bytes.length) throw new Error('Could not open the file.')
      await handle.writeBytes(bytes)
      at += bytes.length
      onPart(at, size)
    }
  } finally {
    handle.close()
  }
  return { name, type, file }
}

async function open(f: Fetched) {
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: await getContentUriAsync(f.file.uri),
      // bytes of no known type: Android offers every app that takes a file
      type: f.type === 'application/octet-stream' ? '*/*' : f.type,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    })
  } catch (err) {
    throw /ActivityNotFound|No Activity found/i.test(String((err as Error)?.message)) ? new Error('No app on this phone opens this kind of file.') : err
  }
  return f.name
}

// the name the file has now: in Downloads (Android adds (1) when one was there), or as opened
export async function handFile(dev: Device, how: 'save' | 'open', a: Record<string, unknown>, onPart: OnPart = () => undefined): Promise<string> {
  const f = await fetchFile(dev, a, onPart)
  if (how === 'open') return open(f)
  try {
    return await Downloads.saveFile(f.name, f.file.uri)
  } finally {
    try { f.file.delete() } catch {}
  }
}
