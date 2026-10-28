// A file of a session, asked by the page's Save or Open: its bytes fetched sealed from the hub
// (20 MB at most), then written into the phone's Downloads (modules/downloads), or handed to the app
// Android picks by the file's type. The page hears { name } (as saved) or an error, in English, as
// the hub's errors are (the page gives them in Vietnamese).
import { cacheDirectory, deleteAsync, EncodingType, getContentUriAsync, makeDirectoryAsync, writeAsStringAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import Downloads from '../modules/downloads'
import { call } from './e2e'
import type { Device } from './e2e'

// one file at a time in the cache: the one opened last, gone at the next
const OPENED = `${cacheDirectory}opened/`

// a name Android's folders take: no slashes or control characters
const safeName = (name: string) => name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file'

async function fetchFile(dev: Device, a: Record<string, unknown>) {
  const r = await call(dev, 'file', { session: String(a.session ?? ''), path: String(a.path ?? ''), raw: true })
  if (r.s !== 200 || typeof r.b?.b64 !== 'string') throw new Error(String(r.b?.error || 'Could not open the file.'))
  return { name: safeName(String(r.b.name || 'file')), type: String(r.b.type || 'application/octet-stream'), b64: r.b.b64 as string }
}

async function open(f: { name: string; type: string; b64: string }) {
  await deleteAsync(OPENED, { idempotent: true })
  await makeDirectoryAsync(OPENED, { intermediates: true })
  const uri = OPENED + encodeURIComponent(f.name)
  await writeAsStringAsync(uri, f.b64, { encoding: EncodingType.Base64 })
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: await getContentUriAsync(uri),
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
export async function handFile(dev: Device, how: 'save' | 'open', a: Record<string, unknown>): Promise<string> {
  const f = await fetchFile(dev, a)
  return how === 'save' ? Downloads.save(f.name, f.b64) : open(f)
}
