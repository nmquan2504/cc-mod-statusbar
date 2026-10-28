// Pairs with a real hub the way the app does (src/e2e.ts) and makes sealed calls: run against a
// hub started with QSB_REMOTE_LOCAL (no tunnel), its control socket allowing the request.
//   node --experimental-strip-types scripts/e2e-check.mts <hub dir>
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call, pair, Unpaired } from '../src/e2e.ts'
import { parseLink } from '../src/link.ts'

const dir = process.argv[2]
const ctl = (method: string, path: string, body?: unknown) =>
  JSON.parse(execFileSync('curl', ['-s', '--max-time', '5', '--unix-socket', `${dir}/hub.sock`, '-X', method, ...(body ? ['-H', 'Content-Type: application/json', '-d', JSON.stringify(body)] : []), `http://hub${path}`], { encoding: 'utf8' }) || 'null')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const check = (name: string, ok: boolean, detail: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : JSON.stringify(detail)}`); if (!ok) process.exitCode = 1 }

// the session's folder, with a file of each kind the phone shows, saves or opens
const root = mkdtempSync(join(tmpdir(), 'qsb-files-'))
writeFileSync(join(root, 'notes.md'), '# Notes\n')
writeFileSync(join(root, 'report.pdf'), '%PDF-1.4\nno NUL in its head\n')
writeFileSync(join(root, 'data.bin'), Buffer.from([1, 0, 2, 3]))
writeFileSync(join(root, 'clip.mp4'), Buffer.from([0, 0, 0, 24]))
writeFileSync(join(root, '.env'), 'KEY=1\n')
ctl('POST', '/session?id=t1', { folder: 'shop', roots: [root], transcript: [], images: [], edited: [], changes: [], busy: false })
const link = parseLink(ctl('GET', '/status').link)
check('the QR link parses', Boolean(link?.k && link.base.startsWith('http')), link)
check('a link with no K does not', parseLink('https://x.trycloudflare.com/') === null)
const handedLink = parseLink(`clauderemote://pair?base=${encodeURIComponent('https://a-b.trycloudflare.com')}&k=${'A'.repeat(43)}&t=${'t'.repeat(24)}`)
check('the page\'s hand over parses', handedLink?.base === 'https://a-b.trycloudflare.com' && handedLink.k === 'A'.repeat(43) && handedLink.ticket === 't'.repeat(24), handedLink)
check('a hand over to an http host does not', parseLink(`clauderemote://pair?base=http://evil.example&k=${'A'.repeat(43)}`) === null)
const { device, code } = await pair(link!.base, link!.k)
check('pairing answers a code the terminal shows', ctl('GET', '/status').pending.some((p: any) => p.code === code), code)
const waiting = await call(device, 'paired')
check('before Allow: waiting', waiting.s === 202 && waiting.b.code === code, waiting)
ctl('POST', '/allow', { id: ctl('GET', '/status').pending[0].id })
check('after Allow: paired', (await call(device, 'paired')).s === 200)
const state = await call(device, 'state', { since: -1 })
check('a sealed call answers the state', state.s === 200 && state.b.sessions?.[0]?.folder === 'shop', state.b?.sessions)
// files: each with its kind and type, its bytes sent whole (raw); a secret never
const file = (name: string, raw = false) => call(device, 'file', { session: 't1', path: join(root, name), ...(raw ? { raw } : {}) })
const md = await file('notes.md')
check('a text file: its text and type', md.s === 200 && md.b.kind === 'text' && md.b.type === 'text/markdown' && md.b.text === '# Notes\n' && md.b.isTooBig === false, md.b)
const pdf = await file('report.pdf')
check('a PDF is a document, though its head holds no NUL', pdf.s === 200 && pdf.b.kind === 'binary' && pdf.b.type === 'application/pdf' && pdf.b.text === undefined, pdf.b)
const bin = await file('data.bin', true)
check('a binary\'s bytes, raw, with its name', bin.s === 200 && bin.b.type === 'application/octet-stream' && bin.b.name === 'data.bin' && Buffer.from(bin.b.b64, 'base64').equals(Buffer.from([1, 0, 2, 3])), bin.b)
const mdRaw = await file('notes.md', true)
check('a text file\'s bytes, raw', mdRaw.s === 200 && Buffer.from(mdRaw.b.b64, 'base64').toString() === '# Notes\n', mdRaw.b)
const mp4 = await file('clip.mp4')
check('a video', mp4.s === 200 && mp4.b.kind === 'video' && mp4.b.type === 'video/mp4', mp4.b)
const env = await file('.env', true)
check('a secret is locked, raw or not', env.s === 403 && env.b.isLocked && !env.b.b64, env.b)
const devs = await call(device, 'devices')
check('the hub lists this phone as itself', devs.b.devices.some((d: any) => d.isThis), devs.b)
// the app's service: watch waits for the next notice, and answers it with its folder
const since = Date.now()
const watching = call(device, 'watch', { since })
await sleep(300)
ctl('POST', '/notify?id=t1', { title: 'Done', body: 'Đã sửa xong.' })
const seen = await watching
check('watch answers the next notice', seen.s === 200 && seen.b.notice.at > since && seen.b.folder === 'shop', seen.b)
// the browser hands over to the app: its ticket pairs the app with no Allow, once, and the
// browser's notifications stop
await call(device, 'subscribe', { sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: {} } })
check('the browser has a push subscription', ctl('GET', '/status').subscriptions === 1)
// an app paired by QR code: the browsers still notified, and one turned off, its pairing kept
const scanned = await pair(link!.base, link!.k)
ctl('POST', '/allow', { id: ctl('GET', '/status').pending[0].id })
const listed = (await call(scanned.device, 'devices')).b.devices
check('devices says which phone has notifications', listed.some((d: any) => d.id === device.id && d.hasPush) && listed.some((d: any) => d.isThis && !d.hasPush), listed)
check('push-off turns that phone\'s off', (await call(scanned.device, 'push-off', { id: device.id })).s === 200 && ctl('GET', '/status').subscriptions === 0 && (await call(device, 'paired')).s === 200)
check('push-off of itself is refused', (await call(scanned.device, 'push-off', { id: scanned.device.id })).s === 404)
await call(scanned.device, 'forget')
await call(device, 'subscribe', { sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: {} } })
const handed = await call(device, 'handoff')
check('handoff answers a ticket and K', handed.s === 200 && handed.b.k === link!.k && /^[\w-]{24}$/.test(handed.b.ticket), handed.b)
const app = await pair(link!.base, handed.b.k, fetch, handed.b.ticket)
check('the ticket pairs the app at once', (await call(app.device, 'paired')).s === 200)
check('the browser keeps its pairing, not its notifications', (await call(device, 'paired')).s === 200 && ctl('GET', '/status').subscriptions === 0)
const again = await pair(link!.base, handed.b.k, fetch, handed.b.ticket)
check('a ticket used once waits for Allow again', (await call(again.device, 'paired')).s === 202)
// a wrong K: the hub refuses to say welcome
let refused = ''
try { await pair(link!.base, 'A'.repeat(43)) } catch (e) { refused = String((e as Error).message) }
check('a wrong K is refused', /not the one the terminal shows/.test(refused), refused)
// unpaired: forget, then a call says so
await call(device, 'forget')
let gone = false
try { await call(device, 'state', { since: -1 }) } catch (e) { gone = e instanceof Unpaired }
check('after forget: unpaired', gone)
await sleep(10)
