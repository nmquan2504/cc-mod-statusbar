// The phone's page for Self remote: pairs with the link's #k= token (a terminal must then allow
// it), then follows every Claude Code session on the machine with a long poll, as quick tunnels
// carry no server-sent events. One header line (sessions, the session's title, files), the
// conversation as chat bubbles, and a reply box. Every text from a session goes in with
// textContent, never as HTML.
const $ = id => document.getElementById(id)
const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

// The icons, drawn as SVG strokes in the text's color: a 24-unit box, one path each.
const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  folder: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z',
  back: 'M15 18l-6-6 6-6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  spark: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  box: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.4M12 16.8v.2',
  boxChecked: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12.5l2.5 2.5L16 9.5',
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'ic')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[name])
  svg.append(path)
  return svg
}
for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon))

let state = null // { version, sessions, notice }
let snap = null // the session shown
let picked = ''
let lastNotice = 0
let isFirstDraw = true
let shownId = ''
let filesTab = 'folder'
const opened = new Set() // the tool rows opened to their output
// the question Claude waits on: what this phone picked and typed so far, and whether it was put away
let askDraft = { id: '', picks: {}, other: {} }
let askHiddenId = ''
try { picked = localStorage.getItem('qsb-session') || '' } catch {}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- pairing --------------------------------------------------------------------------------
// The link's #k= stays on this phone: e2e.js pairs with an HMAC of it and an ECDH, then the phone
// waits for Allow in a terminal, asking with sealed calls.
async function pair() {
  if (!E2E.isSupported()) {
    gate('This browser cannot encrypt, so it cannot open the remote. Open the link in a current Safari or Chrome.')
    throw new Error('e2e')
  }
  const k = new URLSearchParams(location.hash.slice(1)).get('k')
  if (k) {
    history.replaceState(null, '', '/')
    await E2E.forget()
    try {
      const { code } = await E2E.pair(k)
      gate('Check the code in the terminal and press Allow there.', code)
    } catch (err) {
      gate(err.message)
      throw err
    }
  } else if (!(await E2E.load())) {
    gate('Scan the QR code in the terminal, or paste its link here.', '', true)
    throw new Error('unpaired')
  }
  for (;;) {
    const r = await E2E.call('paired').catch(err => err)
    if (r instanceof E2E.Unpaired) {
      await E2E.forget()
      gate('Not paired. Scan the QR code in the terminal again.', '', true)
      throw r
    }
    if (r instanceof Error) {
      await sleep(2000)
      continue
    }
    if (r.s === 200) return
    if (r.s === 202) {
      gate('Check the code in the terminal and press Allow there.', r.b.code)
      await sleep(2000)
      continue
    }
    await E2E.forget()
    gate(r.b.error || 'Refused in the terminal.', '', true)
    throw new Error('refused')
  }
}
function gate(text, code, canPaste) {
  $('gate-text').textContent = text
  $('gate-code').textContent = code || ''
  $('gate-code').hidden = !code
  $('gate-paste').hidden = !canPaste
  $('gate').hidden = false
  $('app').hidden = true
}

// ---- the long poll ---------------------------------------------------------------------------
async function follow() {
  let since = -1
  for (;;) {
    const r = await E2E.call('state', { since }).catch(err => err)
    if (r instanceof E2E.Unpaired) return gate('Not paired. Scan the QR code in the terminal again.', '', true)
    if (r instanceof Error || r.s !== 200) {
      await sleep(3000)
      continue
    }
    state = r.b
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
// a sealed call about the session shown: { s, b }, or { s: 0, b: { error } } when it did not go
const api = (op, a = {}) => E2E.call(op, { session: snap ? snap.id : '', ...a }).catch(err => ({ s: 0, b: { error: err.message } }))
// an image the hub sends sealed, as a URL the page can show; kept per session and image
const imageUrls = new Map()
async function imageUrl(op, a, cacheKey) {
  if (cacheKey && imageUrls.has(cacheKey)) return imageUrls.get(cacheKey)
  const r = await api(op, a)
  if (r.s !== 200 || !r.b.b64) return ''
  const url = URL.createObjectURL(new Blob([E2E.b64.dec(r.b.b64)], { type: r.b.type }))
  if (cacheKey) imageUrls.set(cacheKey, url)
  return url
}
const clock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const titleOf = s => s.folder || 'Claude'

// ---- markdown, built as nodes: nothing from a session is parsed as HTML -------------------
function link(url, label) {
  const a = el('a', '', label)
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  return a
}
const INLINE = /(`[^`\n]+`)|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?])|(?<![\w*])\*([^*\s][^*\n]*)\*(?!\w)/g
function inline(text, into) {
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) into.append(document.createTextNode(text.slice(at, m.index)))
    if (m[1]) into.append(el('code', '', m[1].slice(1, -1)))
    else if (m[2] !== undefined) inline(m[2], into.appendChild(el('strong')))
    else if (m[3] !== undefined) into.append(link(m[4], m[3]))
    else if (m[5]) into.append(link(m[5], m[5]))
    else if (m[6] !== undefined) inline(m[6], into.appendChild(el('em')))
    at = m.index + m[0].length
  }
  if (at < text.length) into.append(document.createTextNode(text.slice(at)))
  return into
}
function table(rows) {
  const wrap = el('div', 'tablewrap')
  const t = wrap.appendChild(el('table'))
  const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  rows.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).forEach((r, i) => {
    const tr = t.appendChild(el('tr'))
    for (const c of cells(r)) inline(c, tr.appendChild(el(i === 0 ? 'th' : 'td')))
  })
  return wrap
}
function markdown(text) {
  const box = el('div', 'md')
  const lines = String(text).split('\n')
  let para = null, list = null
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const code = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i])
      i++
      box.append(el('pre', '', code.join('\n')))
      para = list = null
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++])
      box.append(table(rows))
      para = list = null
      continue
    }
    i++
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (h) {
      box.append(inline(h[2], el('h4')))
      para = list = null
    } else if (li) {
      const kind = /\d/.test(li[2]) ? 'ol' : 'ul'
      const parent = list && li[1].length >= 2 ? list.lastElementChild : null
      // an indented item goes in a list of its own under the item before it
      if (parent) {
        const sub = parent.querySelector(':scope > ul, :scope > ol') ?? parent.appendChild(el(kind))
        sub.append(inline(li[3], el('li')))
      } else {
        if (!list) list = box.appendChild(el(kind))
        list.append(inline(li[3], el('li')))
      }
      para = null
    } else if (quote) {
      box.append(inline(quote[1], el('blockquote')))
      para = list = null
    } else if (!line.trim()) {
      para = list = null
    } else {
      if (para) para.append(el('br'))
      else para = box.appendChild(el('p'))
      inline(line, para)
      list = null
    }
  }
  return box
}

// ---- the conversation: your bubbles right, Claude's left, its tools as title lines ------------
// the path the hub knows a tool call's file by: as edited this turn, or as git lists it changed
const diffPathOf = path => snap.edited.find(f => f.path === path)?.path ?? snap.changes.find(f => path === f.path || path.endsWith(`/${f.path}`))?.path

function toolLines(t) {
  const lines = []
  if (t.out === undefined) lines.push(['', 'Running…'])
  else if (t.isError) for (const l of t.out.split('\n')) lines.push(['del', l])
  else if (t.old !== undefined) {
    for (const l of t.old ? t.old.split('\n') : []) lines.push(['del', `- ${l}`])
    for (const l of t.new ? t.new.split('\n') : []) lines.push(['add', `+ ${l}`])
  } else if (t.new !== undefined) {
    lines.push(['', `Wrote ${t.new.split('\n').length} lines`])
    for (const l of t.new.split('\n')) lines.push(['add', l])
  } else for (const l of t.out.replace(/\n+$/, '').split('\n')) lines.push(['', l])
  return lines
}

// one title line a tool; a press opens what it gave back under it
// a question Claude asked: in Claude's color, its answers under it, a press shows each question
function askRow(t, into) {
  const isOpen = opened.has(t.id)
  const row = into.appendChild(el('div', `trow ask${isOpen ? ' open' : ''}`))
  row.append(icon('help'))
  const name = row.appendChild(el('span', 'name'))
  name.append(el('strong', '', 'Ask'), document.createTextNode(` ${t.arg}`))
  row.appendChild(el('span', 'chev')).append(icon(isOpen ? 'chevronDown' : 'chevronRight'))
  row.onclick = () => {
    if (isOpen) opened.delete(t.id)
    else opened.add(t.id)
    renderChat()
  }
  const qa = t.qa || []
  const summary = t.out === undefined ? 'waiting for your answer' : t.isError ? 'dismissed' : qa.map(x => x.a).filter(Boolean).join(' · ') || 'no answer'
  if (!isOpen) return into.append(el('div', 'ask-sum', `↳ ${summary}`))
  const out = into.appendChild(el('div', 'tout ask-out'))
  for (const x of qa) {
    out.append(el('div', 'aq', x.q))
    out.append(el('div', 'aa', `↳ ${t.out === undefined ? 'waiting' : t.isError ? 'dismissed' : x.a || 'left blank'}`))
  }
}

function toolRow(t, into) {
  if (t.qa) return askRow(t, into)
  const isOpen = opened.has(t.id)
  const row = into.appendChild(el('div', `trow${isOpen ? ' open' : ''}`))
  row.append(el('span', `bullet ${t.out === undefined ? 'run' : t.isError ? 'bad' : 'ok'}`))
  const name = row.appendChild(el('span', 'name'))
  name.append(el('strong', '', t.name), document.createTextNode(t.arg ? `(${t.arg})` : ''))
  row.appendChild(el('span', 'chev')).append(icon(isOpen ? 'chevronDown' : 'chevronRight'))
  row.onclick = () => {
    if (isOpen) opened.delete(t.id)
    else opened.add(t.id)
    renderChat()
  }
  if (!isOpen) return
  const out = into.appendChild(el('div', 'tout'))
  for (const [cls, text] of toolLines(t)) out.append(el('div', cls, text || ' '))
  const diffPath = t.path && diffPathOf(t.path)
  if (diffPath) {
    const open = out.appendChild(el('div', 'open-diff', 'Open the whole diff'))
    open.onclick = () => showDiff(diffPath)
  }
}

function renderChat() {
  const root = $('chat')
  root.replaceChildren()
  const items = snap.transcript || []
  if (!items.length && !snap.busy) return root.append(el('div', 'empty', 'Nothing in this session yet.'))
  let tools = null
  for (const t of items) {
    if (t.k === 'tool') {
      tools ??= root.appendChild(el('div', 'tools'))
      toolRow(t, tools)
      continue
    }
    tools = null
    if (t.k === 'user') root.append(inline(t.text, el('div', 'b me')))
    else root.appendChild(el('div', 'b claude')).append(markdown(t.text))
  }
  // sent as the prompt, not in the transcript yet: drawn as the bubble it will be
  for (const text of snap.sending || []) root.append(inline(text, el('div', 'b me')))
  // waiting for a turn to end, dimmed; with none running it goes in at the next tick, a bubble as any
  for (const text of snap.queued || []) {
    const b = root.appendChild(inline(text, el('div', snap.busy ? 'b me queued' : 'b me')))
    if (snap.busy) b.append(el('span', 'note', 'waits for this turn to end'))
  }
  if (snap.ask) {
    // the question, as a bubble that opens its page again
    const b = root.appendChild(el('div', 'b claude ask'))
    b.append(el('div', 'qt', snap.ask.questions[0]?.question || 'Claude asks you'))
    if (snap.ask.questions.length > 1) b.append(el('div', 'meta', `and ${snap.ask.questions.length - 1} more`))
    b.append(el('div', 'go', 'Answer'))
    b.onclick = () => openAsk(true)
  }
  if (snap.busy) {
    const w = root.appendChild(el('div', 'working'))
    const head = w.appendChild(el('div', 'head'))
    head.appendChild(el('span', 'spin')).append(icon('spark'))
    head.append(el('span', '', 'Working…'), el('span', 'elapsed', ''))
    if (snap.nowTool) w.append(el('div', 'now', snap.nowTool))
    for (const t of snap.tasks || []) {
      const row = w.appendChild(el('div', `task ${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : ''}`))
      row.append(icon(t.status === 'completed' ? 'boxChecked' : 'box'), el('span', '', t.subject))
    }
    tickElapsed()
  }
}
function tickElapsed() {
  const node = document.querySelector('.working .elapsed')
  if (node && snap && snap.turnStartedAt) node.textContent = `(${clock(Date.now() - snap.turnStartedAt)})`
}
setInterval(tickElapsed, 1000)

const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 120
const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight)

// ---- the header, the drawer and the session sheet ----------------------------------------------
function renderHeader() {
  $('dot').className = snap.busy ? 'dot busy' : 'dot'
  $('title-text').textContent = titleOf(snap)
  const n = snap.edited.length + snap.changes.length + snap.images.length
  $('files-badge').hidden = !n
  $('files-badge').textContent = String(n)
  $('text').placeholder = snap.busy ? 'Queue a reply' : 'Reply'
}

function renderDrawer() {
  const box = $('sessions')
  box.replaceChildren()
  if (!state.sessions.length) box.append(el('div', 'meta', 'No session has the remote on now.'))
  for (const s of state.sessions) {
    const row = box.appendChild(el('button', `srow${s.id === picked ? ' on' : ''}`))
    row.append(el('span', s.busy ? 'dot busy' : 'dot'))
    const text = row.appendChild(el('div'))
    const sub = el('div', 'sub')
    if (s.branch) sub.append(icon('branch'), document.createTextNode(` ${s.branch} · `))
    sub.append(document.createTextNode(s.busy ? 'working' : 'idle'))
    text.append(el('div', 'name', titleOf(s)), sub)
    row.onclick = () => {
      picked = s.id
      try { localStorage.setItem('qsb-session', picked) } catch {}
      closeLayers()
      render()
    }
  }
}
function openDrawer() {
  renderDrawer()
  $('scrim').hidden = false
  $('drawer').classList.add('open')
}

function openSheet() {
  if (!snap) return
  const sheet = $('sheet')
  sheet.replaceChildren()
  sheet.append(el('h2', '', titleOf(snap)))
  const line = sheet.appendChild(el('div', 'meta'))
  if (snap.branch) line.append(icon('branch'), document.createTextNode(` ${snap.branch} · `))
  line.append(document.createTextNode([snap.model, snap.mode && `mode ${snap.mode}`].filter(Boolean).join(' · ')))
  if (snap.cwd) sheet.append(el('div', 'meta', snap.cwd))
  sheet.append(el('div', 'meta', snap.busy && snap.turnStartedAt ? `Working for ${clock(Date.now() - snap.turnStartedAt)}` : 'Idle'))
  const chips = sheet.appendChild(el('div', 'chips'))
  const usage = snap.usage || {}
  const chip = (label, n, warnAt, badAt) => {
    if (n !== null && n !== undefined) chips.append(el('span', `chip${n >= badAt ? ' bad' : n >= warnAt ? ' warn' : ''}`, `${label} ${Math.round(n)}%`))
  }
  chip('5h', usage.five, 50, 80)
  chip('wk', usage.week, 50, 80)
  chip('ctx', usage.ctx, 70, 85)
  if (typeof usage.cost === 'number') chips.append(el('span', 'chip', `$${usage.cost.toFixed(2)} this session`))
  $('scrim').hidden = false
  sheet.hidden = false
}

function closeLayers() {
  $('drawer').classList.remove('open')
  $('sheet').hidden = true
  $('scrim').hidden = true
}

// ---- files and images, one page with two segments ----------------------------------------------
function fileRow(path, note, cls) {
  const row = el('div', 'file')
  // shown from the session's folder; the hub still gets the path it knows
  const shown = snap.cwd && path.startsWith(`${snap.cwd}/`) ? path.slice(snap.cwd.length + 1) : path
  row.append(el('span', 'path', shown), el('span', cls, note))
  row.onclick = () => showDiff(path)
  return row
}
// The files page: the session's folders to browse, what it holds in context, what changed, images.
const TABS = ['folder', 'context', 'changes', 'images']
let browse = { root: '', path: '' } // the folder shown in the Folder tab
const inContext = path => {
  const c = snap.context || {}
  return (c.mentions || []).includes(path) || (c.reads || []).includes(path)
}
// a path as the person knows it: from the folder it lies in
function shortPath(path) {
  for (const root of snap.roots || []) if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  return path.replace(/^\/Users\/[^/]+/, '~')
}
function renderFiles() {
  const counts = {
    folder: '',
    context: ((snap.context?.mentions?.length || 0) + (snap.context?.reads?.length || 0) + (snap.context?.dirs?.length || 0) + (snap.context?.memory?.length || 0)) || '',
    changes: snap.edited.length + snap.changes.length || '',
    images: snap.images.length || '',
  }
  for (const t of TABS) {
    const b = $(`seg-${t}`)
    b.classList.toggle('on', filesTab === t)
    b.textContent = `${t[0].toUpperCase()}${t.slice(1)} ${counts[t]}`.trim()
  }
  const root = $('files-body')
  root.replaceChildren()
  if (filesTab === 'folder') return renderFolder(root)
  if (filesTab === 'context') return renderContext(root)
  if (filesTab === 'images') return renderImages(root)
  renderChanges(root)
}

async function renderFolder(root) {
  const roots = snap.roots || []
  if (!roots.length) return root.append(el('div', 'none', 'This session names no folder.'))
  if (!roots.includes(browse.root)) browse = { root: roots[0], path: roots[0] }
  // the folders this session works in, when it has more than one
  if (roots.length > 1) {
    const chips = root.appendChild(el('div', 'roots'))
    for (const r of roots) {
      const b = chips.appendChild(el('button', `pick${r === browse.root ? ' on' : ''}`, r.split('/').pop() || r))
      b.onclick = () => { browse = { root: r, path: r }; renderFiles() }
    }
  }
  // the path from the root, each part a step back up
  const crumbs = root.appendChild(el('div', 'crumbs'))
  const parts = browse.path.slice(browse.root.length).split('/').filter(Boolean)
  const step = (label, path) => {
    const b = crumbs.appendChild(el('button', '', label))
    b.onclick = () => { browse.path = path; renderFiles() }
  }
  step(`/${browse.root.split('/').pop()}`, browse.root)
  parts.forEach((p, i) => {
    crumbs.append(icon('chevronRight'))
    step(p, `${browse.root}/${parts.slice(0, i + 1).join('/')}`)
  })
  const list = root.appendChild(el('div', 'card tree'))
  list.append(el('div', 'meta', 'Loading…'))
  const r = await api('tree', { path: browse.path })
  const data = r.b || {}
  list.replaceChildren()
  if (r.s !== 200) return list.append(el('div', 'none', data.error || 'Could not read the folder.'))
  if (!data.rows.length) return list.append(el('div', 'none', 'Empty folder.'))
  for (const row of data.rows) {
    const item = list.appendChild(el('button', `trow-file${row.isLocked ? ' locked' : ''}`))
    item.append(icon(row.isLocked ? 'lock' : row.isDir ? 'folder' : 'file'), el('span', 'fname', row.name))
    if (inContext(row.path)) item.append(el('span', 'ctxdot', 'in context'))
    if (!row.isDir) item.append(el('span', 'fsize', size(row.size)))
    item.onclick = () => {
      if (row.isLocked) return toast({ title: 'Locked', body: 'Secrets are not shown on the phone.' })
      if (row.isDir) {
        browse.path = row.path
        renderFiles()
      } else showFile(row.path)
    }
  }
}

function renderContext(root) {
  const c = snap.context || {}
  const group = (title, note, rows) => {
    const card = root.appendChild(el('div', 'card'))
    card.append(el('h3', '', title))
    if (!rows.length) card.append(el('div', 'meta pad', note))
    for (const row of rows) card.append(row)
  }
  const fileLine = (path, side, onclick) => {
    const row = el('div', 'file')
    row.append(el('span', 'path', shortPath(path)), el('span', 'ctx', side || ''))
    row.onclick = onclick || (() => showFile(path))
    return row
  }
  group('Mentioned with @', 'No file @-mentioned in a prompt yet.', [...(c.mentions || [])].reverse().map(p => fileLine(p)))
  group('Read by Claude', 'Claude has read no file yet.', [...(c.reads || [])].reverse().map(p => fileLine(p)))
  group('Folders added', 'No folder added with /add-dir.', (c.dirs || []).map(d => fileLine(d, 'browse', () => {
    browse = { root: d, path: d }
    filesTab = 'folder'
    renderFiles()
  })))
  group('Memory files', 'No memory file loaded.', (c.memory || []).map(m => fileLine(m.path, `${m.tokens} tok`)))
}

function renderChanges(root) {
  if (snap.edited.length) {
    const card = root.appendChild(el('div', 'card'))
    card.append(el('h3', '', 'Edited this turn'))
    for (const f of snap.edited) {
      const row = card.appendChild(fileRow(f.path, '', ''))
      row.lastChild.append(el('span', 'add', `+${f.added} `), el('span', 'del', `−${f.removed}`))
    }
  }
  if (snap.changes.length) {
    const card = root.appendChild(el('div', 'card'))
    card.append(el('h3', '', 'Changed in git'))
    for (const f of snap.changes) card.append(fileRow(f.path, f.code, 'ctx'))
  }
  if (!root.childElementCount) root.append(el('div', 'none', 'No changed files.'))
}

function renderImages(root) {
  if (!snap.images.length) return root.append(el('div', 'none', 'No images pasted in this session.'))
  const grid = root.appendChild(el('div', 'grid'))
  for (const img of snap.images) {
    const node = grid.appendChild(el('img'))
    node.loading = 'lazy'
    node.alt = `Image #${img.n}`
    void imageUrl('image', { n: img.n }, `${snap.id}:${img.n}`).then(url => { node.src = url })
    node.onclick = () => {
      const body = openViewer(`Image #${img.n}`)
      body.appendChild(el('img')).src = node.src
    }
  }
}

const size = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

// ---- one file: text with line numbers and syntax colors, an image, or a binary's size ----------
const LANGS = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', html: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', sql: 'sql', dockerfile: 'dockerfile', makefile: 'makefile', lua: 'lua', diff: 'diff' }
const HIGHLIGHT_MAX = 200 * 1024
let hljsLoading = null
// the highlighter is loaded the first time a file opens, from the hub
function loadHighlighter() {
  hljsLoading ??= new Promise(resolve => {
    const s = document.createElement('script')
    s.src = '/vendor/highlight.min.js'
    s.onload = () => resolve(window.hljs)
    s.onerror = () => resolve(null)
    document.head.append(s)
  })
  return hljsLoading
}
async function showFile(path) {
  const body = openViewer(shortPath(path))
  body.append(el('div', 'meta pad', 'Loading…'))
  const r = await api('file', { path })
  const data = r.b || {}
  body.replaceChildren()
  if (r.s !== 200) return body.append(el('div', 'none', data.error || 'Could not open the file.'))
  if (data.kind === 'image') {
    const img = body.appendChild(el('img'))
    img.src = await imageUrl('file', { path, raw: true })
    return
  }
  if (data.kind === 'binary') return body.append(el('div', 'none', `A binary file, ${size(data.size)}.`))
  const lines = data.text.replace(/\n$/, '').split('\n')
  body.append(el('div', 'meta pad', `${lines.length} lines · ${size(data.size)}${data.isCut ? ' · the first 512 KB' : ''}`))
  const code = body.appendChild(el('div', 'codeview'))
  code.append(el('pre', 'gutter', lines.map((_, i) => i + 1).join('\n')))
  const src = code.appendChild(el('pre', 'src'))
  const block = src.appendChild(el('code', 'hljs', lines.join('\n')))
  const name = data.name.toLowerCase()
  const lang = LANGS[data.ext] || LANGS[name]
  if (!lang || data.text.length > HIGHLIGHT_MAX) return
  const hljs = await loadHighlighter()
  if (!hljs || !hljs.getLanguage(lang)) return
  // highlight.js escapes the text it is given; its output holds only its own spans
  block.innerHTML = hljs.highlight(lines.join('\n'), { language: lang, ignoreIllegals: true }).value
}

function openViewer(title) {
  $('viewer-title').textContent = title
  const body = $('viewer-body')
  body.replaceChildren()
  $('viewer').hidden = false
  $('viewer').scrollTop = 0
  return body
}
async function showDiff(path) {
  const body = openViewer(path)
  const r = await api('diff', { path })
  const data = r.b || {}
  const diff = body.appendChild(el('div', 'diff'))
  const text = r.s === 200 ? data.diff || '(no changes against HEAD)' : data.error || 'Could not read the diff.'
  for (const line of text.split('\n')) {
    const cls = line.startsWith('+++') || line.startsWith('---') ? 'ctx' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : ''
    diff.append(el('div', cls, line || ' '))
  }
}

// ---- Claude's question: every question at once, then Submit ---------------------------------------
const answersOf = (questions, d) => {
  const answers = {}
  questions.forEach((q, i) => {
    const parts = [...(d.picks[i] || []), ...(d.other[i]?.trim() ? [d.other[i].trim()] : [])]
    if (parts.length) answers[q.question] = parts.join(', ')
  })
  return answers
}
function renderAsk() {
  const a = snap.ask
  const root = $('ask-body')
  root.replaceChildren()
  if (askDraft.id !== a.id) askDraft = { id: a.id, picks: {}, other: {} }
  const count = () => {
    const n = Object.keys(answersOf(a.questions, askDraft)).length
    $('ask-submit').textContent = `Submit ${n}/${a.questions.length}`
    $('ask-submit').disabled = !n
  }
  a.questions.forEach((q, i) => {
    const box = root.appendChild(el('div', 'q'))
    if (q.header) box.append(el('div', 'qh', q.header))
    box.append(el('div', 'qt', q.question))
    if (q.description) box.append(el('div', 'qd', q.description))
    const options = q.kind === 'text' || q.kind === 'number' ? [] : q.options || []
    const drawOptions = () => {
      for (const n of box.querySelectorAll('.opt, pre.preview')) n.remove()
      const anchor = box.querySelector('.other, .stepper')
      for (const o of options) {
        const isOn = (askDraft.picks[i] || []).includes(o.label)
        const row = el('button', `opt${isOn ? ' on' : ''}`)
        row.append(el('span', `mk${q.multiSelect ? ' box' : ''}`))
        const text = row.appendChild(el('div'))
        text.append(el('div', 'ol', o.label))
        if (o.description) text.append(el('div', 'od', o.description))
        row.onclick = () => {
          const now = askDraft.picks[i] || []
          askDraft.picks[i] = q.multiSelect ? (now.includes(o.label) ? now.filter(l => l !== o.label) : [...now, o.label]) : now[0] === o.label ? [] : [o.label]
          drawOptions()
          count()
        }
        box.insertBefore(row, anchor)
        if (isOn && o.preview) box.insertBefore(el('pre', 'preview', o.preview), anchor)
      }
    }
    if (q.kind === 'number') {
      const step = box.appendChild(el('div', 'stepper'))
      const val = el('span', 'val')
      const show = () => { val.textContent = `${askDraft.other[i] ?? q.defaultValue ?? q.min ?? 0}${q.unit ? ` ${q.unit}` : ''}` }
      const move = by => () => {
        const n = Number(askDraft.other[i] ?? q.defaultValue ?? q.min ?? 0) + by * (q.step || 1)
        askDraft.other[i] = String(Math.min(q.max ?? Infinity, Math.max(q.min ?? -Infinity, n)))
        show()
        count()
      }
      const dec = step.appendChild(el('button', '', '−')), inc = el('button', '', '+')
      dec.onclick = move(-1)
      inc.onclick = move(1)
      step.append(val, inc)
      show()
    } else {
      const other = box.appendChild(el('textarea', 'other'))
      other.rows = 2
      other.placeholder = q.kind === 'text' ? q.placeholder || 'Type your answer' : 'Other: type your own answer'
      other.value = askDraft.other[i] || ''
      other.oninput = () => {
        askDraft.other[i] = other.value
        count()
      }
    }
    drawOptions()
  })
  count()
}
function openAsk(isAsked) {
  if (!snap?.ask) return
  if (isAsked) askHiddenId = ''
  renderAsk()
  $('ask').hidden = false
}
async function sendAnswer(isDismissed) {
  const a = snap?.ask
  if (!a) return
  const answers = isDismissed ? {} : answersOf(a.questions, askDraft)
  $('ask-submit').disabled = true
  const r = await api('answer', { id: a.id, answers, isDismissed })
  const body = r.b || {}
  if (r.s !== 200) {
    $('ask-submit').disabled = false
    return toast({ title: 'Not sent', body: body.error || 'The session did not answer. Try again.' })
  }
  askHiddenId = a.id
  $('ask').hidden = true
  toast({ title: isDismissed ? 'Dismissed' : 'Answered', body: isDismissed ? 'Claude goes on without an answer.' : 'Claude has your answer.' })
}

// ---- one drawing for every update ----------------------------------------------------------------
function render() {
  snap = state.sessions.find(s => s.id === picked) || state.sessions[0] || null
  if (snap) picked = snap.id
  if ($('drawer').classList.contains('open')) renderDrawer()
  if (!snap) {
    $('title-text').textContent = 'Claude'
    $('dot').className = 'dot'
    $('files-badge').hidden = true
    $('chat').replaceChildren(el('div', 'empty', 'No Claude Code session has the remote on now.'))
    return
  }
  // the chat sticks to its newest line, as a terminal does, unless you scrolled up to read
  const isFollowing = isFirstDraw || atBottom() || shownId !== snap.id
  shownId = snap.id
  renderHeader()
  renderChat()
  // the folder tab stays as it is (no listing read again under the reader); the others follow the session
  if (!$('files').hidden && filesTab !== 'folder') renderFiles()
  // a new question opens its page; one answered elsewhere closes it
  if (snap.ask && snap.ask.id !== askHiddenId && $('ask').hidden) openAsk(false)
  else if (snap.ask && !$('ask').hidden && askDraft.id !== snap.ask.id) renderAsk()
  if (!snap.ask && !$('ask').hidden) {
    $('ask').hidden = true
    toast({ title: 'Answered', body: 'The question was answered on the Mac.' })
  }
  if (isFollowing) toBottom()
  else $('jump').hidden = false
  isFirstDraw = false
}

function toast(n) {
  const t = el('div', 'toast')
  t.append(el('strong', '', n.title), el('div', 'meta', n.body))
  document.body.append(t)
  setTimeout(() => t.remove(), 5000)
}

// ---- controls ----------------------------------------------------------------------------------
$('open-drawer').onclick = openDrawer
$('title').onclick = openSheet
$('scrim').onclick = closeLayers
$('open-files').onclick = () => {
  if (!snap) return
  renderFiles()
  $('files').hidden = false
}
$('close-files').onclick = () => { $('files').hidden = true }
$('close-viewer').onclick = () => { $('viewer').hidden = true }
$('close-ask').onclick = () => {
  askHiddenId = snap?.ask?.id || ''
  $('ask').hidden = true
}
$('ask-submit').onclick = () => sendAnswer(false)
$('ask-dismiss').onclick = () => sendAnswer(true)
for (const t of TABS)
  $(`seg-${t}`).onclick = () => {
    filesTab = t
    renderFiles()
  }
window.addEventListener('scroll', () => { if (atBottom()) $('jump').hidden = true }, { passive: true })
$('jump').onclick = () => {
  toBottom()
  $('jump').hidden = true
}

// unpairing takes a second press within 4 seconds; no browser dialog
let unpairArmedAt = 0
$('unpair').onclick = async () => {
  if (Date.now() - unpairArmedAt > 4000) {
    unpairArmedAt = Date.now()
    $('unpair').textContent = 'Press again to unpair'
    $('unpair').classList.add('warn')
    setTimeout(() => {
      $('unpair').textContent = 'Unpair this phone'
      $('unpair').classList.remove('warn')
    }, 4000)
    return
  }
  await E2E.call('forget').catch(() => undefined)
  await E2E.forget()
  closeLayers()
  gate('This phone is unpaired. Scan the QR code in the terminal to pair it again.')
}

const text = $('text')
// The on-screen keyboard: Chrome on Android resizes the page for it (interactive-widget in the
// viewport meta); Safari on iOS does not, so the reply box is lifted by what the keyboard covers.
const vv = window.visualViewport
function fitKeyboard() {
  const covered = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
  document.documentElement.style.setProperty('--kb', `${covered}px`)
}
if (vv) {
  vv.addEventListener('resize', fitKeyboard)
  vv.addEventListener('scroll', fitKeyboard)
}
// the keyboard takes a moment to come up: then the box is measured again and brought into view
text.addEventListener('focus', () => setTimeout(() => {
  fitKeyboard()
  text.scrollIntoView({ block: 'nearest' })
}, 300))
text.addEventListener('blur', () => setTimeout(fitKeyboard, 150))

// grows with what is typed, up to 160px; only then does it scroll
function fitText() {
  text.style.height = '42px'
  const h = Math.max(42, text.scrollHeight + 2)
  text.style.height = `${Math.min(h, 160)}px`
  text.style.overflowY = h > 160 ? 'auto' : 'hidden'
}
text.addEventListener('input', fitText)
$('send').onclick = async () => {
  const value = text.value.trim()
  if (!value || !snap) return
  $('send').disabled = true
  const r = await api('reply', { text: value })
  $('send').disabled = false
  const body = r.b || {}
  if (r.s !== 200) return toast({ title: 'Not sent', body: body.error || 'The session did not answer. Try again.' })
  text.value = ''
  fitText()
  toBottom()
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
  let isSubscribed = false
  try { isSubscribed = localStorage.getItem('qsb-sub') === location.host } catch {}
  btn.hidden = Notification.permission === 'granted' && isSubscribed
  btn.onclick = subscribe
  if (Notification.permission === 'granted') subscribe().catch(() => undefined)
}
async function subscribe() {
  if ((await Notification.requestPermission()) !== 'granted') return toast({ title: 'Notifications off', body: 'Allow them in the browser settings to hear when Claude finishes.' })
  const reg = await navigator.serviceWorker.ready
  const { key } = (await E2E.call('vapid')).b
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const old = await reg.pushManager.getSubscription()
  if (old) await old.unsubscribe()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
  const r = await E2E.call('subscribe', { sub: sub.toJSON() })
  if (r.s === 200) {
    try { localStorage.setItem('qsb-sub', location.host) } catch {}
    $('notify').hidden = true
    toast({ title: 'Notifications on', body: 'You will hear when Claude finishes or needs you.' })
  }
}

function boot() {
  pair()
    .then(() => {
      void follow()
      setupNotify()
    })
    .catch(() => undefined)
}
// a home-screen app has storage of its own and no camera on the link: its link is pasted here
$('gate-go').onclick = () => {
  const hash = /#k=[\w-]+/.exec($('gate-link').value)?.[0]
  if (!hash) return toast({ title: 'Not a link', body: 'Paste the whole link the terminal shows (⇄, then c).' })
  location.hash = hash
  boot()
}
boot()
