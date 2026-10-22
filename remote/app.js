// The phone's page for Self remote: pairs with the link's #k= token (a terminal must then allow
// it), then follows every Claude Code session on the machine with a long poll, as quick tunnels
// carry no server-sent events. Every text from a session goes in with textContent, never as HTML.
const $ = id => document.getElementById(id)
const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

let state = null // { version, sessions, notice }
let snap = null // the session shown
let picked = ''
let tab = 'activity'
let clockTimer = 0
let lastNotice = 0
try { picked = localStorage.getItem('qsb-session') || '' } catch {}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- pairing --------------------------------------------------------------------------------
async function pair() {
  const params = new URLSearchParams(location.hash.slice(1))
  const k = params.get('k'), d = params.get('d')
  if (!k && !d) return
  history.replaceState(null, '', '/')
  let r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(k ? { k } : { d }) })
  let body = await r.json().catch(() => ({}))
  // held until a terminal allows it: the same code shows there
  while (r.status === 202) {
    gate('Check the code in the terminal and press Allow there.', body.code)
    await sleep(2000)
    r = await fetch(`/api/pair?id=${encodeURIComponent(body.pending)}`)
    body = await r.json().catch(() => ({}))
  }
  if (!r.ok) {
    gate(body.error || 'This link no longer works. Scan the QR code again.')
    throw new Error('pair')
  }
}
function gate(text, code) {
  $('gate-text').textContent = text
  $('gate-code').textContent = code || ''
  $('gate-code').hidden = !code
  $('gate').hidden = false
  $('app').hidden = true
}

// ---- the long poll ---------------------------------------------------------------------------
async function follow() {
  let since = -1
  for (;;) {
    const r = await fetch(`/api/state?since=${since}`).catch(() => undefined)
    if (r && r.status === 401) return gate('Not paired. Scan the QR code in the terminal again.')
    if (!r || !r.ok) {
      await sleep(3000)
      continue
    }
    state = await r.json()
    since = state.version
    if (state.notice.at > lastNotice) {
      if (lastNotice) toast(state.notice)
      lastNotice = state.notice.at
    }
    $('gate').hidden = true
    $('app').hidden = false
    render()
  }
}
const q = (path, extra = '') => `${path}?s=${encodeURIComponent(snap ? snap.id : '')}${extra}`

// ---- drawing --------------------------------------------------------------------------------
const clock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function renderHeader() {
  const busy = snap.busy
  $('dot').className = busy ? 'dot busy' : 'dot'
  const tick = () => {
    $('status').textContent = busy && snap.turnStartedAt ? `working ${clock(Date.now() - snap.turnStartedAt)}` : 'idle'
  }
  tick()
  clearInterval(clockTimer)
  if (busy) clockTimer = setInterval(tick, 1000)
  $('where').textContent = [snap.folder && `/${snap.folder}`, snap.branch && `⎇ ${snap.branch}`, snap.model].filter(Boolean).join('  ')
  const chips = $('chips')
  chips.replaceChildren()
  const usage = snap.usage || {}
  const chip = (label, n, warnAt, badAt) => {
    if (n === null || n === undefined) return
    chips.append(el('span', `chip${n >= badAt ? ' bad' : n >= warnAt ? ' warn' : ''}`, `${label} ${Math.round(n)}%`))
  }
  chip('5h', usage.five, 50, 80)
  chip('wk', usage.week, 50, 80)
  chip('ctx', usage.ctx, 70, 85)
  if (typeof usage.cost === 'number') chips.append(el('span', 'chip', `$${usage.cost.toFixed(2)}`))
  if (snap.mode) chips.append(el('span', 'chip', snap.mode))
  const nf = snap.edited.length + snap.changes.length
  document.querySelector('[data-tab=files]').textContent = nf ? `Files ${nf}` : 'Files'
  document.querySelector('[data-tab=images]').textContent = snap.images.length ? `Images ${snap.images.length}` : 'Images'
}

// text with ``` fences as <pre>, `code` inline, the rest as plain text
function richText(text) {
  const box = el('div', 'body')
  const parts = String(text).split(/```[\w-]*\n?/)
  parts.forEach((part, i) => {
    if (i % 2 === 1) return box.append(el('pre', '', part.replace(/\n$/, '')))
    part.split(/(`[^`\n]+`)/).forEach(bit => box.append(bit.startsWith('`') && bit.endsWith('`') && bit.length > 2 ? el('code', '', bit.slice(1, -1)) : document.createTextNode(bit)))
  })
  return box
}

function renderActivity() {
  const root = $('tab-activity')
  root.replaceChildren()
  if (snap.busy) {
    const card = el('div', 'card')
    card.append(el('h3', '', 'This turn'))
    if (snap.prompt) card.append(el('div', 'meta', snap.prompt))
    if (snap.nowTool) card.append(el('div', 'tool now', `▸ ${snap.nowTool}`))
    for (const t of [...snap.tools].reverse().slice(0, 15)) card.append(el('div', 'tool', t))
    root.append(card)
  }
  if (snap.tasks && snap.tasks.length) {
    const card = el('div', 'card')
    card.append(el('h3', '', 'Tasks'))
    for (const t of snap.tasks) {
      const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'
      card.append(el('div', `task${t.status === 'completed' ? ' done' : ''}`, `${mark} ${t.subject}`))
    }
    root.append(card)
  }
  if (snap.summary) {
    const card = el('div', 'card')
    card.append(el('h3', '', `Last turn · ${clock(snap.summary.took)}${typeof snap.summary.cost === 'number' ? ` · $${snap.summary.cost.toFixed(2)}` : ''}`))
    if (snap.summary.did) card.append(el('div', '', snap.summary.did))
    if (snap.summary.result) card.append(el('div', 'meta', snap.summary.result))
    root.append(card)
  }
  if (snap.queued && snap.queued.length) {
    const card = el('div', 'card')
    card.append(el('h3', '', 'Waiting to send'))
    for (const q of snap.queued) card.append(el('div', 'meta', q))
    root.append(card)
  }
  if (!snap.messages.length) return root.append(el('div', 'empty', 'Nothing in this session yet.'))
  for (const m of [...snap.messages].reverse()) {
    const box = el('div', `msg ${m.role}`)
    box.append(el('div', 'who', m.role === 'user' ? 'You' : 'Claude'))
    box.append(richText(m.text))
    root.append(box)
  }
}

function fileRow(path, note, noteCls) {
  const row = el('div', 'file')
  row.append(el('span', 'path', path))
  row.append(el('span', noteCls, note))
  row.onclick = () => showDiff(path)
  return row
}
function renderFiles() {
  const root = $('tab-files')
  root.replaceChildren()
  if (snap.edited.length) {
    const card = el('div', 'card')
    card.append(el('h3', '', 'Edited this turn'))
    for (const f of snap.edited) {
      const row = fileRow(f.path, '', '')
      row.lastChild.append(el('span', 'add', `+${f.added} `), el('span', 'del', `−${f.removed}`))
      card.append(row)
    }
    root.append(card)
  }
  if (snap.changes.length) {
    const card = el('div', 'card')
    card.append(el('h3', '', 'Changed in git'))
    for (const f of snap.changes) card.append(fileRow(f.path, f.code, 'ctx'))
    root.append(card)
  }
  if (!root.childElementCount) root.append(el('div', 'empty', 'No changed files.'))
}
async function showDiff(path) {
  const box = openOverlay(path)
  const r = await fetch(q('/api/diff', `&path=${encodeURIComponent(path)}`))
  const body = await r.json().catch(() => ({}))
  const diff = el('div', 'diff')
  const text = r.ok ? body.diff || '(no changes against HEAD)' : body.error || 'Could not read the diff.'
  for (const line of text.split('\n')) {
    const cls = line.startsWith('+++') || line.startsWith('---') ? 'ctx' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : ''
    diff.append(el('div', cls, line || ' '))
  }
  box.append(diff)
}

function renderImages() {
  const root = $('tab-images')
  root.replaceChildren()
  if (!snap.images.length) return root.append(el('div', 'empty', 'No images pasted in this session.'))
  const grid = el('div', 'grid')
  for (const img of snap.images) {
    const node = el('img')
    node.loading = 'lazy'
    node.alt = `Image #${img.n}`
    node.src = q('/api/image', `&n=${img.n}`)
    node.onclick = () => {
      const box = openOverlay(`Image #${img.n}`)
      const full = el('img')
      full.src = node.src
      box.append(full)
    }
    grid.append(node)
  }
  root.append(grid)
}

function openOverlay(title) {
  const o = $('overlay')
  o.replaceChildren()
  const head = el('div', 'row between')
  head.append(el('strong', 'meta', title))
  const close = el('button', 'small', 'Close')
  close.onclick = () => { o.hidden = true }
  head.append(close)
  o.append(head)
  const body = el('div')
  body.style.marginTop = '12px'
  o.append(body)
  o.hidden = false
  return body
}

function renderSessions() {
  const box = $('sessions')
  box.replaceChildren()
  const list = state.sessions
  snap = list.find(s => s.id === picked) || list[0] || null
  if (snap) picked = snap.id
  if (list.length < 2) return
  for (const s of list) {
    const b = el('button', `pick${s.id === picked ? ' on' : ''}`)
    b.append(el('span', s.busy ? 'dot busy' : 'dot'), document.createTextNode(`/${s.folder || '?'}${s.branch ? ` ⎇ ${s.branch}` : ''}`))
    b.onclick = () => {
      picked = s.id
      try { localStorage.setItem('qsb-session', picked) } catch {}
      render()
    }
    box.append(b)
  }
}

function render() {
  renderSessions()
  if (!snap) {
    $('tab-activity').replaceChildren(el('div', 'empty', 'No Claude Code session has the remote on now.'))
    $('tab-files').replaceChildren()
    $('tab-images').replaceChildren()
    $('where').textContent = ''
    $('chips').replaceChildren()
    return
  }
  renderHeader()
  renderActivity()
  renderFiles()
  renderImages()
  $('hint').hidden = !snap.busy
  $('hint').textContent = 'Claude is working. What you send goes in when this turn ends.'
}

function toast(n) {
  const t = el('div', 'toast')
  t.append(el('strong', '', n.title), el('div', 'meta', n.body))
  document.body.append(t)
  setTimeout(() => t.remove(), 5000)
}

// ---- tabs and the composer ------------------------------------------------------------------
for (const b of document.querySelectorAll('nav button'))
  b.onclick = () => {
    tab = b.dataset.tab
    for (const x of document.querySelectorAll('nav button')) x.classList.toggle('on', x === b)
    for (const name of ['activity', 'files', 'images']) $(`tab-${name}`).hidden = name !== tab
    window.scrollTo(0, 0)
  }

const text = $('text')
text.addEventListener('input', () => {
  text.style.height = 'auto'
  text.style.height = `${Math.min(text.scrollHeight, 160)}px`
})
$('send').onclick = async () => {
  const value = text.value.trim()
  if (!value || !snap) return
  $('send').disabled = true
  const r = await fetch('/api/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: value, session: snap.id }) }).catch(() => undefined)
  $('send').disabled = false
  const body = r ? await r.json().catch(() => ({})) : {}
  if (!r || !r.ok) return toast({ title: 'Not sent', body: body.error || 'The session did not answer. Try again.' })
  text.value = ''
  text.style.height = 'auto'
  toast({ title: body.queued ? 'Queued' : 'Sent', body: body.queued ? 'It goes in when Claude finishes this turn.' : value.slice(0, 120) })
}

// ---- push -----------------------------------------------------------------------------------
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
function setupNotify() {
  const btn = $('notify')
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  if (!('PushManager' in window)) {
    if (isIos && !isStandalone) {
      btn.hidden = false
      btn.onclick = () => toast({ title: 'Notifications on iPhone', body: 'Tap Share, then Add to Home Screen, and open Claude remote from there.' })
    }
    return
  }
  btn.hidden = Notification.permission === 'granted' && localStorage.getItem('qsb-sub') === location.host
  btn.onclick = subscribe
  if (Notification.permission === 'granted') subscribe().catch(() => undefined)
}
async function subscribe() {
  if ((await Notification.requestPermission()) !== 'granted') return toast({ title: 'Notifications off', body: 'Allow them in the browser settings to hear when Claude finishes.' })
  const reg = await navigator.serviceWorker.ready
  const { key } = await (await fetch('/api/vapid')).json()
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const old = await reg.pushManager.getSubscription()
  if (old) await old.unsubscribe()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) })
  if (r.ok) {
    try { localStorage.setItem('qsb-sub', location.host) } catch {}
    $('notify').hidden = true
    toast({ title: 'Notifications on', body: 'You will hear when Claude finishes or needs you.' })
  }
}

pair()
  .then(() => {
    void follow()
    setupNotify()
  })
  .catch(() => undefined)
