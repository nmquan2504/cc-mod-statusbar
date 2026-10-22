// Self remote's hub: one per machine and user, shared by every Claude Code session that turns the
// remote on (Settings, Self remote; then ⇄ on the bar). It serves the phone's page through one
// Cloudflare quick tunnel and keeps each session's latest snapshot.
//
//   the control socket   <dir>/hub.sock, <dir> = $TMPDIR/qsb-remote-<uid> (mode 700): the mods
//                        POST /session (a heartbeat with the snapshot), GET /inbox, GET /status,
//                        POST /notify, POST /allow, POST /deny, POST /stop
//   the public server    127.0.0.1:<random>, reached only through the tunnel
//
// Pairing: the QR link carries a random token in its #fragment (never sent to Cloudflare or this
// server's logs as a URL). A phone that shows it is held as pending with a 4-character code until the
// person presses Allow in a terminal; only then does it get a session cookie. Started detached by
// the first mod (`node server.mjs <dir> <idleMinutes>`); it stops itself when no session has
// called in for two minutes, or no phone has for idleMinutes. Node 18 or newer; no packages.
import { execFile, spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, randomInt, sign, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { dirname, extname, isAbsolute, join } from 'node:path'
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
const devices = new Map() // cookie -> { name, at, seenAt }
const pending = new Map() // pair id -> { code, name, at, cookie? }
const subscriptions = new Map() // endpoint -> subscription
const waiters = new Set() // long-poll responses waiting for the next version
let pairFails = 0
let notice = { title: 'Claude', body: 'Nothing yet.', at: 0, session: '' }
let lastPhoneAt = Date.now()
let lastSessionAt = Date.now()

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = privateKey.export({ format: 'jwk' })
const VAPID_PUBLIC = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url')

// ---- helpers ------------------------------------------------------------------------------
const sameText = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

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
function cookieOf(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === 'qsb') return v.join('=')
  }
  return ''
}
const SET_COOKIE = c => ({ 'Set-Cookie': `qsb=${c}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800` })

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
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
function imageOf(session, n) {
  const row = (sessions.get(session)?.snapshot.images ?? []).find(i => String(i.n) === String(n))
  if (!row || !/\/images\/\d+\.(png|jpe?g|gif|webp)$/i.test(row.path) || !existsSync(row.path)) return undefined
  return { data: readFileSync(row.path), type: IMAGE_TYPES[extname(row.path).toLowerCase()] }
}

// ---- the public server, reached through the tunnel ----------------------------------------
const STATIC = {
  '/': ['app.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
}

const pub = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const route = `${req.method} ${url.pathname}`
    const file = STATIC[url.pathname]
    if (req.method === 'GET' && file) return send(res, 200, readFileSync(join(HERE, file[0])), file[1], url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
    const cookie = cookieOf(req)
    const device = cookie && devices.get(cookie)

    // the manifest: a paired phone's home-screen app starts with a one-time code of its own, as
    // iOS gives the app its own cookie jar
    if (route === 'GET /manifest.webmanifest') {
      let start = '/'
      if (device) {
        const id = randomBytes(16).toString('base64url')
        pending.set(id, { code: '', name: device.name, at: Date.now(), cookie: randomBytes(32).toString('base64url'), isPreApproved: true })
        start = `/#d=${id}`
      }
      return send(res, 200, { name: 'Claude remote', short_name: 'Claude', start_url: start, display: 'standalone', background_color: '#1a1a18', theme_color: '#1a1a18', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] }, 'application/manifest+json')
    }

    // pairing, step 1: the token from the QR code; the phone then waits for Allow in a terminal
    if (route === 'POST /api/pair') {
      if (pairFails >= MAX_PAIR_FAILS) return send(res, 423, { error: 'Pairing is locked after too many wrong links. Stop and start the remote again.' })
      const body = await readJson(req)
      const d = typeof body?.d === 'string' ? pending.get(body.d) : undefined
      if (d?.isPreApproved && Date.now() - d.at < 10 * 60_000) {
        pending.delete(body.d)
        devices.set(d.cookie, { name: d.name, at: Date.now(), seenAt: Date.now() })
        return send(res, 200, { ok: true }, undefined, SET_COOKIE(d.cookie))
      }
      if (typeof body?.k !== 'string' || !sameText(body.k, TOKEN)) {
        pairFails++
        return send(res, 403, { error: 'This link is not the one the terminal shows now. Scan the QR code again.' })
      }
      const id = randomBytes(16).toString('base64url')
      const code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
      for (const [k, p] of pending) if (!p.isPreApproved && Date.now() - p.at > 5 * 60_000) pending.delete(k)
      pending.set(id, { code, name: deviceName(String(req.headers['user-agent'] ?? '')), at: Date.now() })
      bump()
      log(`pair asked: ${code}`)
      return send(res, 202, { pending: id, code })
    }
    // pairing, step 2: asked again until a terminal allows or denies it
    if (route === 'GET /api/pair') {
      const id = url.searchParams.get('id') ?? ''
      const p = pending.get(id)
      if (!p || p.isPreApproved) return send(res, 404, { error: 'This request ended. Scan the QR code again.' })
      if (p.isDenied) {
        pending.delete(id)
        return send(res, 403, { error: 'Refused in the terminal.' })
      }
      if (!p.cookie) return send(res, 202, { pending: id, code: p.code })
      pending.delete(id)
      devices.set(p.cookie, { name: p.name, at: Date.now(), seenAt: Date.now() })
      while (devices.size > MAX_DEVICES) devices.delete(devices.keys().next().value)
      return send(res, 200, { ok: true }, undefined, SET_COOKIE(p.cookie))
    }

    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
    if (!device) return send(res, 401, { error: 'Not paired. Scan the QR code in the terminal again.' })
    device.seenAt = lastPhoneAt = Date.now()
    const session = url.searchParams.get('s') ?? ''

    switch (route) {
      // the sessions, at once or when the version moves past `since` (a long poll: quick tunnels
      // carry no server-sent events)
      case 'GET /api/state': {
        const since = Number(url.searchParams.get('since') ?? -1)
        if (since !== version) return send(res, 200, stateOf())
        const done = () => send(res, 200, stateOf())
        waiters.add(done)
        const t = setTimeout(() => {
          waiters.delete(done)
          done()
        }, POLL_WAIT)
        req.on('close', () => {
          clearTimeout(t)
          waiters.delete(done)
        })
        return
      }
      case 'POST /api/reply': {
        const body = await readJson(req)
        const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 8000) : ''
        const s = sessions.get(String(body?.session ?? ''))
        if (!text || !s) return send(res, 400, { error: text ? 'That session is gone.' : 'empty' })
        s.inbox.push(text)
        bump()
        return send(res, 200, { ok: true, queued: Boolean(s.snapshot.busy) })
      }
      // the phone's answer to the question Claude waits on; the session takes it at its next call
      case 'POST /api/answer': {
        const body = await readJson(req)
        const s = sessions.get(String(body?.session ?? ''))
        const askId = String(body?.id ?? '')
        if (!s || !s.snapshot.ask || s.snapshot.ask.id !== askId) return send(res, 409, { error: 'That question is already answered.' })
        const answers = {}
        for (const [q, v] of Object.entries(body?.answers ?? {})) if (typeof v === 'string') answers[String(q).slice(0, 2000)] = v.slice(0, 4000)
        s.answer = { id: askId, answers, isDismissed: body?.isDismissed === true }
        bump()
        return send(res, 200, { ok: true })
      }
      case 'GET /api/diff': {
        const diff = await diffOf(session, url.searchParams.get('path') ?? '')
        return diff === undefined ? send(res, 404, { error: 'Not a file of this session.' }) : send(res, 200, { diff })
      }
      case 'GET /api/image': {
        const img = imageOf(session, url.searchParams.get('n') ?? '')
        return img ? send(res, 200, img.data, img.type) : send(res, 404, { error: 'no such image' })
      }
      case 'GET /api/vapid':
        return send(res, 200, { key: VAPID_PUBLIC })
      case 'POST /api/subscribe': {
        const body = await readJson(req)
        const endpoint = String(body?.endpoint ?? '')
        let host = ''
        try {
          const u = new URL(endpoint)
          host = u.protocol === 'https:' ? u.hostname : ''
        } catch {}
        if (!PUSH_HOSTS.some(re => re.test(host))) return send(res, 400, { error: 'not a known push service' })
        subscriptions.set(endpoint, body)
        while (subscriptions.size > MAX_DEVICES) subscriptions.delete(subscriptions.keys().next().value)
        return send(res, 200, { ok: true })
      }
      case 'GET /api/notice':
        return send(res, 200, notice)
      case 'POST /api/forget':
        devices.delete(cookie)
        return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'qsb=; Path=/; Max-Age=0' })
      default:
        return send(res, 404, { error: 'not found' })
    }
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
    devices: [...devices.values()].map(d => ({ name: d.name, seenAt: d.seenAt })),
    pending: [...pending.entries()].filter(([, p]) => !p.isPreApproved && !p.cookie && !p.isDenied).map(([id, p]) => ({ id, code: p.code, name: p.name, at: p.at })),
    phones: Date.now() - lastPhoneAt < 40_000 ? [...devices.values()].filter(d => Date.now() - d.seenAt < 40_000).length : 0,
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
    if (texts.length) bump()
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
    const p = pending.get(String((await readJson(req))?.id ?? ''))
    if (!p) return send(res, 404, { error: 'no such request' })
    if (route === 'POST /allow') p.cookie = randomBytes(32).toString('base64url')
    else p.isDenied = true
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
  if (!bin) {
    tunnelError = 'cloudflared is not installed: brew install cloudflared'
    return
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
