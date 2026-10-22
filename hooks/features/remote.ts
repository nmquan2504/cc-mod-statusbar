import { atom, read } from 'claude-code'
import { oneLine, shortModel } from '../lib/format'
import { ask, settleAsk } from './ask'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads (each file declares its own: the engine reads an atom only where a
// const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
const tasks = atom({ plugin: 'cc-mod-statusbar', key: 'tasks' } as const, [])
const lastTurn = atom({ plugin: 'cc-mod-statusbar', key: 'lastTurn' } as const, null)
const edited = atom({ plugin: 'cc-mod-statusbar', key: 'edited' } as const, [])
const changes = atom({ plugin: 'cc-mod-statusbar', key: 'changes' } as const, [])
const images = atom({ plugin: 'cc-mod-statusbar', key: 'images' } as const, [])
const usage = atom({ plugin: 'cc-mod-statusbar', key: 'usage' } as const, null)

// Self remote: one hub per machine (remote/server.mjs), started detached by the first session
// that asks, so it outlives that session; every session with the setting on joins it, and the
// phone picks one. The hub listens on a Unix socket in a folder only this user can open.
export type RemoteStatus = {
  url: string
  link: string
  error: string
  sessions: number
  devices: { name: string; seenAt: number }[]
  pending: { id: string; code: string; name: string; at: number }[]
  phones: number
  isLocked: boolean
  subscriptions: number
}
export const remote = {
  dir: '',
  // the hub's last answer; null while none answers
  status: null as RemoteStatus | null,
  isStarting: false,
  startedAt: 0,
  // this session stays off the phone's list
  isHidden: false,
  isJoined: false,
  // whether a terminal draws this session, read once
  hasTerminal: undefined as boolean | undefined,
  // texts the phone sent while Claude was working, sent one at a time between turns
  queue: [] as string[],
  // the conversation as the phone shows it, as the terminal draws it: read at a turn's start and
  // end, and every tick while a phone watches a turn run
  transcript: [] as TranscriptItem[],
  // the pairing requests a toast already announced
  announced: [] as string[],
  lastAt: 0,
}

const HUB_START_MS = 30_000
const sockOf = () => `${remote.dir}/hub.sock`

async function hubDir($: any) {
  if (remote.dir) return remote.dir
  const r = await $.process.run(['id', '-u']).catch(() => undefined)
  const uid = String(r?.stdout ?? '').trim()
  if (/^\d+$/.test(uid)) remote.dir = `/tmp/qsb-remote-${uid}`
  return remote.dir
}

async function hub($: any, method: string, path: string, body?: unknown) {
  if (!(await hubDir($))) return undefined
  const r = await $.http.fetch(`http://hub${path}`, {
    method,
    socketPath: sockOf(),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => undefined)
  if (!r?.ok) return undefined
  try {
    return JSON.parse(r.text)
  } catch {
    return undefined
  }
}

// The hub's status, or null when none runs.
export async function readRemote($: any) {
  const was = JSON.stringify(remote.status)
  remote.status = (await hub($, 'GET', '/status')) ?? null
  if (JSON.stringify(remote.status) !== was) $.ui.invalidate('ui.render')
  return remote.status
}

// Starts the hub, detached: node runs it in the background and the shell returns at once.
export async function startRemote($: any) {
  if (remote.isStarting || (await readRemote($))) return
  const dir = await hubDir($)
  if (!dir) return $.ui.toast('statusbar: remote: could not read the user id')
  remote.isStarting = true
  remote.startedAt = Date.now()
  remote.isHidden = false
  $.ui.invalidate('ui.render')
  const server = `${$.plugin.root}/remote/server.mjs`
  const script = 'mkdir -p -m 700 "$1" && command -v node >/dev/null || { echo "node is not on PATH" >&2; exit 3; }; nohup node "$0" "$1" "$2" >>"$1/hub.out" 2>&1 </dev/null &'
  const r = await $.process.run(['/bin/sh', '-c', script, server, dir, String(cfg.remoteIdleMinutes)]).catch(() => undefined)
  if (r?.exitCode !== 0) {
    remote.isStarting = false
    $.ui.toast(`statusbar: remote: could not start the hub${r?.stderr ? `: ${oneLine(r.stderr, 80)}` : ''}`)
  }
  $.ui.invalidate('ui.render')
}

export async function stopRemote($: any) {
  await hub($, 'POST', '/stop')
  remote.status = null
  remote.isJoined = false
  remote.isStarting = false
  $.ui.invalidate('ui.render')
}

export async function answerPairing($: any, id: string, isAllowed: boolean) {
  remote.status = (await hub($, 'POST', isAllowed ? '/allow' : '/deny', { id })) ?? remote.status
  $.ui.toast(isAllowed ? 'statusbar: remote: the phone is paired' : 'statusbar: remote: refused')
  $.ui.invalidate('ui.render')
}

export async function forgetDevices($: any) {
  remote.status = (await hub($, 'POST', '/forget-devices')) ?? remote.status
  $.ui.toast('statusbar: remote: every paired phone must scan again')
}

export async function hideSession($: any, isHidden: boolean) {
  remote.isHidden = isHidden
  if (isHidden && remote.isJoined) {
    const id = await $.session.id().catch(() => '')
    await hub($, 'POST', `/bye?id=${encodeURIComponent(id)}`)
    remote.isJoined = false
  }
  $.ui.invalidate('ui.render')
}

// One row of the transcript the phone draws, oldest first: your prompt, Claude's text, or a tool
// call with what it gave back (absent while it runs).
export type TranscriptItem =
  | { k: 'user'; text: string }
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; name: string; arg: string; path?: string; out?: string; isError?: boolean; old?: string; new?: string; qa?: { q: string; a: string }[] }

const TRANSCRIPT_MAX = 80
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}\n… ${t.length - n} more characters` : t)
const lineCount = (t: string) => (t ? t.split('\n').length : 0)

// What the engine adds around a prompt, which the terminal does not show: reminders,
// notifications, and a slash command's markup put back as /name args.
function promptText(text: string) {
  return text
    .replace(/<(system-reminder|task-notification)>[\s\S]*?<\/\1>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>\s*(?:<command-message>[\s\S]*?<\/command-message>)?\s*(?:<command-args>([\s\S]*?)<\/command-args>)?/g, (_m, name: string, args?: string) => `${name.trim()} ${args?.trim() ?? ''}`)
    .replace(/<\/?local-command-[a-z]+>/g, '')
    .trim()
}

// A question Claude asked: each question with the answer it got ('' when left blank or dismissed),
// from the call's stored answers, or from the words the model read.
function askItem(u: any): TranscriptItem {
  const questions: any[] = Array.isArray(u.input?.questions) ? u.input.questions : []
  const stored = (u.result?.answers ?? {}) as Record<string, unknown>
  const read: Record<string, string> = {}
  for (const m of String(u.text ?? '').matchAll(/"([^"]+)"="([^"]*)"/g)) read[m[1]!] = m[2]!
  const qa = questions.map(q => {
    const text = String(q?.question ?? '')
    return { q: text, a: typeof stored[text] === 'string' ? (stored[text] as string) : read[text] ?? '' }
  })
  const text = typeof u.text === 'string' ? u.text : undefined
  return { k: 'tool', id: String(u.tool_use_id ?? ''), name: 'Ask', arg: oneLine(qa[0]?.q ?? '', 300), out: text === undefined ? undefined : cut(text, 2000), isError: u.isError === true || undefined, qa }
}

// A tool call as the terminal heads it, Bash(npm test): the tool and its main argument.
function toolItem(u: any, cwd: string): TranscriptItem {
  if (u.tool === 'AskUserQuestion') return askItem(u)
  const input = (u.input ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const path = str(input.file_path) || str(input.notebook_path)
  const rel = path && cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  const mcp = /^mcp__(.+?)__(.+)$/.exec(String(u.tool))
  const name = mcp ? `${mcp[1]} - ${mcp[2]} (MCP)` : u.tool === 'Edit' || u.tool === 'MultiEdit' ? 'Update' : u.tool === 'Write' ? 'Write' : String(u.tool)
  const arg = rel || str(input.command) || str(input.pattern) || str(input.url) || str(input.query) || str(input.description) || str(input.subject) || str(Object.values(input).find(v => typeof v === 'string'))
  const text = typeof u.text === 'string' ? u.text : undefined
  // a read's whole file is no use on a phone: the terminal says how many lines
  const out = text === undefined ? undefined : u.tool === 'Read' && !u.isError ? `Read ${lineCount(text)} lines` : cut(text, 4000)
  const item: TranscriptItem = { k: 'tool', id: String(u.tool_use_id ?? ''), name, arg: oneLine(arg, 300), out, isError: u.isError === true || undefined }
  if (path) item.path = path
  if (u.tool === 'Edit' && !u.isError) {
    item.old = cut(str(input.old_string), 3000)
    item.new = cut(str(input.new_string), 3000)
  }
  if (u.tool === 'Write' && !u.isError) item.new = cut(str(input.content), 3000)
  return item
}

// The session's messages as the terminal draws them, the last TRANSCRIPT_MAX rows.
export function transcriptOf(list: readonly any[], cwd: string) {
  const items: TranscriptItem[] = []
  for (const m of list) {
    if (m.role === 'user') {
      const text = promptText(String(m.text ?? ''))
      if (text) items.push({ k: 'user', text: cut(text, 8000) })
      continue
    }
    if (typeof m.text === 'string' && m.text.trim()) items.push({ k: 'text', text: cut(m.text.trim(), 12000) })
    for (const u of m.toolUses ?? []) items.push(toolItem(u, cwd))
  }
  return items.slice(-TRANSCRIPT_MAX)
}

// The conversation for the phone, read again.
export async function readRemoteMessages($: any) {
  if (!cfg.selfRemote || !remote.status) return
  const list: any[] = await $.session.messages().catch(() => [])
  remote.transcript = transcriptOf(list, await $.session.cwd().catch(() => ''))
  remote.lastAt = Date.now()
}

async function snapshotOf($: any) {
  const b = await read($, bar)
  const u = await read($, usage)
  const turn = await read($, lastTurn)
  return {
    folder: b.folder,
    branch: b.branch,
    model: shortModel(b.model),
    mode: rt.drawnMode ?? b.mode,
    cwd: await $.session.cwd().catch(() => ''),
    busy: rt.isBusy,
    turnStartedAt: rt.isBusy ? rt.turnStartedAt : 0,
    prompt: oneLine(rt.turnPrompt, 200),
    nowTool: rt.nowTool,
    tools: rt.turnTools.slice(-30),
    tasks: (await read($, tasks)).map(t => ({ subject: t.subject, status: t.status })),
    summary: turn ? { did: turn.did, result: turn.result, took: turn.took, cost: turn.cost } : null,
    edited: await read($, edited),
    changes: await read($, changes),
    images: (await read($, images)).map(i => ({ n: i.n, path: i.path, bytes: i.bytes })),
    usage: { five: b.five, week: b.week, ctx: u?.ctxPercent ?? null, cost: u?.costUsd ?? null },
    transcript: remote.transcript,
    queued: remote.queue,
    lastAt: remote.lastAt,
    // the question Claude waits on, for the phone to answer
    ask: ask.pending && !ask.pending.result ? { id: ask.pending.id, questions: ask.pending.questions } : null,
  }
}

// Every two seconds with the setting on: join the hub when one runs, send this session's
// snapshot, take what the phone sent, and tell the terminal of a phone asking to pair.
export async function tickRemote($: any) {
  if (!cfg.selfRemote) return
  const id = await $.session.id().catch(() => '')
  if (!id) return
  // a session no terminal draws (an SDK or -p run, such as claude-mem's observer) stays off the phone
  remote.hasTerminal ??= ((await $.session.surfaces().catch(() => [])) as readonly string[]).includes('terminal')
  if (!remote.hasTerminal) return
  if (remote.isHidden) return void (await readRemote($))
  if (!remote.isJoined && !(await readRemote($))) {
    if (remote.isStarting && Date.now() - remote.startedAt > HUB_START_MS) {
      remote.isStarting = false
      $.ui.toast(`statusbar: remote: the hub did not start; see ${remote.dir}/hub.out`)
    }
    return
  }
  // the transcript: on joining, and every tick while a turn runs (a prompt is stored a moment after
  // turn.start, and a phone that comes back to the page must find it there)
  if (!remote.isJoined || rt.isBusy) await readRemoteMessages($)
  const status: RemoteStatus | undefined = await hub($, 'POST', `/session?id=${encodeURIComponent(id)}`, await snapshotOf($))
  if (!status) {
    // the hub went away: stopped from another session, or idle
    if (remote.isJoined) $.ui.toast('statusbar: remote: the link stopped')
    remote.isJoined = false
    remote.status = null
    $.ui.invalidate('ui.render')
    return
  }
  const was = JSON.stringify(remote.status)
  remote.status = status
  remote.isJoined = true
  if (status.url) remote.isStarting = false
  for (const p of status.pending)
    if (!remote.announced.includes(p.id)) {
      remote.announced = [...remote.announced, p.id].slice(-20)
      $.ui.toast(`statusbar: remote: ${p.name} asks to pair, code ${p.code}. Open ⇄ to allow it`)
    }
  if (JSON.stringify(status) !== was) $.ui.invalidate('ui.render')
  const inbox = await hub($, 'GET', `/inbox?id=${encodeURIComponent(id)}`)
  if (Array.isArray(inbox?.texts)) remote.queue = [...remote.queue, ...inbox.texts.filter((t: unknown) => typeof t === 'string')]
  // the phone answered Claude's question: only the question's own texts count as keys
  const a = inbox?.answer
  if (a && ask.pending && a.id === ask.pending.id) {
    const known = new Set(ask.pending.questions.map(q => q.question))
    const answers = Object.fromEntries(Object.entries(a.answers ?? {}).filter(([q, v]) => known.has(q) && typeof v === 'string' && v.trim()).map(([q, v]) => [q, oneLine(String(v), 2000)]))
    if (a.isDismissed) settleAsk(a.id, 'dismissed', 'phone')
    else if (Object.keys(answers).length) settleAsk(a.id, { answers }, 'phone')
    $.ui.invalidate('ui.render')
  }
  // one text a turn, and never into a running one
  if (remote.queue.length && !rt.isBusy) {
    const text = remote.queue.shift()!
    const isSent = await $.prompt.submit({ text, asUser: true }).then(() => true, () => false)
    if (isSent) $.ui.toast(`statusbar: remote: sent from the phone: ${oneLine(text, 60)}`)
    else remote.queue.unshift(text)
  }
}

// A push to every subscribed phone: a turn ended, or Claude waits for the person.
export async function notifyRemote($: any, title: string, body: string) {
  if (!cfg.selfRemote || !remote.isJoined) return
  const id = await $.session.id().catch(() => '')
  await hub($, 'POST', `/notify?id=${encodeURIComponent(id)}`, { title, body })
}
