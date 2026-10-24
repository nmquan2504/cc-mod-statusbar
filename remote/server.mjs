// Self remote's hub: one per machine and user, shared by every Claude Code session that turns the
// remote on (Settings, Self remote; then ⇄ on the bar). It serves the phone's page through one
// Cloudflare quick tunnel and keeps each session's latest snapshot.
//
//   the control socket   <dir>/hub.sock, <dir> = $TMPDIR/qsb-remote-<uid> (mode 700): the mods
//                        POST /session (a heartbeat with the snapshot), GET /inbox, GET /status,
//                        POST /notify, POST /allow, POST /deny, POST /stop
//   the public server    127.0.0.1:<random>, reached only through the tunnel
//
// Pairing and every call after it are end-to-end encrypted (e2e.js holds the phone's half): the QR
// link's #fragment is a 256-bit key K that never leaves the phone. A phone proves it holds K with an
// HMAC, the hub answers with its half of an ECDH and an HMAC of its own, and both derive the phone's
// AES-GCM key from the ECDH secret salted with K; the phone then waits, with a 4-character code, until
// the person picks that code in a terminal (the mod offers it among two others), which posts /allow. Cloudflare sees sizes and times, never content. Started detached by
// the first mod (`node server.mjs <dir> <idleMinutes>`); it stops itself when no session has
// called in for two minutes, or no phone has for idleMinutes (0: never). Each session's snapshot
// carries the idle time in force, so a change in Settings reaches a running hub. Node 18 or newer;
// no packages.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createPrivateKey, generateKeyPairSync, randomBytes, randomInt, sign } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Resolver } from 'node:dns/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2]
// minutes with no phone before the hub stops: 0 never, else at least 5 (a week at most)
const idleMsOf = (minutes, fallback) => {
  const m = Number(minutes)
  if (minutes === null || minutes === undefined || minutes === '' || !Number.isFinite(m) || m < 0) return fallback
  return m === 0 ? Infinity : Math.min(10_080, Math.max(5, m)) * 60_000
}
let idleMs = idleMsOf(process.argv[3], 30 * 60_000)
const SESSION_TTL = 120_000
const POLL_WAIT = 25_000
// a phone's request is small; a session's snapshot carries its transcript
const MAX_BODY = 64 * 1024
const MAX_SNAPSHOT = 4 * 1024 * 1024
// the slash commands the phone draws as pages of their own (the mod's pages.ts)
const PAGES = new Set(['model', 'effort', 'config', 'permissions', 'context', 'mcp'])
const MAX_DEVICES = 5
// a phone allowed but not seen for a week is unpaired: a restart keeps the phones, so a lost one
// would otherwise stay paired as long as the hub runs
const DEVICE_TTL = 7 * 24 * 3600_000
const MAX_PAIR_FAILS = 10
// the pairing code a phone shows and a terminal matches: letters and digits, none that look alike
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/]
if (!DIR) process.exit(2)

mkdirSync(DIR, { recursive: true, mode: 0o700 })
chmodSync(DIR, 0o700)
const SOCK = join(DIR, 'hub.sock')
// the mod's version this hub was started from, as the mod's modVersionShort writes it ("0.2.1 ·
// d0a0466"), and when that commit was made (ms; 0 outside a clone), so a session on newer code may
// restart it unasked
const [HUB_VERSION, HUB_VERSION_AT] = (() => {
  let version = '', commit = '', at = 0
  try { version = String(JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '') } catch {}
  try { [commit, at] = execFileSync('git', ['-C', HERE, 'log', '-1', '--format=%h %ct'], { encoding: 'utf8', timeout: 5000 }).trim().split(' ').map((v, i) => (i ? Number(v) * 1000 || 0 : v)) } catch {}
  return [[version, commit].filter(Boolean).join(' · '), at]
})()
const log = text => { try { writeFileSync(join(DIR, 'hub.log'), `${new Date().toISOString()} ${text}\n`, { flag: 'a' }) } catch {} }

// ---- what a restart keeps -----------------------------------------------------------------
// Asked to restart (POST /restart), a hub writes STATE_FILE and stops without stopping its tunnel;
// the hub started next takes over from it: the tunnel's address and the port it points at, K, the
// phones it allowed with their keys and recent nonces, their push subscriptions and the VAPID key
// those were made for. The phones reconnect in the seconds between and are never asked to scan.
// The file is read once and deleted; one older than KEPT_MS, or whose tunnel is gone, is not used
// (its tunnel, still running, is stopped).
const STATE_FILE = join(DIR, 'state.json')
const KEPT_MS = 10 * 60_000
const isCloudflared = pid => {
  try {
    process.kill(pid, 0)
    return /cloudflared/.test(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 }))
  } catch {
    return false
  }
}
const kept = (() => {
  let s
  try {
    s = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return null
  }
  rmSync(STATE_FILE, { force: true })
  const pid = Number(s?.tunnel?.pid)
  const isLive = pid > 0 && isCloudflared(pid)
  if (isLive && s.token && s.tunnel.url && s.port && Date.now() - Number(s.savedAt) < KEPT_MS) return s
  if (isLive) try { process.kill(pid, 'SIGTERM') } catch {}
  return null
})()
// a tunnel a hub left with no state (the hub killed outright): stopped, not left pointing nowhere
const TUNNEL_PID_FILE = join(DIR, 'tunnel.pid')
try {
  const stray = Number(readFileSync(TUNNEL_PID_FILE, 'utf8'))
  if (stray > 0 && stray !== Number(kept?.tunnel?.pid) && isCloudflared(stray)) process.kill(stray, 'SIGTERM')
} catch {}

// ---- state --------------------------------------------------------------------------------
const TOKEN = kept?.token ?? randomBytes(32).toString('base64url')
let tunnelUrl = ''
let tunnelError = ''
let version = 0 // moves on every change a phone should see
const sessions = new Map() // session id -> { snapshot, seenAt, inbox: string[] }
const subscriptions = new Map(kept?.subscriptions ?? []) // endpoint -> { sub, device }
const waiters = new Set() // long-poll responses waiting for the next version
let pairFails = 0
let notice = { title: 'Claude', body: 'Nothing yet.', at: 0, session: '' }
let lastPhoneAt = Date.now()
let lastSessionAt = Date.now()

const privateKey = kept?.vapid ? createPrivateKey({ key: kept.vapid, format: 'jwk' }) : generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
const jwk = privateKey.export({ format: 'jwk' })
const VAPID_PUBLIC = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url')

// ---- helpers ------------------------------------------------------------------------------

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const parts = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else parts.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}
const readJson = (req, limit) => readBody(req, limit).then(t => JSON.parse(t), () => undefined).catch(() => undefined)

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  if (res.headersSent) return
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra })
  res.end(data)
}

function run(argv, cwd) {
  return new Promise(resolve => {
    execFile(argv[0], argv.slice(1), { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 10_000 }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

// a short name for the phone, from its user agent
function deviceName(ua) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'a device'
  const app = /ClaudeRemote\//.test(ua) ? 'the app' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser'
  return `${os}, ${app}`
}

function bump() {
  version++
  for (const w of waiters) w()
  waiters.clear()
}

// what the phone sees: every live session, newest first, without the inboxes
function stateOf() {
  const list = [...sessions.entries()]
    .map(([id, s]) => ({ id, ...s.snapshot, queued: [...(s.snapshot.queued ?? []), ...s.inbox] }))
    .sort((a, b) => Number(b.busy) - Number(a.busy) || (b.lastAt ?? 0) - (a.lastAt ?? 0))
  return { version, sessions: list, notice }
}

// ---- Web Push: no payload; the service worker asks /api/notice when it wakes ---------------
function vapidJwt(audience) {
  const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const head = enc({ typ: 'JWT', alg: 'ES256' })
  const body = enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://github.com/nmquan2504/cc-mod-statusbar' })
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${head}.${body}.${sig}`
}
async function pushAll() {
  for (const [endpoint] of subscriptions) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { TTL: '300', Urgency: 'high', Authorization: `vapid t=${vapidJwt(new URL(endpoint).origin)}, k=${VAPID_PUBLIC}`, 'Content-Length': '0' },
      })
      if (r.status === 404 || r.status === 410) subscriptions.delete(endpoint)
    } catch {
      // the push service did not answer: the next notice tries again
    }
  }
}

// ---- the files a phone may see: those a session's snapshot lists, nothing else ------------
// A secret's diff is its content, so a locked path (SENSITIVE) gets none: `isLocked` says so.
async function diffOf(session, path) {
  const s = sessions.get(session)?.snapshot
  if (!s) return undefined
  const listed = (s.edited ?? []).some(f => f.path === path) || (s.changes ?? []).some(f => f.path === path)
  if (!listed || !s.cwd) return undefined
  if (SENSITIVE.test(path)) return { isLocked: true }
  const spec = isAbsolute(path) ? path : `:(top)${path}`
  const tracked = await run(['git', '-C', s.cwd, 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--', spec], s.cwd)
  if (tracked.trim()) return tracked
  // untracked, new, or outside a repository: the whole file as added lines
  const top = (await run(['git', '-C', s.cwd, 'rev-parse', '--show-toplevel'], s.cwd)).trim()
  const abs = isAbsolute(path) ? path : join(top || s.cwd, path)
  if (!existsSync(abs) || statSync(abs).size > 512 * 1024) return ''
  // a link to a secret: what it leads to is read below
  if (SENSITIVE.test(real(abs))) return { isLocked: true }
  return run(['git', 'diff', '--no-color', '--no-index', '--', '/dev/null', abs], s.cwd)
}
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
// a sound file the phone plays, sent whole as an image is; past AUDIO_MAX its size alone
const AUDIO_TYPES = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm' }
const AUDIO_MAX = 20 * 1024 * 1024

// ---- browsing a session's folders: its own, those added, and the files it holds in context ----
// The same paths the mod's file menu shows locked (hooks/lib/catalog.ts): the project's secrets and
// the credentials a home folder keeps, never shown on a phone, in the Folder tab or as a diff.
const SENSITIVE = /(^|\/)(\.env(\..*)?|\.envrc|secrets|exports|\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.config\/gcloud|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|tfvars|tfstate))(\/|$)/i
const SKIP_DIRS = new Set(['.git', 'node_modules', '.baseline'])
const TEXT_MAX = 512 * 1024
const real = p => { try { return realpathSync(p) } catch { return '' } }
const isUnder = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)

// Where a path may be opened from: the root it lies under (real paths both), or a file the session
// lists in context; undefined when neither. `rel` is what the secrets rule is tested on.
function placeOf(s, path) {
  const target = real(path)
  if (!target) return undefined
  for (const root of (s.roots ?? []).map(real).filter(Boolean))
    if (isUnder(target, root)) return { target, rel: relative(root, target).split(sep).join('/'), root }
  const c = s.context ?? {}
  const listed = [...(c.mentions ?? []), ...(c.reads ?? []), ...(c.memory ?? []).map(m => m.path)]
  if (listed.some(p => real(p) === target)) return { target, rel: target, root: '' }
  return undefined
}

async function treeOf(session, path) {
  const s = sessions.get(session)?.snapshot
  if (!s) return { status: 404, body: { error: 'That session is gone.' } }
  const place = placeOf(s, path)
  if (!place || !place.root) return { status: 403, body: { error: 'Outside the folders this session works in.' } }
  if (SENSITIVE.test(place.rel)) return { status: 403, body: { error: 'Locked: secrets are not shown on the phone.', isLocked: true } }
  let entries = []
  try {
    entries = readdirSync(place.target, { withFileTypes: true })
  } catch {
    return { status: 404, body: { error: 'Not a folder.' } }
  }
  const rows = []
  for (const d of entries.slice(0, 2000)) {
    if (SKIP_DIRS.has(d.name)) continue
    const abs = join(place.target, d.name)
    let st
    try { st = statSync(abs) } catch { continue }
    const relPath = place.rel ? `${place.rel}/${d.name}` : d.name
    // a link that leads out of the folder opens nothing
    const isOutside = d.isSymbolicLink() && !isUnder(real(abs), place.root)
    rows.push({ name: d.name, path: abs, isDir: st.isDirectory(), size: st.isFile() ? st.size : 0, isLocked: SENSITIVE.test(relPath) || isOutside })
  }
  rows.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  // a folder in a git repository: its branch, or the commit a detached HEAD stands on
  const branch = (await run(['git', '-C', place.target, 'symbolic-ref', '--short', '-q', 'HEAD'], place.target)).trim()
  const detached = branch ? '' : (await run(['git', '-C', place.target, 'rev-parse', '--short', 'HEAD'], place.target)).trim()
  return { status: 200, body: { path: place.target, root: place.root, rows, branch: branch || (detached && `detached at ${detached}`) } }
}

// The session's folders searched for `query` (2 to 200 characters, any case, as written): files
// whose path holds it, and lines that hold it, each folder through git where it is a repository (its
// ignored files left out) and through find and grep elsewhere (node_modules and .git left out).
// A locked path (SENSITIVE) is never in the results, by name or by line.
const SEARCH_NAMES = 50, SEARCH_HITS = 100
async function searchOf(session, query) {
  const s = sessions.get(session)?.snapshot
  if (!s) return { status: 404, body: { error: 'That session is gone.' } }
  const q = String(query ?? '').trim()
  if (q.length < 2 || q.length > 200) return { status: 400, body: { error: 'Search for 2 to 200 characters.' } }
  const low = q.toLowerCase()
  const names = [], hits = []
  let isCut = false
  for (const root of (s.roots ?? []).map(real).filter(Boolean).slice(0, 4)) {
    const isRepo = (await run(['git', '-C', root, 'rev-parse', '--is-inside-work-tree'], root)).trim() === 'true'
    const listed = isRepo
      ? await run(['git', '-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], root)
      : await run(['find', '.', '-type', 'f', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'], root)
    for (const line of listed.split('\n')) {
      const rel = line.replace(/^\.\//, '')
      if (!rel || SENSITIVE.test(rel) || !rel.toLowerCase().includes(low)) continue
      if (names.length >= SEARCH_NAMES) { isCut = true; break }
      names.push({ path: join(root, rel), rel })
    }
    const found = isRepo
      ? await run(['git', '-C', root, 'grep', '--untracked', '-n', '-I', '-i', '-F', '-e', q], root)
      : await run(['grep', '-r', '-n', '-I', '-i', '-F', '--exclude-dir=node_modules', '--exclude-dir=.git', '-e', q, '.'], root)
    for (const line of found.split('\n')) {
      const m = /^(?:\.\/)?([^:]+):(\d+):(.*)$/.exec(line)
      if (!m || SENSITIVE.test(m[1])) continue
      if (hits.length >= SEARCH_HITS) { isCut = true; break }
      hits.push({ path: join(root, m[1]), rel: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) })
    }
  }
  return { status: 200, body: { names, hits, isCut } }
}

function fileOf(session, path) {
  const s = sessions.get(session)?.snapshot
  if (!s) return { status: 404, body: { error: 'That session is gone.' } }
  const place = placeOf(s, path)
  if (!place) return { status: 403, body: { error: 'Outside the folders and the context of this session.' } }
  if (SENSITIVE.test(place.rel) || SENSITIVE.test(place.target)) return { status: 403, body: { error: 'Locked: secrets are not shown on the phone.', isLocked: true } }
  let st
  try { st = statSync(place.target) } catch { return { status: 404, body: { error: 'No such file.' } } }
  if (!st.isFile()) return { status: 400, body: { error: 'Not a file.' } }
  const ext = extname(place.target).toLowerCase()
  if (IMAGE_TYPES[ext]) return { status: 200, body: { kind: 'image', size: st.size, name: basename(place.target) }, image: { file: place.target, type: IMAGE_TYPES[ext] } }
  if (AUDIO_TYPES[ext]) {
    const isTooBig = st.size > AUDIO_MAX
    return { status: 200, body: { kind: 'audio', size: st.size, name: basename(place.target), isTooBig }, image: isTooBig ? undefined : { file: place.target, type: AUDIO_TYPES[ext] } }
  }
  // a file with a NUL byte in its first 8 KB is binary: its size alone
  const head = Buffer.alloc(Math.min(8192, st.size))
  const fd = openSync(place.target, 'r')
  try { readSync(fd, head, 0, head.length, 0) } finally { closeSync(fd) }
  if (head.includes(0)) return { status: 200, body: { kind: 'binary', size: st.size, name: basename(place.target) } }
  const buf = Buffer.alloc(Math.min(TEXT_MAX, st.size))
  const fd2 = openSync(place.target, 'r')
  try { readSync(fd2, buf, 0, buf.length, 0) } finally { closeSync(fd2) }
  return { status: 200, body: { kind: 'text', text: buf.toString('utf8'), size: st.size, isCut: st.size > TEXT_MAX, name: basename(place.target), ext: ext.slice(1) } }
}
// ---- ZeroTTS: the phone's Vietnamese voice, made on the Mac ----------------------------------
// zerotts-setup.sh (run by /zerotts-install) puts a Python and the model under TTS_HOME; tts.py,
// started the first time the phone asks, keeps the model loaded and answers a JSON line at a time.
// It stops after TTS_IDLE_MS unasked, and with the hub.
const TTS_HOME = process.env.QSB_TTS_HOME || join(homedir(), '.cache', 'cc-mod-statusbar', 'zerotts')
const TTS_IDLE_MS = 10 * 60_000
const tts = { proc: null, voices: [], isReady: false, waiting: new Map(), nextId: 1, timer: null, error: '' }
const ttsState = () =>
  existsSync(join(TTS_HOME, 'ready')) ? 'ready' : existsSync(join(TTS_HOME, 'failed')) ? 'failed' : existsSync(join(TTS_HOME, '.venv')) ? 'installing' : 'missing'
function stopTts() {
  if (tts.proc && tts.proc.exitCode === null) tts.proc.kill('SIGTERM')
  tts.proc = null
  tts.isReady = false
  for (const w of tts.waiting.values()) w({ error: 'The voice stopped.' })
  tts.waiting.clear()
}
function startTts() {
  if (tts.proc) return
  tts.error = ''
  const proc = spawn(join(TTS_HOME, '.venv', 'bin', 'python'), [join(HERE, 'tts.py'), join(TTS_HOME, 'model')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  tts.proc = proc
  let buf = ''
  proc.stdout.on('data', chunk => {
    buf += chunk
    for (let i; (i = buf.indexOf('\n')) >= 0; ) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let m
      try { m = JSON.parse(line) } catch { continue }
      if (m.ready) {
        tts.isReady = true
        tts.voices = m.voices ?? []
        for (const w of tts.waiting.values()) w.start?.()
      } else tts.waiting.get(m.id)?.(m)
    }
  })
  proc.stderr.on('data', chunk => { tts.error = String(chunk).trim().split('\n').pop().slice(0, 200) })
  proc.on('exit', code => {
    if (tts.proc === proc) {
      log(`tts stopped (${code})`)
      tts.proc = null
      tts.isReady = false
      for (const w of tts.waiting.values()) w({ error: tts.error || 'The voice stopped.' })
      tts.waiting.clear()
    }
  })
}
// One sentence as a WAV: { b64 } or { error }; the model loads first (some seconds) when it is not up
function speakTts(text, voice, lang = 'vi') {
  if (ttsState() !== 'ready') return Promise.resolve({ error: 'ZeroTTS is not installed on the Mac.' })
  startTts()
  clearTimeout(tts.timer)
  tts.timer = setTimeout(stopTts, TTS_IDLE_MS)
  tts.timer.unref?.()
  return new Promise(resolve => {
    const id = tts.nextId++
    const send = () => tts.proc?.stdin.write(`${JSON.stringify({ id, text, voice, lang })}\n`)
    const done = m => {
      tts.waiting.delete(id)
      resolve(m)
    }
    done.start = send
    tts.waiting.set(id, done)
    if (tts.isReady) send()
  })
}

function imageOf(session, n) {
  const row = (sessions.get(session)?.snapshot.images ?? []).find(i => String(i.n) === String(n))
  if (!row || !/\/images\/\d+\.(png|jpe?g|gif|webp)$/i.test(row.path) || !existsSync(row.path)) return undefined
  return { data: readFileSync(row.path), type: IMAGE_TYPES[extname(row.path).toLowerCase()] }
}

// ---- end-to-end encryption: Cloudflare carries the tunnel and ends its TLS, so every request
// and answer is sealed between the phone and this hub (e2e.js holds the phone's half) ---------
const subtle = globalThis.crypto.subtle
const te = new TextEncoder(), td = new TextDecoder()
const ROOT = Buffer.from(TOKEN, 'base64url') // K, in the QR link's #fragment; it never crosses the wire
// `isExtractable`: a phone's key, which a restart writes to STATE_FILE
async function hkdf(ikm, salt, info, usage, isExtractable = false) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  const algo = usage === 'hmac' ? { name: 'HMAC', hash: 'SHA-256', length: 256 } : { name: 'AES-GCM', length: 256 }
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, base, algo, isExtractable, usage === 'hmac' ? ['sign', 'verify'] : ['encrypt', 'decrypt'])
}
const AUTH = await hkdf(ROOT, new Uint8Array(0), 'qsb/auth', 'hmac')
const b64 = buf => Buffer.from(buf).toString('base64url')
const unb64 = str => new Uint8Array(Buffer.from(String(str), 'base64url'))
const CLOCK_SKEW = 120_000

// each phone: its key, from an ECDH with this hub salted with K; allowed or not by a terminal
const devices = new Map() // id -> { key, raw, name, at, seenAt, code, isApproved, isDenied, nonces: Map<n, ts> }
// the phones the hub before allowed, as it wrote them
for (const d of (kept?.devices ?? []).filter(x => Date.now() - x.seenAt < DEVICE_TTL)) {
  const key = await subtle.importKey('raw', unb64(d.raw), 'AES-GCM', false, ['encrypt', 'decrypt']).catch(() => undefined)
  if (key) devices.set(d.id, { key, raw: d.raw, name: d.name, at: d.at, seenAt: d.seenAt, code: '', isApproved: true, isDenied: false, nonces: new Map(d.nonces ?? []) })
}
// A request to pair waits a minute for Allow in a terminal; then it is gone, and the phone scans again.
const PAIR_MS = Number(process.env.QSB_PAIR_MS) || 60_000 // tests shorten it
const isExpired = d => !d.isApproved && Date.now() - d.at >= PAIR_MS
const secondsLeft = d => Math.max(0, Math.ceil((d.at + PAIR_MS - Date.now()) / 1000))

async function seal(dev, id, n, s, b) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const c = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`res|${id}|${n}`) }, dev.key, te.encode(JSON.stringify({ s, b })))
  return { iv: b64(iv), c: b64(c) }
}

// the next version, or POLL_WAIT, or the phone hanging up (a long poll: quick tunnels carry no
// server-sent events)
// (`res`, not `req`: a request reads as closed once its body is read)
function nextVersion(since, res) {
  if (since !== version) return Promise.resolve()
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(t)
      waiters.delete(done)
      res.off('close', done) // a watch waits again and again on the same response
      resolve()
    }
    const t = setTimeout(done, POLL_WAIT)
    waiters.add(done)
    res.on('close', done)
  })
}

// A phone unpaired: its key and its push subscriptions gone
function dropDevice(id) {
  devices.delete(id)
  dropPush(id)
}
const dropPush = id => { for (const [endpoint, v] of subscriptions) if (v.device === id) subscriptions.delete(endpoint) }
// at most MAX_DEVICES phones stay paired: the oldest goes
function keepNewest() {
  const paired = [...devices.entries()].filter(([, x]) => x.isApproved).sort((x, y) => x[1].at - y[1].at)
  while (paired.length > MAX_DEVICES) devices.delete(paired.shift()[0])
}

// A paired browser hands this hub to the Android app on the same phone: a ticket, with K, sealed
// to the browser, which gives both to the app; the app's /hello with it needs no Allow in a
// terminal, once, within two minutes. The browser stays paired, its notifications left to the app.
const HANDOFF_MS = 120_000
const handoffs = new Map() // ticket -> { from: the browser's device id, at }
function takeHandoff(ticket) {
  const h = ticket ? handoffs.get(ticket) : undefined
  handoffs.delete(ticket)
  return h && Date.now() - h.at <= HANDOFF_MS && devices.get(h.from)?.isApproved ? h : undefined
}

// One sealed call from an allowed phone: what it asks, answered as [status, body].
async function answerOp(dev, id, op, a, res) {
  const session = String(a.session ?? '')
  switch (op) {
    case 'state':
      await nextVersion(Number(a.since ?? -1), res)
      return [200, stateOf()]
    // the Android app's background service: waits for the next notice alone, a few hundred bytes
    // rather than every session's state, so a phone in a pocket spends little on it
    case 'watch': {
      const since = Number(a.since ?? 0)
      const until = Date.now() + POLL_WAIT
      while (notice.at <= since && Date.now() < until && !res.destroyed && !isShuttingDown) await nextVersion(version, res)
      const from = sessions.get(notice.session)?.snapshot
      return [200, { notice, folder: from?.folder ?? '', title: from?.title ?? '' }]
    }
    // a queued text taken back: gone from the inbox if the session has not taken it yet, else held
    // for the session, which drops it from its own queue at its next call
    case 'unqueue': {
      const s = sessions.get(session)
      const text = typeof a.text === 'string' ? a.text.trim().slice(0, 8000) : ''
      if (!s || !text) return [400, { error: text ? 'That session is gone.' : 'empty' }]
      const at = s.inbox.indexOf(text)
      if (at >= 0) s.inbox.splice(at, 1)
      else s.unqueue = [...(s.unqueue ?? []), text].slice(-20)
      bump()
      return [200, { ok: true }]
    }
    // Load earlier: the session sends more of its turns at its next call
    case 'earlier': {
      const s = sessions.get(session)
      if (!s) return [400, { error: 'That session is gone.' }]
      s.earlier = true
      return [200, { ok: true }]
    }
    // Stop: the session ends its running turn at its next call
    case 'stop': {
      const s = sessions.get(session)
      if (!s) return [400, { error: 'That session is gone.' }]
      s.stop = true
      return [200, { ok: true }]
    }
    case 'reply': {
      const text = typeof a.text === 'string' ? a.text.trim().slice(0, 8000) : ''
      const s = sessions.get(session)
      if (!text || !s) return [400, { error: text ? 'That session is gone.' : 'empty' }]
      s.inbox.push(text)
      bump()
      return [200, { ok: true, queued: Boolean(s.snapshot.busy) }]
    }
    // the answer to the question Claude waits on; the session takes it at its next call
    case 'answer': {
      const s = sessions.get(session)
      const askId = String(a.id ?? '')
      if (!s || !s.snapshot.ask || s.snapshot.ask.id !== askId) return [409, { error: 'That question is already answered.' }]
      const answers = {}
      for (const [q, v] of Object.entries(a.answers ?? {})) if (typeof v === 'string') answers[String(q).slice(0, 2000)] = v.slice(0, 4000)
      s.answer = { id: askId, answers, isDismissed: a.isDismissed === true }
      bump()
      return [200, { ok: true }]
    }
    // a secret typed on the phone: held for the session to take into the keychain, never logged,
    // never in a snapshot; the session's next snapshot says what came of it
    case 'secret': {
      const s = sessions.get(session)
      const value = typeof a.value === 'string' ? a.value.trim().slice(0, 4096) : ''
      if (!s || !value) return [400, { error: value ? 'That session is gone.' : 'empty' }]
      const pick = k => (typeof a[k] === 'string' ? a[k].trim().slice(0, 200) : '')
      s.secrets = [...(s.secrets ?? []), { value, name: pick('name'), host: pick('host'), header: pick('header') }].slice(-5)
      return [200, { ok: true }]
    }
    // a page the phone opened (a panel's command, drawn on the phone), or a press on one: held for
    // the session, which builds the page and sends it in its next snapshot
    case 'page': {
      const s = sessions.get(session)
      const cmd = String(a.cmd ?? '')
      if (!s) return [400, { error: 'That session is gone.' }]
      if (!PAGES.has(cmd)) return [400, { error: 'Not a page.' }]
      const ask = { cmd }
      if (typeof a.key === 'string') {
        ask.key = a.key.slice(0, 400)
        ask.value = typeof a.value === 'boolean' || typeof a.value === 'number' ? a.value : typeof a.value === 'string' ? a.value.slice(0, 2000) : undefined
      }
      s.pages = [...(s.pages ?? []), ask].slice(-10)
      return [200, { ok: true }]
    }
    case 'diff': {
      const diff = await diffOf(session, String(a.path ?? ''))
      if (diff === undefined) return [404, { error: 'Not a file of this session.' }]
      return typeof diff === 'string' ? [200, { diff }] : [403, { error: 'Locked: secrets are not shown on the phone.', isLocked: true }]
    }
    case 'image': {
      const img = imageOf(session, String(a.n ?? ''))
      return img ? [200, { type: img.type, b64: img.data.toString('base64') }] : [404, { error: 'no such image' }]
    }
    case 'search': {
      const r = await searchOf(session, a.query)
      return [r.status, r.body]
    }
    case 'tree': {
      const r = await treeOf(session, String(a.path ?? ''))
      return [r.status, r.body]
    }
    case 'file': {
      const r = fileOf(session, String(a.path ?? ''))
      if (r.image && a.raw) return [200, { type: r.image.type, b64: readFileSync(r.image.file).toString('base64') }]
      return [r.status, r.body]
    }
    case 'ttsinfo':
      // asked with warm by a phone that reads with ZeroTTS: the model loads now, not at the first piece
      if (a.warm && ttsState() === 'ready') {
        startTts()
        clearTimeout(tts.timer)
        tts.timer = setTimeout(stopTts, TTS_IDLE_MS)
        tts.timer.unref?.()
      }
      return [200, { state: ttsState(), voices: tts.voices.length ? tts.voices : ['baotrang', 'giahuy', 'hamy', 'huuduc', 'kimoanh', 'maichi', 'quangminh', 'tiendat'] }]
    case 'tts': {
      const text = String(a.text ?? '').slice(0, 2000)
      if (!text.trim()) return [400, { error: 'No text.' }]
      const r = await speakTts(text, String(a.voice ?? ''), a.lang === 'en' ? 'en' : 'vi')
      return r.b64 ? [200, { type: 'audio/wav', b64: r.b64 }] : [503, { error: r.error || 'The voice did not answer.' }]
    }
    case 'vapid':
      return [200, { key: VAPID_PUBLIC }]
    case 'subscribe': {
      const endpoint = String(a.sub?.endpoint ?? '')
      let host = ''
      try {
        const u = new URL(endpoint)
        host = u.protocol === 'https:' ? u.hostname : ''
      } catch {}
      if (!PUSH_HOSTS.some(re => re.test(host))) return [400, { error: 'not a known push service' }]
      subscriptions.set(endpoint, { sub: a.sub, device: id })
      while (subscriptions.size > MAX_DEVICES) subscriptions.delete(subscriptions.keys().next().value)
      return [200, { ok: true }]
    }
    case 'notice':
      return [200, notice]
    case 'handoff': {
      for (const [t, h] of handoffs) if (Date.now() - h.at > HANDOFF_MS) handoffs.delete(t)
      const ticket = randomBytes(18).toString('base64url')
      handoffs.set(ticket, { from: id, at: Date.now() })
      return [200, { ticket, k: TOKEN }]
    }
    case 'forget':
      dropDevice(id)
      return [200, { ok: true }]
    // the phones this hub allowed, for Settings: this one marked
    case 'devices': {
      const pushed = new Set([...subscriptions.values()].map(v => v.device))
      return [200, { devices: [...devices.entries()].filter(([, d]) => d.isApproved).map(([did, d]) => ({ id: did, name: d.name, at: d.at, seenAt: d.seenAt, isThis: did === id, hasPush: pushed.has(did) })) }]
    }
    // another phone's notifications off, its pairing kept: the app just paired turns off the
    // browser it replaces, so a notice comes once
    case 'push-off': {
      const other = String(a.id ?? '')
      if (!other || other === id || !devices.get(other)?.isApproved) return [404, { error: 'No such phone.' }]
      dropPush(other)
      log(`notifications off for a phone: ${other.slice(0, 6)}`)
      return [200, { ok: true }]
    }
    // another phone unpaired from this one (this one unpairs itself with forget)
    case 'unpair': {
      const other = String(a.id ?? '')
      if (!other || other === id || !devices.get(other)?.isApproved) return [404, { error: 'No such phone.' }]
      dropDevice(other)
      log(`unpaired from a phone: ${other.slice(0, 6)}`)
      bump()
      return [200, { ok: true }]
    }
    default:
      return [404, { error: 'not found' }]
  }
}

// ---- the public server, reached through the tunnel ----------------------------------------
const STATIC = {
  '/': ['app.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/e2e.js': ['e2e.js', 'text/javascript; charset=utf-8'],
  '/lineask.mjs': ['lineask.mjs', 'text/javascript; charset=utf-8'],
  '/speak.mjs': ['speak.mjs', 'text/javascript; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/vendor/highlight.min.js': ['vendor/highlight.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/hljs-dark.css': ['vendor/hljs-dark.css', 'text/css; charset=utf-8'],
  '/vendor/hljs-light.css': ['vendor/hljs-light.css', 'text/css; charset=utf-8'],
}
const MANIFEST = { name: 'Claude remote', short_name: 'Claude', start_url: '/', display: 'standalone', background_color: '#1a1a18', theme_color: '#1a1a18', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] }

const pub = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const route = `${req.method} ${url.pathname}`
    const file = STATIC[url.pathname]
    if (req.method === 'GET' && file) return send(res, 200, readFileSync(join(HERE, file[0])), file[1], url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
    if (route === 'GET /manifest.webmanifest') return send(res, 200, MANIFEST, 'application/manifest+json')

    // pairing: the phone shows it holds K (an HMAC, K itself never sent), the hub answers with its
    // half of the ECDH and an HMAC of its own; the phone then waits for Allow in a terminal
    if (route === 'POST /hello') {
      if (pairFails >= MAX_PAIR_FAILS) return send(res, 423, { error: 'Pairing is locked after too many wrong links. Stop and start the remote again.' })
      const body = await readJson(req)
      const phonePub = String(body?.pub ?? '')
      const isK = phonePub && (await subtle.verify('HMAC', AUTH, unb64(body?.mac ?? ''), te.encode(`hello|${phonePub}`)).catch(() => false))
      if (!isK) {
        pairFails++
        return send(res, 403, { error: 'This link is not the one the terminal shows now. Scan the QR code again.' })
      }
      let theirs
      try {
        theirs = await subtle.importKey('raw', unb64(phonePub), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      } catch {
        return send(res, 400, { error: 'bad key' })
      }
      const mine = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
      const hubPub = b64(await subtle.exportKey('raw', mine.publicKey))
      const secret = await subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256)
      const key = await hkdf(secret, ROOT, `qsb/device|${phonePub}|${hubPub}`, 'aes', true)
      const raw = b64(await subtle.exportKey('raw', key))
      const id = randomBytes(16).toString('base64url')
      const code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
      for (const [k, d] of devices) if (isExpired(d)) devices.delete(k)
      const handoff = takeHandoff(String(body?.ticket ?? ''))
      devices.set(id, { key, raw, name: deviceName(String(req.headers['user-agent'] ?? '')), at: Date.now(), seenAt: Date.now(), code, isApproved: Boolean(handoff), isDenied: false, nonces: new Map() })
      if (handoff) {
        keepNewest()
        dropPush(handoff.from)
      }
      const mac = b64(await subtle.sign('HMAC', AUTH, te.encode(`welcome|${id}|${hubPub}|${phonePub}|${code}`)))
      bump()
      log(handoff ? 'paired: the app, handed over from its browser' : `pair asked: ${code}`)
      return send(res, 200, { id, pub: hubPub, code, mac })
    }

    // every other call: sealed with the phone's key, fresh (its time within two minutes), and
    // never seen before (its nonce); the answer is sealed to that nonce
    if (route === 'POST /x') {
      const body = await readJson(req)
      const id = String(body?.d ?? '')
      const dev = devices.get(id)
      if (!dev) return send(res, 401, { error: 'Not paired. Scan the QR code in the terminal again.' })
      let call
      try {
        const open = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(body.iv), additionalData: te.encode(`req|${id}`) }, dev.key, unb64(body.c))
        call = JSON.parse(td.decode(open))
      } catch {
        return send(res, 400, { error: 'unreadable' })
      }
      const now = Date.now()
      const n = String(call?.n ?? '')
      if (!n || Math.abs(now - Number(call.ts)) > CLOCK_SKEW) return send(res, 400, { error: 'stale' })
      for (const [k, t] of dev.nonces) if (now - t > 2 * CLOCK_SKEW) dev.nonces.delete(k)
      if (dev.nonces.has(n)) return send(res, 409, { error: 'replayed' })
      dev.nonces.set(n, now)
      const op = String(call.op ?? ''), a = call.a && typeof call.a === 'object' ? call.a : {}
      if (dev.isDenied) {
        devices.delete(id)
        return send(res, 200, await seal(dev, id, n, 403, { error: 'Refused in the terminal.' }))
      }
      if (isExpired(dev)) {
        devices.delete(id)
        bump()
        return send(res, 200, await seal(dev, id, n, 403, { error: 'Nobody allowed this phone within a minute. Scan the QR code again.', isExpired: true }))
      }
      if (!dev.isApproved) return send(res, 200, await seal(dev, id, n, op === 'paired' ? 202 : 403, { code: dev.code, secondsLeft: secondsLeft(dev) }))
      dev.seenAt = lastPhoneAt = now
      if (op === 'paired') return send(res, 200, await seal(dev, id, n, 200, { ok: true }))
      const [s, b] = await answerOp(dev, id, op, a, res)
      // the phone hung up while the long poll waited
      if (res.writableEnded || res.destroyed) return
      return send(res, 200, await seal(dev, id, n, s, b))
    }
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: 'server error' })
    log(String(err?.stack ?? err))
  }
})

// ---- the control socket, for the mods alone -----------------------------------------------
function statusOf() {
  return {
    pid: process.pid,
    version: HUB_VERSION,
    versionAt: HUB_VERSION_AT,
    url: tunnelUrl,
    link: tunnelUrl ? `${tunnelUrl}/#k=${TOKEN}` : '',
    error: tunnelError,
    sessions: sessions.size,
    devices: [...devices.values()].filter(d => d.isApproved).map(d => ({ name: d.name, seenAt: d.seenAt })),
    pending: [...devices.entries()].filter(([, d]) => !d.isApproved && !d.isDenied && !isExpired(d)).map(([id, d]) => ({ id, code: d.code, name: d.name, at: d.at, expiresAt: d.at + PAIR_MS })),
    phones: Date.now() - lastPhoneAt < 40_000 ? [...devices.values()].filter(d => d.isApproved && Date.now() - d.seenAt < 40_000).length : 0,
    isLocked: pairFails >= MAX_PAIR_FAILS,
    // a restart (POST /restart) keeps the address and the paired phones
    canHandOver: true,
    tts: { state: ttsState(), isLoaded: tts.isReady },
    subscriptions: subscriptions.size,
  }
}

const ctl = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const route = `${req.method} ${url.pathname}`
  const id = url.searchParams.get('id') ?? ''
  if (route === 'POST /session') {
    const body = await readJson(req, MAX_SNAPSHOT)
    if (!body || !id) return send(res, 400, { error: 'bad snapshot' })
    const s = sessions.get(id) ?? { inbox: [], snapshot: {}, seenAt: 0, text: '' }
    idleMs = idleMsOf(url.searchParams.get('idle'), idleMs)
    const text = JSON.stringify(body)
    s.seenAt = lastSessionAt = Date.now()
    if (text !== s.text) {
      s.text = text
      s.snapshot = body
      sessions.set(id, s)
      bump()
    } else sessions.set(id, s)
    return send(res, 200, statusOf())
  }
  if (route === 'GET /inbox') {
    const s = sessions.get(id)
    const texts = s ? s.inbox.splice(0) : []
    const answer = s?.answer
    const secrets = s?.secrets ?? []
    const pages = s?.pages ?? []
    const stop = s?.stop === true
    const earlier = s?.earlier === true
    const unqueue = s?.unqueue ?? []
    if (s) {
      delete s.answer
      delete s.secrets
      delete s.pages
      delete s.stop
      delete s.earlier
      delete s.unqueue
    }
    // the texts stay on the phone as sent until the session's next snapshot says where they are
    if (texts.length) {
      s.snapshot = { ...s.snapshot, sending: [...(s.snapshot.sending ?? []), ...texts] }
      s.text = ''
      bump()
    }
    return send(res, 200, { texts, answer, secrets, pages, stop, unqueue, earlier })
  }
  // /zerotts-install, the install done: the voice loaded now, so the first piece does not wait
  if (route === 'POST /tts-warm') {
    if (ttsState() === 'ready') {
      startTts()
      clearTimeout(tts.timer)
      tts.timer = setTimeout(stopTts, TTS_IDLE_MS)
      tts.timer.unref?.()
      for (let i = 0; i < 60 && tts.proc && !tts.isReady; i++) await new Promise(r => setTimeout(r, 250))
    }
    return send(res, 200, { state: ttsState(), isLoaded: tts.isReady, voices: tts.voices, error: tts.error })
  }
  // /zerotts-uninstall: the voice stopped before its folder goes
  if (route === 'POST /tts-stop') {
    stopTts()
    return send(res, 200, { ok: true })
  }
  if (route === 'POST /bye') {
    if (sessions.delete(id)) bump()
    return send(res, 200, { ok: true })
  }
  if (route === 'POST /notify') {
    const body = await readJson(req)
    notice = { title: String(body?.title ?? 'Claude').slice(0, 80), body: String(body?.body ?? '').slice(0, 300), at: Date.now(), session: id }
    bump()
    void pushAll()
    return send(res, 200, { ok: true, subscriptions: subscriptions.size })
  }
  if (route === 'POST /allow' || route === 'POST /deny') {
    const d = devices.get(String((await readJson(req))?.id ?? ''))
    if (!d || d.isApproved) return send(res, 404, { error: 'no such request' })
    // allowed too late: the phone was told to scan again
    if (isExpired(d)) return send(res, 410, { error: 'expired', ...statusOf() })
    if (route === 'POST /allow') {
      d.isApproved = true
      keepNewest()
    } else d.isDenied = true
    return send(res, 200, statusOf())
  }
  if (route === 'POST /forget-devices') {
    devices.clear()
    subscriptions.clear()
    bump()
    return send(res, 200, statusOf())
  }
  if (route === 'GET /status') return send(res, 200, statusOf())
  if (route === 'POST /stop') {
    send(res, 200, { ok: true })
    return shutdown(0)
  }
  // stop for a hub started next to take over: the tunnel left running, what it needs written down
  if (route === 'POST /restart') {
    send(res, 200, { ok: true, isHandOver: Boolean(tunnelUrl) })
    return shutdown(0, Boolean(tunnelUrl))
  }
  send(res, 404, { error: 'not found' })
})

// ---- the tunnel ---------------------------------------------------------------------------
let tunnel
let tunnelSeen = ''
// A new quick-tunnel name takes some seconds to resolve, and a phone that asks too early keeps
// the miss in its DNS cache: the link shows once the name resolves, and a few seconds more.
// It is asked of trycloudflare.com's own name servers, which keep no miss: a public resolver
// asked too early keeps the miss for the zone's negative TTL, 60 s, and the wait grew to a minute.
// With those servers out of reach, Cloudflare's public resolver is asked instead.
async function zoneServers() {
  try {
    const r = new Resolver({ timeout: 3000, tries: 1 })
    const names = await r.resolveNs('trycloudflare.com')
    return (await Promise.all(names.map(n => r.resolve4(n).catch(() => [])))).flat()
  } catch {
    return []
  }
}
async function isResolvable(host, servers) {
  if (servers.length) {
    const r = new Resolver({ timeout: 2000, tries: 1 })
    r.setServers(servers)
    return r.resolve4(host).then(a => a.length > 0, () => false)
  }
  const r = await fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, { headers: { accept: 'application/dns-json' } }).catch(() => undefined)
  const body = await r?.json().catch(() => undefined)
  return Array.isArray(body?.Answer) && body.Answer.length > 0
}
async function whenResolvable(url) {
  const host = new URL(url).hostname
  const servers = await zoneServers()
  const startedAt = Date.now()
  for (let i = 0; i < 90 && !isShuttingDown; i++) {
    if (await isResolvable(host, servers)) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  await new Promise(resolve => setTimeout(resolve, 3000))
  tunnelUrl = url
  log(`tunnel ready ${url} (the name resolved after ${Math.round((Date.now() - startedAt) / 1000) - 3} s, asked of ${servers.length ? `the zone's ${servers.length} name servers` : '1.1.1.1'})`)
}
function findCloudflared() {
  for (const d of [...String(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'])
    if (d && existsSync(join(d, 'cloudflared'))) return join(d, 'cloudflared')
  return ''
}
// cloudflared runs detached, writing to tunnel.log rather than to this hub's pipes, so it outlives a
// hub that restarts; the hub reads its address from the log, and watches its pid, adopted or not
let tunnelPid = 0
function startTunnel(port) {
  if (process.env.QSB_REMOTE_LOCAL) return void (tunnelUrl = `http://127.0.0.1:${port}`) // tests: no tunnel
  const bin = findCloudflared()
  // the mod looks before it starts a hub; one started anyway stops rather than run with no tunnel
  if (!bin) {
    tunnelError = 'cloudflared is not installed: brew install cloudflared'
    log(tunnelError)
    return shutdown(3)
  }
  const logFile = join(DIR, 'tunnel.log')
  const out = openSync(logFile, 'w', 0o600)
  tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { detached: true, stdio: ['ignore', out, out] })
  closeSync(out)
  tunnel.unref()
  tunnelPid = tunnel.pid
  writeFileSync(TUNNEL_PID_FILE, String(tunnelPid), { mode: 0o600 })
  const scan = setInterval(() => {
    let text = ''
    try { text = readFileSync(logFile, 'utf8') } catch {}
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)
    if (!m || tunnelSeen) return
    clearInterval(scan)
    tunnelSeen = m[0]
    log(`tunnel ${tunnelSeen}, waiting for its name to resolve`)
    void whenResolvable(tunnelSeen)
  }, 300)
  scan.unref()
  watchTunnel()
}
// the tunnel gone (killed, crashed): the hub stops, as it always has
function watchTunnel() {
  setInterval(() => {
    if (isShuttingDown || !tunnelPid) return
    try {
      process.kill(tunnelPid, 0)
    } catch {
      tunnelError = 'the tunnel stopped'
      log(tunnelError)
      tunnelPid = 0
      shutdown(1)
    }
  }, 2000).unref()
}
// what the hub started next needs to take over (POST /restart)
function writeState() {
  const state = {
    savedAt: Date.now(),
    token: TOKEN,
    port: pub.address()?.port,
    tunnel: { pid: tunnelPid, url: tunnelUrl },
    vapid: privateKey.export({ format: 'jwk' }),
    devices: [...devices.entries()].filter(([, d]) => d.isApproved && d.raw).map(([id, d]) => ({ id, raw: d.raw, name: d.name, at: d.at, seenAt: d.seenAt, nonces: [...d.nonces] })),
    subscriptions: [...subscriptions.entries()],
  }
  writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 })
  chmodSync(STATE_FILE, 0o600)
}

let isShuttingDown = false
// `isHandOver`: the tunnel stays and STATE_FILE says what the hub started next takes over; else
// the tunnel stops with the hub and nothing is kept
function shutdown(code = 0, isHandOver = false) {
  if (isShuttingDown) return
  isShuttingDown = true
  log(`stopping (${code})${isHandOver ? ', the tunnel kept for the next hub' : ''}`)
  for (const w of waiters) w()
  stopTts()
  if (isHandOver) {
    try {
      writeState()
    } catch (err) {
      log(`could not write the state: ${err}`)
      isHandOver = false
    }
  }
  isHandedOver = isHandOver
  if (!isHandOver) {
    rmSync(STATE_FILE, { force: true })
    if (tunnelPid) try { process.kill(tunnelPid, 'SIGTERM') } catch {}
  }
  pub.close()
  ctl.close()
  rmSync(SOCK, { force: true })
  setTimeout(() => process.exit(code), 300).unref()
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(0))
// however the hub ends (an error it did not catch, among others), its tunnel ends with it unless
// handed over
let isHandedOver = false
process.on('exit', () => {
  if (!isHandedOver && tunnelPid) try { process.kill(tunnelPid, 'SIGTERM') } catch {}
})
process.on('uncaughtException', err => {
  log(String(err?.stack ?? err))
  shutdown(1)
})
process.on('SIGHUP', () => undefined) // started detached: a closed terminal is no reason to stop

// sessions that stopped calling in are dropped; with none for two minutes, or no phone for the
// idle time, the hub stops and the link with it
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) if (now - s.seenAt > 15_000) { sessions.delete(id); bump() }
  for (const [id, d] of devices) if (d.isApproved && now - d.seenAt > DEVICE_TTL) { dropDevice(id); log(`unpaired, not seen for a week: ${d.name}`) }
  if (now - lastSessionAt > SESSION_TTL) return shutdown(0)
  if (now - lastPhoneAt > idleMs) shutdown(0)
}, 5_000).unref()

// a hub already answering on the socket keeps it: two sessions may start one at the same moment
const probe = connect(SOCK)
probe.on('connect', () => {
  probe.end()
  process.exit(0)
})
probe.on('error', () => {
  rmSync(SOCK, { force: true })
  ctl.listen(SOCK, listening)
})
function listening() {
  chmodSync(SOCK, 0o600)
  // taking over: the port the tunnel points at; taken meanwhile, a port and a tunnel of its own
  if (kept) {
    pub.once('error', err => {
      log(`port ${kept.port} not free (${err.code}): a new tunnel`)
      try { process.kill(Number(kept.tunnel.pid), 'SIGTERM') } catch {}
      pub.listen(0, '127.0.0.1', () => {
        log(`hub ${process.pid} on 127.0.0.1:${pub.address().port}`)
        startTunnel(pub.address().port)
      })
    })
    pub.listen(kept.port, '127.0.0.1', () => {
      tunnelPid = Number(kept.tunnel.pid)
      tunnelUrl = kept.tunnel.url
      writeFileSync(TUNNEL_PID_FILE, String(tunnelPid), { mode: 0o600 })
      log(`hub ${process.pid} on 127.0.0.1:${kept.port}, taking over ${tunnelUrl} with ${devices.size} phone(s)`)
      watchTunnel()
    })
    return
  }
  pub.listen(0, '127.0.0.1', () => {
    log(`hub ${process.pid} on 127.0.0.1:${pub.address().port}`)
    startTunnel(pub.address().port)
  })
}
