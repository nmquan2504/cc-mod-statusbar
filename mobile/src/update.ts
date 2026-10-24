// The app's own updates, from the repository's latest GitHub release (the workflow publishes one
// per mod version, its APK and the APK's SHA-256). Checked at most twice a day as the app opens,
// or at once from Settings; an update is downloaded, its SHA-256 checked against the release's,
// and handed to Android's installer, which asks before installing (and, the first time, for the
// right to install from this app). The release is signed with the app's key, so Android refuses
// an APK signed with any other.
import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as SecureStore from 'expo-secure-store'
import { VERSION } from './version'

const REPO = 'nmquan2504/cc-mod-statusbar'
const EVERY_MS = 12 * 3600_000
const CHECKED_KEY = 'updateCheckedAt'
const SKIPPED_KEY = 'updateSkipped'

export type Release = { version: string; apk: string; sha: string; notes: string }

// a dotted version newer than another: 0.16.1 after 0.16.0
export const isNewer = (v: string, than: string) => {
  const a = v.split('.').map(Number), b = than.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return false
}

// the latest release, when it is newer than this app and has its APK; null when it is not
export async function latest(): Promise<Release | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`GitHub trả lời ${r.status}.`)
  const rel = await r.json()
  const version = String(rel.tag_name ?? '').replace(/^v/, '')
  const asset = (name: string) => (rel.assets as { name: string; browser_download_url: string }[] | undefined)?.find(a => a.name === name)?.browser_download_url ?? ''
  const file = `claude-remote-${version}.apk`
  const apk = asset(file), sha = asset(`${file}.sha256`)
  return /^\d+\.\d+\.\d+$/.test(version) && isNewer(version, VERSION) && apk && sha ? { version, apk, sha, notes: String(rel.body ?? '') } : null
}

// As the app opens: a release not skipped, at most every 12 hours; quiet on any failure
export async function checkNow(isForced = false): Promise<Release | null> {
  if (!isForced) {
    const at = Number(await SecureStore.getItemAsync(CHECKED_KEY).catch(() => null)) || 0
    if (Date.now() - at < EVERY_MS) return null
  }
  await SecureStore.setItemAsync(CHECKED_KEY, String(Date.now())).catch(() => undefined)
  const rel = await latest()
  if (!rel || isForced) return rel
  return (await SecureStore.getItemAsync(SKIPPED_KEY).catch(() => null)) === rel.version ? null : rel
}
export const skip = (rel: Release) => SecureStore.setItemAsync(SKIPPED_KEY, rel.version).catch(() => undefined)

// The APK downloaded (progress 0 to 1), its SHA-256 checked, then Android's installer opened
export async function install(rel: Release, onProgress: (part: number) => void) {
  const expected = (await (await fetch(rel.sha)).text()).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('Bản phát hành không có SHA-256 hợp lệ.')
  const file = new File(Paths.cache, `claude-remote-${rel.version}.apk`)
  await File.downloadFileAsync(rel.apk, file, {
    idempotent: true,
    onProgress: p => { if (p.totalBytes > 0) onProgress(p.bytesWritten / p.totalBytes) },
  })
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(await file.arrayBuffer())))
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
  if (hex !== expected) {
    try { file.delete() } catch {}
    throw new Error('APK tải về không khớp SHA-256 của bản phát hành; đã xoá.')
  }
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: await getContentUriAsync(file.uri),
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  })
}
