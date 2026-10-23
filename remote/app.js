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
  plus: 'M12 5v14M5 12h14',
  chevronUp: 'M6 15l6-6 6 6',
  quote: 'M7 17c-2 0-3-1.5-3-3.5C4 10 6.5 7 10 6v2c-2 .7-3 2-3 3.5h3V17H7zm9 0c-2 0-3-1.5-3-3.5 0-3.5 2.5-6.5 6-7.5v2c-2 .7-3 2-3 3.5h3V17h-3z',
  close: 'M6 6l12 12M18 6L6 18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 12h17M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  key: 'M14.5 4a5.5 5.5 0 1 1-4.2 9L4 19.3V21h3v-2h2v-2h2l.7-.7A5.5 5.5 0 0 1 14.5 4zM16 8.5h.01',
  slash: 'M16 3L8 21',
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
// the Folder tab picks a file for the reply (the + menu's Browse project file) instead of opening it
let isPicking = false
let lastVaultAt = 0
const opened = new Set() // the tool rows opened to their output
// the question Claude waits on: what this phone picked and typed so far, and whether it was put away
let askDraft = { id: '', picks: {}, other: {} }
let askHiddenId = ''
try { picked = localStorage.getItem('qsb-session') || '' } catch {}
// a push notification opened with the app shut: /?s=<session> picks the session it came from
const openedFor = new URLSearchParams(location.search).get('s')
if (openedFor) {
  picked = openedFor
  history.replaceState(null, '', '/')
}
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
      gate('In the terminal, pick this code.', code)
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
      gate('In the terminal, pick this code.', r.b.code, false, r.b.secondsLeft)
      await sleep(2000)
      continue
    }
    await E2E.forget()
    gate(r.b.error || 'Refused in the terminal.', '', true)
    throw new Error('refused')
  }
}
// `secondsLeft`: how long the request still waits for Allow (a minute in all); counted down here
// between the hub's answers, and the request is over when it reaches 0
let pairUntil = 0
let pairTimer = 0
function gate(text, code, canPaste, secondsLeft) {
  $('gate-text').textContent = text
  $('gate-code').textContent = code || ''
  $('gate-code').hidden = !code
  $('gate-paste').hidden = !canPaste
  $('gate').hidden = false
  $('app').hidden = true
  pairUntil = code && typeof secondsLeft === 'number' ? Date.now() + secondsLeft * 1000 : 0
  clearInterval(pairTimer)
  showPairLeft()
  if (pairUntil) pairTimer = setInterval(showPairLeft, 500)
}
function showPairLeft() {
  const left = Math.max(0, Math.ceil((pairUntil - Date.now()) / 1000))
  $('gate-left').hidden = !pairUntil
  $('gate-left').textContent = left ? `Allow it within ${left} s` : 'Checking…'
  $('gate-left').classList.toggle('low', left > 0 && left <= 15)
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
    noteUnread()
    if (state.notice.at > lastNotice) {
      const from = state.notice.session
      if (lastNotice) toast(state.notice, from ? () => openSession(from) : undefined)
      lastNotice = state.notice.at
    }
    $('gate').hidden = true
    $('app').hidden = false
    clearInterval(pairTimer)
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
// your words in a bubble: a fenced block (```) drawn as a code block, as in Claude's bubbles, and
// each [Image #n] pasted with them a link that opens the picture here
const FENCED = /(?:^|\n)[ \t]*```[^\n]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/
function prompted(text, into) {
  // split keeps the captured code at the odd places
  String(text).split(FENCED).forEach((part, i) => {
    if (i % 2) into.append(el('pre', '', part))
    else if (part.replace(/^\n+|\n+$/g, '')) promptedText(part.replace(/^\n+|\n+$/g, ''), into)
  })
  return into
}
function promptedText(text, into) {
  let at = 0
  for (const m of text.matchAll(/\[Image #(\d+)\]/g)) {
    const img = (snap.images || []).find(i => String(i.n) === m[1])
    if (!img) continue
    if (m.index > at) inline(text.slice(at, m.index), into)
    const a = into.appendChild(el('a', 'imglink', m[0]))
    a.href = '#'
    a.onclick = ev => {
      ev.preventDefault()
      const body = openViewer(`Image #${img.n}`)
      void imageUrl('image', { n: img.n }, `${snap.id}:${img.n}`).then(url => {
        if (url) body.appendChild(el('img')).src = url
        else body.append(el('div', 'none', 'This image is no longer on the computer.'))
      })
    }
    at = m.index + m[0].length
  }
  if (at < text.length) inline(text.slice(at), into)
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
      const lang = /^\s*```\s*([\w+#.-]+)/.exec(line)?.[1]?.toLowerCase()
      const code = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i])
      i++
      const pre = box.appendChild(el('pre', '', code.join('\n')))
      // its language, for highlightChat
      if (lang) pre.dataset.lang = lang
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
  // a tool still running is drawn brighter than those done
  const row = into.appendChild(el('div', `trow${isOpen ? ' open' : ''}${t.out === undefined ? ' running' : ''}`))
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
    // a command sent from here: its bubble, and what it printed or why it did not run
    if (t.k === 'cmd') {
      tools = null
      root.append(prompted(t.command, el('div', 'b me')))
      root.append(el('pre', `cmdout${t.isError ? ' bad' : ''}`, t.text))
      continue
    }
    if (t.k === 'more') {
      tools = null
      root.append(el('div', 'more-tools', `… ${t.n} earlier tool call${t.n === 1 ? '' : 's'}`))
      continue
    }
    if (t.k === 'tool') {
      tools ??= root.appendChild(el('div', 'tools'))
      toolRow(t, tools)
      continue
    }
    tools = null
    if (t.k === 'user') {
      const b = root.appendChild(prompted(t.text, el('div', 'b me')))
      bubbleText.set(b, t.text)
    }
    else {
      const b = root.appendChild(el('div', 'b claude'))
      b.append(markdown(t.text))
      bubbleText.set(b, t.text)
    }
  }
  // under Claude's last answer: Claude Code's guess at your next prompt, else what Haiku
  // proposes, three at most; a tap puts it in the reply box (chipToBox)
  const chips = snap.busy ? [] : snap.suggestions || []
  if (chips.length) {
    const row = root.appendChild(el('div', 'suggests'))
    for (const s of chips) {
      const chip = row.appendChild(el('button', 'suggest'))
      chip.append(icon('spark'), el('span', '', s))
      chip.onclick = () => chipToBox(s)
    }
  }
  // sent as the prompt, not in the transcript yet: drawn as the bubble it will be
  for (const text of snap.sending || []) bubbleText.set(root.appendChild(prompted(text, el('div', 'b me'))), text)
  // waiting for a turn to end, dimmed; with none running it goes in at the next tick, a bubble as any
  for (const text of snap.queued || []) {
    const b = root.appendChild(prompted(text, el('div', snap.busy ? 'b me queued' : 'b me')))
    bubbleText.set(b, text)
    if (!snap.busy) continue
    b.append(el('span', 'note', 'waits for this turn to end'))
    // ✕ takes it back before it goes in; gone at once here, and from the session at its next call
    const x = b.appendChild(el('button', 'unq', '✕'))
    x.setAttribute('aria-label', 'Take back')
    x.onclick = async e => {
      e.stopPropagation()
      b.remove()
      const r = await api('unqueue', { text })
      if (r.s !== 200) toast({ title: 'Not taken back', body: r.b?.error || 'The session did not answer. Try again.' })
    }
  }
  if (snap.ask) {
    // the question, as a bubble that opens its page again
    const b = root.appendChild(el('div', 'b claude ask'))
    b.append(el('div', 'qt', snap.ask.questions[0]?.question || 'Claude asks you'))
    if (snap.ask.questions.length > 1) b.append(el('div', 'meta', `and ${snap.ask.questions.length - 1} more`))
    b.append(el('div', 'go', 'Answer'))
    b.onclick = () => openAsk(true)
  }
  // a permission prompt waiting at the computer: what it would run and why it asks; no buttons,
  // since an organization's policy may not let a plugin answer one
  for (const p of snap.permissions || []) {
    const b = root.appendChild(el('div', 'b claude ask perm'))
    b.append(el('div', 'qt', `Claude asks to use ${p.tool}`))
    b.append(el('pre', 'call', p.text))
    if (p.reason) b.append(el('div', 'meta', p.reason))
    b.append(el('div', 'go', 'Answer it at the computer'))
  }
  if (snap.busy) {
    // the task list first, the Working line last: it stays just above the box (the tool running is
    // the chat's own last tool line, drawn brighter)
    const w = root.appendChild(el('div', 'working'))
    for (const t of snap.tasks || []) {
      const row = w.appendChild(el('div', `task ${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : ''}`))
      row.append(icon(t.status === 'completed' ? 'boxChecked' : 'box'), el('span', '', t.subject))
    }
    const head = w.appendChild(el('div', 'head'))
    head.appendChild(el('span', 'spin')).append(icon('spark'))
    head.append(el('span', '', 'Working…'), el('span', 'elapsed', ''))
    // Stop, after the time worked: a round button with a solid square; the turn ends as Esc ends it
    const stop = head.appendChild(el('button', 'stop'))
    stop.setAttribute('aria-label', 'Stop this turn')
    stop.append(el('span', 'sq'))
    stop.onclick = async () => {
      stop.disabled = true
      const r = await api('stop', { session: snap.id })
      toast(r.s === 200 ? { title: 'Stopping', body: 'The session ends its turn in a moment.' } : { title: 'Not stopped', body: r.b?.error || 'The session did not answer. Try again.' })
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

// Sessions that ended a turn while another was shown: marked in the drawer, and on its button, until
// opened.
const unread = new Set(), wasBusy = new Map()
function noteUnread() {
  for (const s of state.sessions) {
    if (wasBusy.get(s.id) && !s.busy && s.id !== picked) unread.add(s.id)
    wasBusy.set(s.id, Boolean(s.busy))
  }
  for (const id of unread) if (!state.sessions.some(s => s.id === id)) unread.delete(id)
  $('open-drawer').classList.toggle('unread', unread.size > 0)
}

// Code blocks in the chat whose fence names a language, coloured with the file viewer's
// highlight.js; each colouring kept, as the chat is drawn again at every change.
const highlighted = new Map() // `${language}\n${code}` -> highlight.js's output
async function highlightChat() {
  const blocks = [...document.querySelectorAll('#chat pre[data-lang]:not(.hl)')]
  if (!blocks.length) return
  const hljs = await loadHighlighter()
  if (!hljs) return
  for (const pre of blocks) {
    const lang = LANGS[pre.dataset.lang] || (hljs.getLanguage(pre.dataset.lang) ? pre.dataset.lang : '')
    if (!lang || !pre.isConnected || pre.textContent.length > HIGHLIGHT_MAX) continue
    const key = `${lang}\n${pre.textContent}`
    if (!highlighted.has(key)) {
      if (highlighted.size > 300) highlighted.clear()
      highlighted.set(key, hljs.highlight(pre.textContent, { language: lang, ignoreIllegals: true }).value)
    }
    // highlight.js escapes the text it is given; its output holds only its own spans
    const code = el('code', 'hljs')
    code.innerHTML = highlighted.get(key)
    pre.replaceChildren(code)
    pre.classList.add('hl')
  }
}

function renderDrawer() {
  const box = $('sessions')
  box.replaceChildren()
  if (!state.sessions.length) box.append(el('div', 'meta', 'No session has the remote on now.'))
  for (const s of state.sessions) {
    const row = box.appendChild(el('button', `srow${s.id === picked ? ' on' : ''}`))
    // orange: a question or a permission prompt waits for you there
    const isWaiting = Boolean(s.ask) || (s.permissions || []).length > 0
    row.append(el('span', isWaiting ? 'dot wait' : s.busy ? 'dot busy' : 'dot'))
    const text = row.appendChild(el('div'))
    const sub = el('div', 'sub')
    if (s.branch) sub.append(icon('branch'), document.createTextNode(` ${s.branch} · `))
    sub.append(document.createTextNode(s.busy ? 'working' : 'idle'))
    text.append(el('div', unread.has(s.id) ? 'name unread' : 'name', titleOf(s)))
    // the session's title (its /rename name, else Claude Code's), above its branch
    if (s.title) text.append(el('div', 'desc', s.title))
    text.append(sub)
    row.onclick = () => openSession(s.id)
  }
}
function openDrawer() {
  renderDrawer()
  // the mod's version, as the session picked loaded it (each session may run its own)
  const v = (state.sessions.find(s => s.id === picked) || state.sessions[0])?.version
  $('version').textContent = v ? `v${v}` : ''
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
  // the home folder written as ~
  if (snap.cwd) sheet.append(el('div', 'meta', snap.home && (snap.cwd === snap.home || snap.cwd.startsWith(`${snap.home}/`)) ? `~${snap.cwd.slice(snap.home.length)}` : snap.cwd))
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

// <html> carries `layered` while a layer is open: the drawer, a sheet or a page (app.html's styles
// keep the chat still under it). Watched rather than set at each opening: layers open in many places.
function syncLayered() {
  const isOpen = Boolean(document.querySelector('.drawer.open, .sheet:not([hidden]), .page:not([hidden])'))
  document.documentElement.classList.toggle('layered', isOpen)
}
new MutationObserver(syncLayered).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] })

// ---- gestures on a bubble, Claude's or yours -------------------------------------------------
// A swipe toward the middle (right on Claude's, left on yours) quotes it in the reply box: the
// bubble follows the finger, and past SWIPE_PX on letting go the quote card shows over the box. A
// move more up or down than across is a scroll. Held DIM_AFTER_MS it starts to dim, and at
// HOLD_TO_COPY_MS it is copied: on a code block, that block; elsewhere, the bubble's text as written.
const bubbleText = new WeakMap() // a bubble -> its text as Claude or you wrote it
const SWIPE_PX = 64, DIM_AFTER_MS = 500, HOLD_TO_COPY_MS = 1500
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // no clipboard API (an older browser, a page not in focus): a hidden box and the copy command
    const box = document.body.appendChild(el('textarea'))
    box.value = value
    box.style.cssText = 'position:fixed;opacity:0;top:0'
    box.select()
    const isDone = document.execCommand('copy')
    box.remove()
    return isDone
  }
}
{
  let bubble = null, target = null, x0 = 0, y0 = 0, dx = 0, isAcross = false, dimTimer = 0, copyTimer = 0
  const stopHold = () => {
    clearTimeout(dimTimer)
    clearTimeout(copyTimer)
    dimTimer = copyTimer = 0
    target?.classList.remove('copying')
  }
  $('chat').addEventListener('pointerdown', e => {
    bubble = e.target.closest('.b.claude, .b.me')
    if (!bubble || !bubbleText.has(bubble) || e.target.closest('button, a')) return (bubble = null)
    const block = e.target.closest('pre')
    target = block && bubble.contains(block) ? block : bubble
    x0 = e.clientX
    y0 = e.clientY
    dx = 0
    isAcross = false
    const held = target, from = bubble
    dimTimer = setTimeout(() => held.classList.add('copying'), DIM_AFTER_MS)
    copyTimer = setTimeout(async () => {
      copyTimer = 0
      const isBlock = held !== from
      const isCopied = await copyText(isBlock ? held.textContent : bubbleText.get(from))
      held.classList.remove('copying')
      navigator.vibrate?.(15)
      toast(isCopied ? { title: 'Copied', body: isBlock ? 'The code block' : from.classList.contains('me') ? 'Your message' : 'The whole answer' } : { title: 'Not copied', body: 'The browser refused the clipboard.' })
    }, HOLD_TO_COPY_MS)
  })
  $('chat').addEventListener('pointermove', e => {
    if (!bubble) return
    const mx = e.clientX - x0, my = e.clientY - y0
    if (Math.hypot(mx, my) > 10) stopHold()
    if (!isAcross && Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return (bubble = null)
    // toward the middle: right for Claude's, left for yours
    const toward = bubble.classList.contains('me') ? -mx : mx
    if (toward > 10) isAcross = true
    if (!isAcross) return
    dx = Math.max(0, toward)
    const shift = Math.min(dx, SWIPE_PX + 24) * (bubble.classList.contains('me') ? -1 : 1)
    bubble.style.transition = 'none'
    bubble.style.transform = `translateX(${shift}px)`
    bubble.classList.toggle('quoting', dx > SWIPE_PX)
  })
  const end = () => {
    stopHold()
    if (!bubble) return
    const b = bubble
    bubble = null
    b.style.transition = 'transform .15s ease'
    b.style.transform = ''
    b.classList.remove('quoting')
    if (!isAcross || dx <= SWIPE_PX) return
    setQuote(b.classList.contains('me') ? 'You' : 'Claude', bubbleText.get(b))
    navigator.vibrate?.(10)
  }
  $('chat').addEventListener('pointerup', end)
  $('chat').addEventListener('pointercancel', end)
  // a long press is the copy: no menu, no selection
  $('chat').addEventListener('contextmenu', e => { if (e.target.closest('.b.claude, .b.me')) e.preventDefault() })
}

// The quote over the reply box: who wrote it and its first two lines, ✕ to drop it. It goes before
// the reply as "> " lines (its first QUOTE_MAX characters), a blank line, then what you wrote.
const QUOTE_MAX = 600
let quoted = null // { who, text }
function setQuote(who, text) {
  quoted = { who, text }
  $('quote-who').textContent = who
  $('quote-text').textContent = text
  $('quote').hidden = false
  $('text').focus()
  fitFoot()
}
function dropQuote() {
  quoted = null
  $('quote').hidden = true
  fitFoot()
}
function withQuote(value) {
  if (!quoted) return value
  const cut = quoted.text.length > QUOTE_MAX ? `${quoted.text.slice(0, QUOTE_MAX)}…` : quoted.text
  return `${cut.split('\n').map(l => `> ${l}`).join('\n')}\n\n${value}`
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
  if (filesQuery.length >= 2) return renderSearch(root)
  if (filesTab === 'folder') return renderFolder(root)
  if (filesTab === 'context') return renderContext(root)
  if (filesTab === 'images') return renderImages(root)
  renderChanges(root)
}

// The search at the head of the page: the session's folders by file name and by content, through
// the hub (locked paths never in the results). A name opens the file, a line opens it at that line;
// while picking a file for the reply, a name picks it.
let filesQuery = '', searchRound = 0
// `text` into `into`, each place holding `q` (any case) in a <mark>
function marked(text, q, into) {
  const low = text.toLowerCase(), find = q.toLowerCase()
  let at = 0
  for (let i = low.indexOf(find); find && i >= 0; i = low.indexOf(find, at)) {
    if (i > at) into.append(document.createTextNode(text.slice(at, i)))
    into.append(el('mark', '', text.slice(i, i + find.length)))
    at = i + find.length
  }
  if (at < text.length) into.append(document.createTextNode(text.slice(at)))
  return into
}
async function renderSearch(root) {
  const round = ++searchRound
  root.append(el('div', 'meta pad', 'Searching…'))
  const r = await api('search', { query: filesQuery })
  if (round !== searchRound) return
  root.replaceChildren()
  const data = r.b || {}
  if (r.s !== 200) return root.append(el('div', 'none', data.error || 'Could not search.'))
  if (!data.names.length && !data.hits.length) return root.append(el('div', 'none', `Nothing holds "${filesQuery}".`))
  const group = (title, rows) => {
    if (!rows.length) return
    root.append(el('div', 'sgroup', title))
    const card = root.appendChild(el('div', 'card tree'))
    for (const row of rows) card.append(row)
  }
  group(`Files ${data.names.length}`, data.names.map(f => {
    const b = el('button', 'shit')
    b.append(marked(f.rel, filesQuery, el('span')))
    b.onclick = () => (isPicking ? pickFile(f.path) : showFile(f.path))
    return b
  }))
  group(`In files ${data.hits.length}`, data.hits.map(h => {
    const b = el('button', 'shit')
    b.append(el('span', 'at', `${h.rel}:${h.line}`), marked(h.text, filesQuery, el('span', 'line')))
    b.onclick = () => showFile(h.path, h.line)
    return b
  }))
  if (data.isCut) root.append(el('div', 'meta pad', 'More match: search for something longer.'))
}

async function renderFolder(root) {
  if (isPicking) root.append(el('div', 'pickbar', 'Pick a file to mention in your reply'))
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
  // a folder in a git repository: its branch after the path
  if (data.branch) crumbs.appendChild(el('span', 'fbranch')).append(icon('branch'), document.createTextNode(` ${data.branch}`))
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
      } else if (isPicking) pickFile(row.path)
      else showFile(row.path)
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
// `atLine`: the line a search found, marked and scrolled to
async function showFile(path, atLine) {
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
  const gutter = code.appendChild(el('pre', 'gutter', lines.map((_, i) => i + 1).join('\n')))
  // a tap on a line number marks that line and opens a box under the file to ask Claude about it;
  // a tap on another number then marks the range between them
  const mark = code.appendChild(el('div', 'linemark'))
  mark.hidden = true
  let picked = null
  gutter.onclick = e => {
    const style = getComputedStyle(gutter)
    const lh = parseFloat(style.lineHeight) || 18, pad = parseFloat(style.paddingTop) || 0
    const n = LineAsk.lineAt(e.offsetY, pad, lh, lines.length)
    // the box shut: the next tap starts afresh
    if (!body.querySelector('.lineask')) picked = null
    picked = LineAsk.pickLines(picked, n)
    mark.hidden = false
    mark.style.top = `${pad + (picked.from - 1) * lh}px`
    mark.style.height = `${(picked.to - picked.from + 1) * lh}px`
    openLineAsk(body, path, picked, lines.slice(picked.from - 1, picked.to).join('\n'))
  }
  const src = code.appendChild(el('pre', 'src'))
  const block = src.appendChild(el('code', 'hljs', lines.join('\n')))
  // find in the file: each line holding the text (any case) marked, the current one stronger;
  // Enter or ↓ goes to the next, ↑ to the one before
  const finder = el('div', 'finder')
  body.insertBefore(finder, code)
  const field = finder.appendChild(el('div', 'field'))
  const q = field.appendChild(el('input'))
  q.type = 'text'
  q.enterKeyHint = 'search'
  q.placeholder = 'Find in this file'
  const clear = field.appendChild(el('button', 'clear'))
  clear.setAttribute('aria-label', 'Clear')
  clear.append(icon('close'))
  clear.hidden = true
  clear.onclick = () => {
    q.value = ''
    q.oninput()
    q.focus()
  }
  const count = finder.appendChild(el('span', 'count'))
  const up = finder.appendChild(el('button', 'icon'))
  up.setAttribute('aria-label', 'Previous match')
  up.append(icon('arrowUp'))
  const down = finder.appendChild(el('button', 'icon'))
  down.setAttribute('aria-label', 'Next match')
  down.append(icon('arrowDown'))
  const hits = code.appendChild(el('div', 'hits'))
  let found = [], at = 0
  const show = () => {
    hits.replaceChildren()
    const style = getComputedStyle(gutter)
    const lh = parseFloat(style.lineHeight) || 18, pad = parseFloat(style.paddingTop) || 0
    found.slice(0, 500).forEach((n, i) => {
      const m = hits.appendChild(el('div', i === at ? 'hit on' : 'hit'))
      m.style.top = `${pad + (n - 1) * lh}px`
      m.style.height = `${lh}px`
    })
    count.textContent = q.value.trim() ? (found.length ? `${at + 1}/${found.length}` : 'none') : ''
    if (found.length) $('viewer').scrollTo({ top: Math.max(0, code.offsetTop + pad + (found[at] - 1) * lh - 140), behavior: 'smooth' })
  }
  q.oninput = () => {
    clear.hidden = !q.value
    const t = q.value.trim().toLowerCase()
    found = t ? lines.flatMap((l, i) => (l.toLowerCase().includes(t) ? [i + 1] : [])) : []
    at = 0
    show()
  }
  const step = by => {
    if (!found.length) return
    at = (at + by + found.length) % found.length
    show()
  }
  up.onclick = () => step(-1)
  down.onclick = () => step(1)
  q.onkeydown = e => { if (e.key === 'Enter') step(1) }
  if (atLine) {
    found = [atLine]
    show()
  }
  const name = data.name.toLowerCase()
  const lang = LANGS[data.ext] || LANGS[name]
  if (!lang || data.text.length > HIGHLIGHT_MAX) return
  const hljs = await loadHighlighter()
  if (!hljs || !hljs.getLanguage(lang)) return
  // highlight.js escapes the text it is given; its output holds only its own spans
  block.innerHTML = hljs.highlight(lines.join('\n'), { language: lang, ignoreIllegals: true }).value
}

// The box under a file for asking Claude about a line or a range: the file as @path, the lines'
// numbers and text, then what you wrote, sent as your prompt. Its status follows the session: sent,
// working, waiting for the turn before it, done (render calls tickLineAsk on each state).
let lineAsk = null // { session, status, sawBusy }
function openLineAsk(body, path, picked, linesText) {
  let bar = body.querySelector('.lineask')
  if (!bar) {
    // the same frame as the reply area: the box the whole width, the status and send under it
    bar = body.appendChild(el('div', 'lineask'))
    const frame = el('div', 'composer')
    const head = el('div', 'head')
    // ✕ shuts the box and unmarks the line; a prompt already sent goes on
    const shut = el('button', 'icon close')
    shut.setAttribute('aria-label', 'Close')
    shut.append(icon('close'))
    shut.onclick = () => {
      bar.remove()
      const mark = body.querySelector('.linemark')
      if (mark) mark.hidden = true
      lineAsk = null
    }
    head.append(el('div', 'what'), shut)
    bar.append(head, frame)
    const box = frame.appendChild(el('textarea'))
    box.rows = 1
    // grows with what is typed, up to 160px, as the reply box does
    box.oninput = () => {
      box.style.height = '24px'
      const h = Math.max(24, box.scrollHeight)
      box.style.height = `${Math.min(h, 160)}px`
      box.style.overflowY = h > 160 ? 'auto' : 'hidden'
    }
    const row = frame.appendChild(el('div', 'tools-row'))
    row.append(el('div', 'status'))
    const go = row.appendChild(el('button', 'send'))
    go.setAttribute('aria-label', 'Send')
    go.append(icon('arrowUp'))
    go.onclick = async () => {
      const ask = box.value.trim()
      if (!ask || !snap) return box.focus()
      const at = bar.dataset
      const text = LineAsk.lineAskText(mentionOf(at.path), Number(at.from), Number(at.to), bar.picked, ask)
      go.disabled = true
      lineAsk = { session: snap.id, status: 'sending', sawBusy: false, wasBusy: Boolean(snap.busy) }
      tickLineAsk()
      const r = await api('reply', { text })
      go.disabled = false
      if (r.s !== 200) {
        lineAsk = null
        bar.querySelector('.status').replaceChildren(el('span', 'err', r.b?.error || 'Not sent: the session did not answer. Try again.'))
        return
      }
      box.value = ''
      box.oninput()
      lineAsk.status = 'sent'
      tickLineAsk()
    }
  }
  Object.assign(bar.dataset, { path, from: String(picked.from), to: String(picked.to) })
  // the lines' text, kept on the element: a range may be long for an attribute
  bar.picked = linesText
  const label = LineAsk.linesLabel(picked.from, picked.to)
  const what = bar.querySelector('.what')
  what.textContent = `${label[0].toUpperCase()}${label.slice(1)} · ${shortPath(path)}`
  if (picked.from === picked.to) what.append(el('span', 'hint', ' · tap another number for a range'))
  const box = bar.querySelector('textarea')
  box.placeholder = `Ask Claude about ${label}`
  box.focus()
}
function tickLineAsk() {
  const node = document.querySelector('#viewer:not([hidden]) .lineask .status')
  if (!lineAsk || !node) return
  const s = state?.sessions.find(x => x.id === lineAsk.session)
  const working = label => {
    const row = el('span', 'busy')
    row.append(el('span', 'spin'), document.createTextNode(label))
    row.querySelector('.spin').append(icon('spark'))
    return row
  }
  const phase = LineAsk.lineAskPhase(lineAsk, Boolean(s?.busy))
  if (phase === 'sending') return node.replaceChildren(working(' Sending…'))
  if (phase === 'waits') return node.replaceChildren(working(' Waits for the turn before it to end…'))
  if (phase === 'working') return node.replaceChildren(working(' Claude is working on it…'))
  const done = el('span', 'done', 'Done. ')
  const open = el('button', 'link', 'Open the chat')
  open.onclick = () => {
    $('viewer').hidden = true
    $('files').hidden = true
    toBottom()
  }
  node.replaceChildren(done, open)
  lineAsk = null
}

function openViewer(title) {
  $('viewer-title').textContent = title
  $('viewer').dataset.page = ''
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
// One question, one choice, no previews (a permission prompt is one): a tap is the answer, sent at
// once; with previews a tap shows one first, and with several questions Submit sends them.
const isOneTap = qs => {
  const q = qs.length === 1 ? qs[0] : null
  return Boolean(q && q.kind !== 'text' && q.kind !== 'number' && !q.multiSelect && q.options?.length && !q.options.some(o => o.preview))
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
          if (isOneTap(a.questions) && askDraft.picks[i]?.length) void sendAnswer(false)
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
  tickLineAsk()
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
  // what came of a secret sent from here: a toast once (a note from before this page loaded is not news)
  const note = snap.vaultNote
  if (!lastVaultAt) lastVaultAt = note?.at || 1
  else if (note && note.at > lastVaultAt) {
    toast({ title: note.isError ? 'Secret not saved' : 'Secret saved', body: note.text })
    lastVaultAt = note.at
  }
  renderHeader()
  renderChat()
  void highlightChat()
  syncPromptNav()
  // the folder tab and a search stay as they are (nothing read again under the reader); the other
  // tabs follow the session
  if (!$('files').hidden && filesTab !== 'folder' && filesQuery.length < 2) renderFiles()
  // a new question opens its page; one answered elsewhere closes it
  if (snap.ask && snap.ask.id !== askHiddenId && $('ask').hidden) openAsk(false)
  else if (snap.ask && !$('ask').hidden && askDraft.id !== snap.ask.id) renderAsk()
  renderPage()
  renderFacts()
  if (!snap.ask && !$('ask').hidden) {
    $('ask').hidden = true
    toast({ title: 'Answered', body: 'The question was answered on the Mac.' })
  }
  if (isFollowing) toBottom()
  else $('jump').hidden = false
  isFirstDraw = false
}

// Shows that session, from the drawer, a notice's toast or a push notification.
function openSession(id) {
  if (!id) return
  picked = id
  unread.delete(id)
  $('open-drawer').classList.toggle('unread', unread.size > 0)
  try { localStorage.setItem('qsb-session', picked) } catch {}
  closeLayers()
  render()
}

// A toast for 5 s. `onTap`: what a tap on it does (a notice opens its session). A swipe left or
// right of more than 80 px throws it away; a shorter one puts it back.
function toast(n, onTap) {
  const t = el('div', onTap ? 'toast tap' : 'toast')
  t.append(el('strong', '', n.title), el('div', 'meta', n.body))
  document.body.append(t)
  const timer = setTimeout(() => t.remove(), 5000)
  let x0 = 0, dx = 0, isDown = false
  t.addEventListener('pointerdown', e => {
    isDown = true
    x0 = e.clientX
    dx = 0
    t.setPointerCapture(e.pointerId)
    t.style.transition = 'none'
  })
  t.addEventListener('pointermove', e => {
    if (!isDown) return
    dx = e.clientX - x0
    t.style.transform = `translateX(${dx}px)`
    t.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 300))
  })
  const end = () => {
    if (!isDown) return
    isDown = false
    t.style.transition = 'transform .15s ease, opacity .15s ease'
    if (Math.abs(dx) > 80) {
      clearTimeout(timer)
      t.style.transform = `translateX(${dx > 0 ? '' : '-'}120%)`
      t.style.opacity = '0'
      setTimeout(() => t.remove(), 150)
      return
    }
    t.style.transform = ''
    t.style.opacity = ''
    // a tap: the finger barely moved
    if (Math.abs(dx) < 8 && onTap) {
      clearTimeout(timer)
      t.remove()
      onTap()
    }
  }
  t.addEventListener('pointerup', end)
  t.addEventListener('pointercancel', end)
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
$('close-files').onclick = () => {
  $('files').hidden = true
  isPicking = false
}
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
    $('files-q').value = filesQuery = ''
    $('files-q-clear').hidden = true
    renderFiles()
  }
// the search waits for a pause in the typing
{
  let pause = 0
  $('files-q-clear').onclick = () => {
    $('files-q').value = filesQuery = ''
    $('files-q-clear').hidden = true
    renderFiles()
    $('files-q').focus()
  }
  $('files-q').addEventListener('input', () => {
    $('files-q-clear').hidden = !$('files-q').value
    clearTimeout(pause)
    pause = setTimeout(() => {
      filesQuery = $('files-q').value.trim()
      renderFiles()
    }, 350)
  })
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
// Only while the box has focus, and only a keyboard's height: a fast scroll moves the browser's
// address bar, and for a moment the two heights disagree by that much with no keyboard up.
const vv = window.visualViewport
const KEYBOARD_MIN = 120
function fitKeyboard() {
  const gap = vv && document.activeElement === text ? Math.round(window.innerHeight - vv.height - vv.offsetTop) : 0
  document.documentElement.style.setProperty('--kb', `${gap >= KEYBOARD_MIN ? gap : 0}px`)
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
  text.style.height = '24px'
  const h = Math.max(24, text.scrollHeight)
  text.style.height = `${Math.min(h, 160)}px`
  text.style.overflowY = h > 160 ? 'auto' : 'hidden'
}
// the reply area's height, for what sits above it (the chat's end, the jump button, the menus)
const footer = document.querySelector('footer')
const fitFoot = () => document.documentElement.style.setProperty('--foot', `${footer.offsetHeight}px`)
if ('ResizeObserver' in window) new ResizeObserver(fitFoot).observe(footer)
fitFoot()
text.addEventListener('input', fitText)
// a tap anywhere in the frame but its buttons puts the keyboard in the box
document.querySelector('.composer').addEventListener('click', e => { if (!e.target.closest('button')) text.focus() })
$('send').onclick = () => sendText(text.value, true)
$('unquote').onclick = dropQuote

// ↑ ↓ over Newest: your message before, or after, the top of the chat as you read it
function syncPromptNav() {
  const mine = document.querySelectorAll('#chat .b.me')
  $('pnav').hidden = mine.length < 1 || document.documentElement.scrollHeight <= innerHeight + 40
}
function jumpPrompt(by) {
  const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 56) + 8
  const mine = [...document.querySelectorAll('#chat .b.me')]
  const at = scrollY + top
  const to = by < 0 ? mine.filter(b => b.offsetTop < at - 4).pop() : mine.find(b => b.offsetTop > at + 4)
  if (!to) return
  window.scrollTo({ top: to.offsetTop - top, behavior: 'smooth' })
  to.classList.add('flash')
  setTimeout(() => to.classList.remove('flash'), 1200)
}
$('prev-prompt').onclick = () => jumpPrompt(-1)
$('next-prompt').onclick = () => jumpPrompt(1)
window.addEventListener('scroll', syncPromptNav, { passive: true })
// A chip tapped: it goes on a line of its own at the end of the reply box, after any draft, for
// Send to take; the box is not focused, so the keyboard stays down.
function chipToBox(s) {
  const kept = text.value.replace(/\s+$/, '')
  text.value = kept ? `${kept}\n${s}` : s
  fitText()
  updateSlash()
}

// a text sent from the box: /usage, /secret and the pages open here; the rest goes to the session
// `isBox`: it came from the reply box, which empties once it goes
async function sendText(raw, isBox = false) {
  const value = String(raw ?? '').trim()
  if (!value || !snap) return
  // /usage shows here, from what the session reports; nothing opens on the computer
  // /secret opens a dialog on the computer: here, the phone's own sheet takes the secret
  if (/^\/secret$/.test(value)) {
    if (isBox) {
      text.value = ''
      fitText()
    }
    return openSecretSheet()
  }
  if (/^\/(usage|cost)\b/.test(value)) {
    if (isBox) {
      text.value = ''
      fitText()
    }
    return openUsage()
  }
  const asPage = /^\/(\w+)$/.exec(value)
  if (asPage && PAGES.has(asPage[1])) {
    if (isBox) {
      text.value = ''
      fitText()
    }
    return openPage(asPage[1])
  }
  // a quote over the box goes before what you wrote (a /command goes as typed, the quote kept)
  const isQuoting = isBox && quoted && !value.startsWith('/')
  $('send').disabled = true
  const r = await api('reply', { text: isQuoting ? withQuote(value) : value })
  $('send').disabled = false
  const body = r.b || {}
  if (r.s !== 200) return toast({ title: 'Not sent', body: body.error || 'The session did not answer. Try again.' })
  if (isQuoting) dropQuote()
  if (isBox) {
    text.value = ''
    fitText()
  }
  toBottom()
}

// ---- the + menu: files, a web page, a secret, slash commands, and Claude Code's next-prompt hint ----
// text put in the reply box at the cursor, the box grown to fit and focused
function insertText(t) {
  const at = text.selectionStart ?? text.value.length
  text.value = `${text.value.slice(0, at)}${t}${text.value.slice(text.selectionEnd ?? at)}`
  fitText()
  text.focus()
  text.selectionStart = text.selectionEnd = at + t.length
}
function closePlus() {
  $('plus-menu').hidden = true
  $('plus').classList.remove('on')
}
function openPlus() {
  const menu = $('plus-menu')
  menu.replaceChildren()
  const item = (iconName, title, note, run) => {
    const b = menu.appendChild(el('button', 'item'))
    b.append(icon(iconName))
    const t = b.appendChild(el('div'))
    t.append(el('div', 't', title), el('div', 'd', note))
    b.onclick = () => {
      closePlus()
      run()
    }
  }
  item('file', 'Browse project file', 'mention it in your reply as @path', () => {
    isPicking = true
    filesTab = 'folder'
    renderFiles()
    $('files').hidden = false
  })
  item('globe', 'Add a web page', 'Claude reads it as context', openWebSheet)
  item('key', 'Add a secret', 'saved to the Mac\'s keychain, never to the chat', openSecretSheet)
  item('slash', 'Slash commands', 'commands and skills, the ones you type most first', openCommands)
  menu.hidden = false
  $('plus').classList.add('on')
}
$('plus').onclick = () => ($('plus-menu').hidden ? openPlus() : closePlus())
document.addEventListener('click', e => {
  if (!$('plus-menu').hidden && !$('plus-menu').contains(e.target) && !$('plus').contains(e.target)) closePlus()
})

// a file picked from the Folder tab: @path from the session's folder, quoted when it has a space
// @path as a prompt mentions it: from the session's folder when the file is in it
function mentionOf(path) {
  const rel = snap.cwd && path.startsWith(`${snap.cwd}/`) ? path.slice(snap.cwd.length + 1) : path
  return /\s/.test(rel) ? `@"${rel}"` : `@${rel}`
}
function pickFile(path) {
  insertText(`${mentionOf(path)} `)
  isPicking = false
  $('files').hidden = true
}

// a bottom sheet holding a small form
function formSheet(title, note, fields, submitLabel, onSubmit) {
  const sheet = $('sheet')
  sheet.replaceChildren(el('h2', '', title), el('div', 'meta', note))
  const form = sheet.appendChild(el('div', 'form'))
  const inputs = {}
  const add = (into, f) => {
    const i = into.appendChild(el('input'))
    i.type = f.type || 'text'
    i.placeholder = f.placeholder
    i.autocomplete = 'off'
    i.setAttribute('autocapitalize', 'off')
    i.spellcheck = false
    inputs[f.key] = i
  }
  for (const f of fields.filter(x => !x.isMore)) add(form, f)
  const more = fields.filter(x => x.isMore)
  if (more.length) {
    const d = form.appendChild(el('details'))
    d.append(el('summary', '', 'For an unknown kind of token: its name, host and header'))
    for (const f of more) add(d, f)
  }
  const go = form.appendChild(el('button', 'primary', submitLabel))
  go.onclick = async () => {
    go.disabled = true
    const isDone = await onSubmit(inputs)
    go.disabled = false
    if (isDone) closeLayers()
  }
  $('scrim').hidden = false
  sheet.hidden = false
  inputs[fields[0].key].focus()
}
function openWebSheet() {
  formSheet('Add a web page', 'Your reply asks Claude to read it, as the + menu on the Mac does.', [{ key: 'url', type: 'url', placeholder: 'https://example.com/docs' }], 'Add to the reply', inputs => {
    const url = inputs.url.value.trim()
    if (!/^https?:\/\/\S+$/.test(url)) {
      toast({ title: 'Not a web address', body: 'Give the whole address, from https://.' })
      return false
    }
    insertText(`Read ${url} and use it as context. `)
    return true
  })
}
function openSecretSheet() {
  formSheet('Add a secret', 'Saved to the Mac\'s keychain, end to end encrypted on the way. Claude sees only its NAME and uses it only with its host. Known tokens (ghp_, sk-ant-, figd_, glpat-, xoxb-, sk-) name themselves.', [
    { key: 'value', type: 'password', placeholder: 'the token or key' },
    { key: 'name', placeholder: 'NAME, e.g. ACME_API_KEY', isMore: true },
    { key: 'host', placeholder: 'host, e.g. api.acme.dev', isMore: true },
    { key: 'header', placeholder: 'header, e.g. Authorization: Bearer', isMore: true },
  ], 'Save on the Mac', async inputs => {
    const value = inputs.value.value.trim()
    if (!value) return false
    const r = await api('secret', { value, name: inputs.name.value, host: inputs.host.value, header: inputs.header.value })
    inputs.value.value = ''
    if (r.s !== 200) {
      toast({ title: 'Not sent', body: r.b.error || 'The session did not answer. Try again.' })
      return false
    }
    toast({ title: 'Sent to the Mac', body: 'It says in a moment what it saved.' })
    return true
  })
}

// the slash commands, filtered as typed; a press puts "/name " at the head of the reply
function renderCommands() {
  const words = $('cmd-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = (snap?.commands || []).filter(c => words.every(w => `${c.name} ${c.description}`.toLowerCase().includes(w)))
  const root = $('cmds-body')
  root.replaceChildren()
  if (!list.length) return root.append(el('div', 'none', words.length ? 'Nothing matches.' : 'The session has listed no commands yet.'))
  for (const group of new Set(list.map(c => c.group))) {
    const card = root.appendChild(el('div', 'card'))
    card.append(el('h3', '', group.replace(/^\d+ · /, '')))
    for (const c of list.filter(x => x.group === group)) {
      const b = card.appendChild(el('button', `cmd${c.isComputerOnly ? ' computeronly' : ''}`))
      const head = b.appendChild(el('div', 'n', `/${c.name}`))
      if (c.isComputerOnly) head.append(el('span', 'tag', 'Computer only'))
      if (c.needsArgs) head.append(el('span', 'tag', 'give a value'))
      b.append(el('div', 'd', c.description))
      b.onclick = () => pickCommand(c)
    }
  }
}
// a command picked, from the list or as you type: a panel would open on the computer, where
// nothing from here can close it, so /usage, /secret and the pages show here; the rest go in the box
function pickCommand(c) {
  closeSlash()
  if (c.name === 'secret') {
    $('cmds').hidden = true
    return openSecretSheet()
  }
  if (c.name === 'usage' || c.name === 'cost') {
    $('cmds').hidden = true
    return openUsage()
  }
  if (c.isPage) {
    $('cmds').hidden = true
    text.value = text.value.replace(/^\/\S*\s*/, '')
    fitText()
    return openPage(c.name)
  }
  if (c.isComputerOnly) return toast({ title: `/${c.name} is computer only`, body: 'It opens a panel on the computer, which the phone cannot close.' })
  text.value = `/${c.name} ${text.value.replace(/^\/\S*\s*/, '')}`
  fitText()
  $('cmds').hidden = true
  text.focus()
}

// ---- / as you type: the commands whose name starts with what follows it, then those holding it ----
const SLASH_MAX = 8
function closeSlash() {
  $('slash').hidden = true
}
function updateSlash() {
  const m = /^\/([\w:.-]*)$/.exec(text.value)
  const all = snap?.commands || []
  if (!m || !all.length || document.activeElement !== text) return closeSlash()
  const typed = m[1].toLowerCase()
  const seen = new Set()
  const starts = all.filter(c => c.name.toLowerCase().startsWith(typed))
  const holds = all.filter(c => !c.name.toLowerCase().startsWith(typed) && `${c.name} ${c.description}`.toLowerCase().includes(typed))
  const list = [...starts, ...holds].filter(c => !seen.has(c.name) && seen.add(c.name)).slice(0, SLASH_MAX)
  const box = $('slash')
  box.replaceChildren()
  if (!list.length) return closeSlash()
  for (const c of list) {
    const b = box.appendChild(el('button', `item${c.isComputerOnly ? ' computeronly' : ''}`))
    const t = b.appendChild(el('div', 't'))
    t.append(el('span', 'n', `/${c.name}`))
    if (c.isComputerOnly) t.append(el('span', 'tag', 'Computer only'))
    if (c.description) b.append(el('div', 'd', c.description))
    // the box keeps the keyboard: a press does not take the focus first
    b.onpointerdown = e => e.preventDefault()
    b.onclick = () => pickCommand(c)
  }
  box.hidden = false
}
text.addEventListener('input', updateSlash)
text.addEventListener('focus', updateSlash)
// shut once the box has lost the keyboard, unless it has it back by then
text.addEventListener('blur', () => setTimeout(() => document.activeElement !== text && closeSlash(), 150))
function openCommands() {
  $('cmd-search').value = ''
  renderCommands()
  $('cmds').hidden = false
}
$('cmd-search').addEventListener('input', renderCommands)
$('close-cmds').onclick = () => { $('cmds').hidden = true }

// ---- /usage, drawn here from the session's figures ----------------------------------------------
const WINDOW_NAMES = { five_hour: '5-hour', seven_day: 'Week', seven_day_opus: 'Week, Opus', seven_day_sonnet: 'Week, Sonnet' }
function until(iso) {
  const ms = Date.parse(iso || '') - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'resets now'
  const m = Math.round(ms / 60000)
  return m < 60 ? `resets in ${m} min` : m < 1440 ? `resets in ${Math.floor(m / 60)} h ${m % 60} min` : `resets in ${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`
}
function meterRow(label, percent, note) {
  const row = el('div', 'meter')
  const head = row.appendChild(el('div', 'mh'))
  head.append(el('span', '', label), el('strong', '', percent === null || percent === undefined ? '–' : `${Math.round(percent)}%`))
  const bar = row.appendChild(el('div', 'track'))
  const fill = bar.appendChild(el('div', `fill${percent >= 80 ? ' bad' : percent >= 50 ? ' warn' : ''}`))
  fill.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`
  if (note) row.append(el('div', 'meta', note))
  return row
}
function openUsage() {
  if (!snap) return
  const body = openViewer(`Usage · ${titleOf(snap)}`)
  const u = snap.usage || {}
  const limits = u.limits || []
  const card = body.appendChild(el('div', 'card usage'))
  card.append(el('h3', '', 'Rate limits'))
  if (!limits.length) card.append(el('div', 'meta pad', 'No reading yet: the figures come with the next answer from the API.'))
  for (const r of limits) card.append(meterRow(WINDOW_NAMES[r.kind] || r.kind, r.percentUsed, until(r.resetsAt)))
  const ctx = body.appendChild(el('div', 'card usage'))
  ctx.append(el('h3', '', 'This session'))
  ctx.append(meterRow('Context', u.ctx, u.tokens ? `${Math.round(u.tokens / 1000)}k of ${Math.round((u.window || 0) / 1000)}k tokens` : ''))
  if (typeof u.cost === 'number') ctx.append(el('div', 'meta pad', `Cost so far $${u.cost.toFixed(2)}${u.startedAt ? `, over ${clock(Date.now() - u.startedAt)}` : ''}`))
}

// ---- under the reply box: the model and the effort, each a press from its page ---------------------
function renderFacts() {
  const root = $('facts')
  root.replaceChildren()
  if (!snap) return
  // a pill of one or more parts, each a press that opens its own page
  const pill = () => root.appendChild(el('div', 'pill'))
  const part = (into, cls, title, open) => {
    if (into.childElementCount) into.append(el('span', 'sep', '·'))
    const b = into.appendChild(el('button', cls))
    b.title = title
    b.onclick = open
    return b
  }
  // the model and its effort, one pill
  if (snap.model || snap.effort) {
    const p = pill()
    if (snap.model) part(p, 'model', 'Model', () => openPage('model')).append(snap.model)
    if (snap.effort) part(p, '', 'Effort', () => openPage('effort')).append(snap.effort)
  }
}

// ---- a panel's command as a page: the session builds it as data, one renderer draws them all ----
// /model, /effort, /config, /permissions, /context and /mcp open a panel in the terminal, which the
// phone could not see or close. The session sends each page as sections of rows; a press goes back
// as { key, value } and the session sends the page again, built after it.
const PAGES = new Set(['model', 'effort', 'config', 'permissions', 'context', 'mcp'])
const pageAsk = { name: '', at: 0, pending: '' }
function openPage(name) {
  if (!snap) return
  pageAsk.name = name
  pageAsk.at = Date.now()
  pageAsk.pending = ''
  openViewer(`/${name} · ${titleOf(snap)}`).append(el('div', 'none', 'Asking the session…'))
  $('viewer').dataset.page = name
  renderPage()
  void api('page', { cmd: name }).then(r => { if (r.s !== 200) toast({ title: 'Not opened', body: r.b?.error || 'The session did not answer.' }) })
}
async function pageAct(key, value) {
  pageAsk.pending = key
  pageAsk.at = Date.now()
  renderPage()
  const r = await api('page', { cmd: pageAsk.name, key, value })
  if (r.s !== 200) {
    pageAsk.pending = ''
    renderPage()
    toast({ title: 'Not sent', body: r.b?.error || 'The session did not answer. Try again.' })
  }
}
// the page as the session last built it, once built after the last ask; drawn again on each update
function renderPage() {
  const name = $('viewer').dataset.page
  if ($('viewer').hidden || !name || !snap) return
  const page = (snap.pages || []).find(p => p.name === name)
  if (!page || page.at < pageAsk.at - 1000) {
    if (!pageAsk.pending) return
  } else pageAsk.pending = ''
  if (!page) return
  const body = $('viewer-body')
  const top = $('viewer').scrollTop
  // a box being typed in is not drawn over
  if (body.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return
  body.replaceChildren()
  if (page.note) body.append(el('div', 'meta pad', page.note))
  if (page.error) body.append(el('div', 'perr', page.error))
  for (const sec of page.sections) {
    const card = body.appendChild(el('div', 'card'))
    if (sec.title) card.append(el('h3', '', sec.title))
    for (const row of sec.rows) card.append(pageRow(row))
  }
  $('viewer').scrollTop = top
}
function pageRow(row) {
  const isBusy = pageAsk.pending === row.key
  const wrap = el('div', `prow${row.tone ? ` tone-${row.tone}` : ''}${isBusy ? ' busy' : ''}${row.isLocked ? ' locked' : ''}`)
  const head = wrap.appendChild(el('div', 'ph'))
  const text = head.appendChild(el('div', 'pt'))
  text.append(el('div', 'pl', row.label))
  if (row.detail) text.append(el('div', 'pd', row.detail))
  const right = head.appendChild(el('div', 'pr'))
  if (row.isLocked) {
    right.append(el('span', 'pv', row.kind === 'toggle' ? (row.isOn ? 'on' : 'off') : row.value || ''), icon('lock'))
    return wrap
  }
  if (row.kind === 'info') right.append(el('span', 'pv', row.value || ''))
  if (row.kind === 'pick') {
    wrap.classList.add('tap')
    right.append(el('span', `mk${row.isOn ? ' on' : ''}`))
    if (!row.isOn) wrap.onclick = () => pageAct(row.key)
  }
  if (row.kind === 'toggle') {
    const sw = right.appendChild(el('button', `switch${row.isOn ? ' on' : ''}`))
    sw.setAttribute('aria-pressed', String(Boolean(row.isOn)))
    sw.onclick = () => pageAct(row.key, !row.isOn)
  }
  if (row.kind === 'choice') {
    const sel = right.appendChild(el('select', 'psel'))
    for (const o of row.options || []) {
      const opt = sel.appendChild(el('option', '', o))
      opt.value = o
      if (o === row.value) opt.selected = true
    }
    sel.onchange = () => pageAct(row.key, sel.value)
  }
  if (row.kind === 'text' || row.kind === 'number') {
    const line = wrap.appendChild(el('div', 'pin'))
    const input = line.appendChild(el('input'))
    input.type = row.kind === 'number' ? 'number' : 'text'
    input.value = row.value || ''
    const save = line.appendChild(el('button', 'pbtn', 'Save'))
    save.onclick = () => pageAct(row.key, row.kind === 'number' ? Number(input.value) : input.value)
  }
  if (row.kind === 'action') {
    const b = right.appendChild(el('button', 'pbtn', isBusy ? 'Working…' : 'Run'))
    b.onclick = () => pageAct(row.key)
  }
  if (row.kind === 'remove') {
    const b = right.appendChild(el('button', 'pbtn danger', 'Remove'))
    b.onclick = () => {
      if (b.dataset.armed) return pageAct(row.key)
      b.dataset.armed = '1'
      b.textContent = 'Tap again'
      setTimeout(() => { delete b.dataset.armed; b.textContent = 'Remove' }, 4000)
    }
  }
  if (row.kind === 'add') {
    const line = wrap.appendChild(el('div', 'pin'))
    const sel = line.appendChild(el('select', 'psel'))
    for (const o of row.options || []) sel.appendChild(el('option', '', o)).value = o
    const input = line.appendChild(el('input'))
    input.placeholder = 'Tool(pattern)'
    input.autocapitalize = 'off'
    const add = line.appendChild(el('button', 'pbtn', 'Add'))
    add.onclick = () => input.value.trim() && pageAct(row.key, `${sel.value}\n${input.value.trim()}`)
    head.remove()
    wrap.prepend(el('div', 'pd', `For example ${row.label}`))
  }
  return wrap
}

// ---- push -----------------------------------------------------------------------------------
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
function setupNotify() {
  const btn = $('notify')
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  // a push notification tapped while the app is open: its session
  navigator.serviceWorker.addEventListener('message', e => openSession(e.data?.open))
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
