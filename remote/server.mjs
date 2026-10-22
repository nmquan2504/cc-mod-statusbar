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
// the person presses Allow in a terminal. Cloudflare sees sizes and times, never content. Started detached by
// the first mod (`node server.mjs <dir> <idleMinutes>`); it stops itself when no session has
// called in for two minutes, or no phone has for idleMinutes. Node 18 or newer; no packages.
import { execFile, spawn } from 'node:child_process'
import { generateKeyPairSync, randomBytes, randomInt, sign } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2]
const IDLE_MS = Math.max(5, Number(process.argv[3]) || 30) * 60_000
const SESSION_TTL = 120_000
const POLL_WAIT = 25_000
// a phone's request is small; a session's snapshot carries its transcript
const MAX_BODY = 64 * 1024
const MAX_SNAPSHOT = 4 * 1024 * 1024
const MAX_DEVICES = 5
const MAX_PAIR_FAILS = 10
// the pairing code a phone shows and a terminal matches: letters and digits, none that look alike
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/]
if (!DIR) process.exit(2)

mkdirSync(DIR, { recursive: true, mode: 0o700 })
chmodSync(DIR, 0o700)
const SOCK = join(DIR, 'hub.sock')
const log = text => { try { writeFileSync(join(DIR, 'hub.log'), `${new Date().toISOString()} ${text}\n`, { flag: 'a' }) } catch {} }

// ---- state --------------------------------------------------------------------------------
const TOKEN = randomBytes(32).toString('base64url')
let tunnelUrl = ''
let tunnelError = ''
let version = 0 // moves on every change a phone should see
const sessions = new Map() // session id -> { snapshot, seenAt, inbox: string[] }
const subscriptions = new Map() // endpoint -> { sub, device }
const waiters = new Set() // long-poll responses waiting for the next version
let pairFails = 0
let notice = { title: 'Claude', body: 'Nothing yet.', at: 0, session: '' }
let lastPhoneAt = Date.now()
let lastSessionAt = Date.now()

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
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
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
  const app = /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser'
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
async function diffOf(session, path) {
  const s = sessions.get(session)?.snapshot
  if (!s) return undefined
  const listed = (s.edited ?? []).some(f => f.path === path) || (s.changes ?? []).some(f => f.path === path)
  if (!listed || !s.cwd) return undefined
  const spec = isAbsolute(path) ? path : `:(top)${path}`
  const tracked = await run(['git', '-C', s.cwd, 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--', spec], s.cwd)
  if (tracked.trim()) return tracked
  // untracked, new, or outside a repository: the whole file as added lines
  const top = (await run(['git', '-C', s.cwd, 'rev-parse', '--show-toplevel'], s.cwd)).trim()
  const abs = isAbsolute(path) ? path : join(top || s.cwd, path)
  if (!existsSync(abs) || statSync(abs).size > 512 * 1024) return ''
  return run(['git', 'diff', '--no-color', '--no-index', '--', '/dev/null', abs], s.cwd)
}
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

// ---- browsing a session's folders: its own, those added, and the files it holds in context ----
// The same paths the mod's file menu shows locked: the project's secrets, never shown on a phone.
const SENSITIVE = /(^|\/)(\.env(\..*)?|secrets|exports|id_(rsa|ed25519)[^/]*|[^/]*\.(pem|key|p12))(\/|$)/i
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

function treeOf(session, path) {
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
  return { status: 200, body: { path: place.target, root: place.root, rows } }
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
async function hkdf(ikm, salt, info, usage) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  const algo = usage === 'hmac' ? { name: 'HMAC', hash: 'SHA-256', length: 256 } : { name: 'AES-GCM', length: 256 }
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, base, algo, false, usage === 'hmac' ? ['sign', 'verify'] : ['encrypt', 'decrypt'])
}
const AUTH = await hkdf(ROOT, new Uint8Array(0), 'qsb/auth', 'hmac')
const b64 = buf => Buffer.from(buf).toString('base64url')
const unb64 = str => new Uint8Array(Buffer.from(String(str), 'base64url'))
const CLOCK_SKEW = 120_000

// each phone: its key, from an ECDH with this hub salted with K; allowed or not by a terminal
const devices = new Map() // id -> { key, name, at, seenAt, code, isApproved, isDenied, nonces: Map<n, ts> }

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
      resolve()
    }
    const t = setTimeout(done, POLL_WAIT)
    waiters.add(done)
    res.on('close', done)
  })
}

// One sealed call from an allowed phone: what it asks, answered as [status, body].
async function answerOp(dev, id, op, a, res) {
  const session = String(a.session ?? '')
  switch (op) {
    case 'state':
      await nextVersion(Number(a.since ?? -1), res)
      return [200, stateOf()]
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
    case 'diff': {
      const diff = await diffOf(session, String(a.path ?? ''))
      return diff === undefined ? [404, { error: 'Not a file of this session.' }] : [200, { diff }]
    }
    case 'image': {
      const img = imageOf(session, String(a.n ?? ''))
      return img ? [200, { type: img.type, b64: img.data.toString('base64') }] : [404, { error: 'no such image' }]
    }
    case 'tree': {
      const r = treeOf(session, String(a.path ?? ''))
      return [r.status, r.body]
    }
    case 'file': {
      const r = fileOf(session, String(a.path ?? ''))
      if (r.image && a.raw) return [200, { type: r.image.type, b64: readFileSync(r.image.file).toString('base64') }]
      return [r.status, r.body]
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
    case 'forget':
      devices.delete(id)
      for (const [endpoint, v] of subscriptions) if (v.device === id) subscriptions.delete(endpoint)
      return [200, { ok: true }]
    default:
      return [404, { error: 'not found' }]
  }
}

// ---- the public server, reached through the tunnel ----------------------------------------
const STATIC = {
  '/': ['app.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/e2e.js': ['e2e.js', 'text/javascript; charset=utf-8'],
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
      const key = await hkdf(secret, ROOT, `qsb/device|${phonePub}|${hubPub}`, 'aes')
      const id = randomBytes(16).toString('base64url')
      const code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
      for (const [k, d] of devices) if (!d.isApproved && Date.now() - d.at > 5 * 60_000) devices.delete(k)
      devices.set(id, { key, name: deviceName(String(req.headers['user-agent'] ?? '')), at: Date.now(), seenAt: Date.now(), code, isApproved: false, isDenied: false, nonces: new Map() })
      const mac = b64(await subtle.sign('HMAC', AUTH, te.encode(`welcome|${id}|${hubPub}|${phonePub}|${code}`)))
      bump()
      log(`pair asked: ${code}`)
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
      if (!dev.isApproved) return send(res, 200, await seal(dev, id, n, op === 'paired' ? 202 : 403, { code: dev.code }))
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
    url: tunnelUrl,
    link: tunnelUrl ? `${tunnelUrl}/#k=${TOKEN}` : '',
    error: tunnelError,
    sessions: sessions.size,
    devices: [...devices.values()].filter(d => d.isApproved).map(d => ({ name: d.name, seenAt: d.seenAt })),
    pending: [...devices.entries()].filter(([, d]) => !d.isApproved && !d.isDenied).map(([id, d]) => ({ id, code: d.code, name: d.name, at: d.at })),
    phones: Date.now() - lastPhoneAt < 40_000 ? [...devices.values()].filter(d => d.isApproved && Date.now() - d.seenAt < 40_000).length : 0,
    isLocked: pairFails >= MAX_PAIR_FAILS,
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
    if (s) delete s.answer
    // the texts stay on the phone as sent until the session's next snapshot says where they are
    if (texts.length) {
      s.snapshot = { ...s.snapshot, sending: [...(s.snapshot.sending ?? []), ...texts] }
      s.text = ''
      bump()
    }
    return send(res, 200, { texts, answer })
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
    if (route === 'POST /allow') {
      d.isApproved = true
      // at most MAX_DEVICES phones stay paired: the oldest goes
      const paired = [...devices.entries()].filter(([, x]) => x.isApproved).sort((x, y) => x[1].at - y[1].at)
      while (paired.length > MAX_DEVICES) devices.delete(paired.shift()[0])
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
  send(res, 404, { error: 'not found' })
})

// ---- the tunnel ---------------------------------------------------------------------------
let tunnel
let tunnelSeen = ''
// A new quick-tunnel name takes some seconds to resolve, and a phone that asks too early keeps
// the miss in its DNS cache: the link shows once Cloudflare's own resolver has the name, and a
// few seconds more.
async function whenResolvable(url) {
  const host = new URL(url).hostname
  for (let i = 0; i < 60 && !isShuttingDown; i++) {
    try {
      const r = await fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, { headers: { accept: 'application/dns-json' } })
      const body = await r.json()
      if (Array.isArray(body.Answer) && body.Answer.length) break
    } catch {
      // no answer yet: ask again
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  await new Promise(resolve => setTimeout(resolve, 3000))
  tunnelUrl = url
  log(`tunnel ready ${url}`)
}
function findCloudflared() {
  for (const d of [...String(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'])
    if (d && existsSync(join(d, 'cloudflared'))) return join(d, 'cloudflared')
  return ''
}
function startTunnel(port) {
  if (process.env.QSB_REMOTE_LOCAL) return void (tunnelUrl = `http://127.0.0.1:${port}`) // tests: no tunnel
  const bin = findCloudflared()
  // the mod looks before it starts a hub; one started anyway stops rather than run with no tunnel
  if (!bin) {
    tunnelError = 'cloudflared is not installed: brew install cloudflared'
    log(tunnelError)
    return shutdown(3)
  }
  tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  const scan = chunk => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk))
    if (m && !tunnelSeen) {
      tunnelSeen = m[0]
      log(`tunnel ${tunnelSeen}, waiting for its name to resolve`)
      void whenResolvable(tunnelSeen)
    }
  }
  tunnel.stdout.on('data', scan)
  tunnel.stderr.on('data', scan)
  tunnel.on('exit', code => {
    tunnelError = `the tunnel stopped (cloudflared exit ${code})`
    log(tunnelError)
    shutdown(1)
  })
}

let isShuttingDown = false
function shutdown(code = 0) {
  if (isShuttingDown) return
  isShuttingDown = true
  log(`stopping (${code})`)
  for (const w of waiters) w()
  if (tunnel && tunnel.exitCode === null) tunnel.kill('SIGTERM')
  pub.close()
  ctl.close()
  rmSync(SOCK, { force: true })
  setTimeout(() => process.exit(code), 300).unref()
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(0))
process.on('SIGHUP', () => undefined) // started detached: a closed terminal is no reason to stop

// sessions that stopped calling in are dropped; with none for two minutes, or no phone for the
// idle time, the hub stops and the link with it
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) if (now - s.seenAt > 15_000) { sessions.delete(id); bump() }
  if (now - lastSessionAt > SESSION_TTL) return shutdown(0)
  if (now - lastPhoneAt > IDLE_MS) shutdown(0)
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
  pub.listen(0, '127.0.0.1', () => {
    log(`hub ${process.pid} on 127.0.0.1:${pub.address().port}`)
    startTunnel(pub.address().port)
  })
}
