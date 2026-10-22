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
let filesTab = 'files'
const opened = new Set() // the tool rows opened to their output
// the question Claude waits on: what this phone picked and typed so far, and whether it was put away
let askDraft = { id: '', picks: {}, other: {} }
let askHiddenId = ''
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
function renderFiles() {
  $('seg-files').classList.toggle('on', filesTab === 'files')
  $('seg-images').classList.toggle('on', filesTab === 'images')
  $('seg-files').textContent = `Files ${snap.edited.length + snap.changes.length || ''}`.trim()
  $('seg-images').textContent = `Images ${snap.images.length || ''}`.trim()
  const root = $('files-body')
  root.replaceChildren()
  if (filesTab === 'images') {
    if (!snap.images.length) return root.append(el('div', 'none', 'No images pasted in this session.'))
    const grid = root.appendChild(el('div', 'grid'))
    for (const img of snap.images) {
      const node = grid.appendChild(el('img'))
      node.loading = 'lazy'
      node.alt = `Image #${img.n}`
      node.src = q('/api/image', `&n=${img.n}`)
      node.onclick = () => {
        const body = openViewer(`Image #${img.n}`)
        body.appendChild(el('img')).src = node.src
      }
    }
    return
  }
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
  const r = await fetch(q('/api/diff', `&path=${encodeURIComponent(path)}`))
  const data = await r.json().catch(() => ({}))
  const diff = body.appendChild(el('div', 'diff'))
  const text = r.ok ? data.diff || '(no changes against HEAD)' : data.error || 'Could not read the diff.'
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
  const r = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: snap.id, id: a.id, answers, isDismissed }) }).catch(() => undefined)
  const body = r ? await r.json().catch(() => ({})) : {}
  if (!r || !r.ok) {
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
  if (!$('files').hidden) renderFiles()
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
$('seg-files').onclick = () => { filesTab = 'files'; renderFiles() }
$('seg-images').onclick = () => { filesTab = 'images'; renderFiles() }
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
  await fetch('/api/forget', { method: 'POST' }).catch(() => undefined)
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
  const r = await fetch('/api/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: value, session: snap.id }) }).catch(() => undefined)
  $('send').disabled = false
  const body = r ? await r.json().catch(() => ({})) : {}
  if (!r || !r.ok) return toast({ title: 'Not sent', body: body.error || 'The session did not answer. Try again.' })
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
