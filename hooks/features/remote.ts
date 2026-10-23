import { atom, read } from 'claude-code'
import { oneLine, shortModel } from '../lib/format'
import { suggestionChips } from '../lib/suggest'
import { ask, settleAsk } from './ask'
import { buildPage, isPage, pageAction } from './pages'
import type { Page, PageName } from './pages'
import { waitingPrompts } from './prompts'
import { TOP_GROUP, USE_KEY, groupOf } from './commands'
import { forgetSecret, listSecrets, saveTyped } from './vault'
import { cfg } from '../state/config'
import { ME, rt } from '../state/runtime'

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
  pending: { id: string; code: string; name: string; at: number; expiresAt?: number }[]
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
  // cloudflared was not found at Start: where Homebrew is ('' with none), for the menu's install
  missing: null as { brew: string } | null,
  // brew install cloudflared runs, since when; and the last lines it failed with
  installingAt: 0,
  installError: '',
  // the menu draws the QR code after this session's Start, until the menu shuts; else only on request
  isQrShown: false,
  // the menu has drawn it since it was last opened, so shutting the menu puts it away
  isQrSeen: false,
  // this session stays off the phone's list
  isHidden: false,
  isJoined: false,
  // whether a surface draws this session (the terminal, VS Code, the desktop app), once one does
  hasSurface: false,
  // texts the phone sent while Claude was working, sent one at a time between turns
  queue: [] as string[],
  // what the session holds in context, for the phone's Context tab: files @-mentioned in a prompt,
  // files Claude read, folders added (/add-dir, additionalDirectories), memory files
  context: { mentions: [] as string[], reads: [] as string[], dirs: [] as string[], memory: [] as { path: string; type: string; tokens: number }[] },
  // folders /add-dir was given this session (noteAddDir), and when the memory files were read
  addedDirs: [] as string[],
  memoryAt: 0,
  // the slash commands and skills, for the phone's list, read on joining and every five minutes
  commands: [] as { name: string; description: string; group: string; isBuiltin: boolean; isComputerOnly: boolean; needsArgs: boolean; isPage: boolean; isOwn: boolean }[],
  // the pages the phone opened (a panel's command drawn on the phone), built again on each ask
  pages: {} as Partial<Record<PageName, Page>>,
  // the commands the phone sent, each with what it printed or why it did not run, newest last
  // `anchor`: how many messages the session held when it ran, which places it in the transcript
  cmdLog: [] as { at: number; anchor: number; command: string; text: string; isError: boolean }[],
  // prompts typed while Claude worked, which no message of the session holds (see midTurnOf),
  // and how many messages there were when the request form was last read for them, and when
  midTurn: [] as MidTurn[],
  midTurnCount: -1,
  midTurnAt: 0,
  // the session's transcript file, found once (see transcriptFile)
  transcriptFile: '',
  commandsAt: 0,
  // Claude Code's own suggestion for the next prompt (the dim line, Tab to take); '' with none
  suggestion: '',
  // what came of the last secret the phone sent, for its toast: the NAME and host, or why not
  vaultNote: null as { at: number; text: string; isError: boolean } | null,
  // texts sent as the prompt that the transcript does not show yet: the phone keeps their bubbles
  sending: [] as { text: string; at: number }[],
  // the conversation as the phone shows it, as the terminal draws it: read at a turn's start and
  // end, and every tick while a phone watches a turn run
  transcript: [] as TranscriptItem[],
  // the pairing requests a toast already announced
  announced: [] as string[],
  lastAt: 0,
}

const HUB_START_MS = 30_000

// Waiting on the hub or on the tunnel's address: the band shows a spinner, redrawn every 120 ms.
export const isRemoteWaiting = () => cfg.selfRemote && (remote.isStarting || remote.installingAt > 0 || (remote.status !== null && !remote.status.url && !remote.status.error))
// The spinner Claude Code turns while it works, one frame per 120 ms.
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
export const spinnerFrame = () => SPINNER[Math.floor(Date.now() / 120) % SPINNER.length]!
// How long a wait has run, when this session started it: "12 s"
export const waitedFor = (since = remote.startedAt) => (since ? `${Math.max(0, Math.round((Date.now() - since) / 1000))} s` : '')

// Where cloudflared releases are, for a Mac without Homebrew.
export const CLOUDFLARED_DOWNLOAD = 'https://github.com/cloudflare/cloudflared/releases/latest'
// Each tool's path: on the PATH Claude Code was started with, or where Homebrew puts it.
async function whereAre($: any, names: string[]) {
  const script = 'for n in "$@"; do p=$(command -v "$n" 2>/dev/null) || p=$(for d in /opt/homebrew/bin /usr/local/bin; do [ -x "$d/$n" ] && echo "$d/$n" && break; done); echo "$n=$p"; done'
  const r = await $.process.run(['/bin/sh', '-c', script, 'sh', ...names]).catch(() => undefined)
  const found: Record<string, string> = {}
  for (const line of String(r?.stdout ?? '').split('\n')) {
    const m = /^([\w-]+)=(.*)$/.exec(line.trim())
    if (m) found[m[1]!] = m[2]!.trim()
  }
  return found
}
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
  if (remote.isStarting || remote.installingAt || (await readRemote($))) return
  const dir = await hubDir($)
  if (!dir) return $.ui.toast('statusbar: remote: could not read the user id')
  // no tunnel without cloudflared: the menu offers to install it instead of starting a hub
  const found = await whereAre($, ['cloudflared', 'brew'])
  if (!found.cloudflared) {
    remote.missing = { brew: found.brew ?? '' }
    $.ui.invalidate('ui.render')
    return
  }
  remote.missing = null
  remote.isStarting = true
  remote.startedAt = Date.now()
  remote.isQrShown = true
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

// brew install cloudflared, in the background with the spinner turning; once it is in, Start.
export async function installCloudflared($: any) {
  const brew = remote.missing?.brew
  if (!brew || remote.installingAt) return
  remote.installingAt = Date.now()
  remote.installError = ''
  $.ui.invalidate('ui.render')
  const r = await $.process.run([brew, 'install', 'cloudflared'], { env: { HOMEBREW_NO_AUTO_UPDATE: '1' }, timeoutMs: 600_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  remote.installingAt = 0
  if (r.exitCode !== 0) {
    remote.installError = oneLine(String(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' '), 200) || `brew exited ${r.exitCode}`
    $.ui.toast('statusbar: remote: cloudflared did not install; the menu says why')
    $.ui.invalidate('ui.render')
    return
  }
  $.ui.toast('statusbar: remote: cloudflared installed; starting the remote')
  await startRemote($)
}

// After installing it some other way: look again, and start once it is there.
export async function checkCloudflared($: any) {
  const found = await whereAre($, ['cloudflared', 'brew'])
  if (!found.cloudflared) {
    remote.missing = { brew: found.brew ?? '' }
    $.ui.toast('statusbar: remote: cloudflared is still not found')
    $.ui.invalidate('ui.render')
    return
  }
  remote.missing = null
  await startRemote($)
}

export async function stopRemote($: any) {
  await hub($, 'POST', '/stop')
  remote.status = null
  remote.isJoined = false
  remote.isStarting = false
  $.ui.invalidate('ui.render')
}

export async function answerPairing($: any, id: string, isAllowed: boolean) {
  const asked = remote.status?.pending.find(p => p.id === id)
  const status = await hub($, 'POST', isAllowed ? '/allow' : '/deny', { id })
  // a request a minute old is gone: the phone was told to scan again
  if (!status || !asked || secondsToPair(asked) === 0) {
    $.ui.toast('statusbar: remote: that request to pair had expired; scan the QR code on the phone again')
    remote.status = (await hub($, 'GET', '/status')) ?? remote.status
  } else {
    remote.status = status
    $.ui.toast(isAllowed ? 'statusbar: remote: the phone is paired' : 'statusbar: remote: refused')
  }
  $.ui.invalidate('ui.render')
}

// How long a request to pair still waits for Allow, in whole seconds (the hub drops it after a minute)
export const secondsToPair = (p: { expiresAt?: number }) => (p.expiresAt === undefined ? 60 : Math.max(0, Math.ceil((p.expiresAt - Date.now()) / 1000)))
// The requests to pair still waiting: one gone at its minute leaves before the hub's next answer
export const pendingPairs = () => (remote.status?.pending ?? []).filter(p => secondsToPair(p) > 0)


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
  // the earlier tool calls of a long turn, left out: how many
  | { k: 'more'; n: number }
  // a command sent from the phone, with what it printed or why it did not run
  | { k: 'cmd'; command: string; text: string; isError: boolean }

// A prompt typed while Claude works reaches the model as an attachment (queued_command), in no
// message of the session, not even of their request form. `after`: the id of the tool call it
// came in with, which places it in the transcript.
export type MidTurn = { after: string; text: string; at: number }
const MID_TURN_MAX = 50
const midTurnKey = (id: string) => `midturn:${id}`

// Only the session's transcript file holds them. It may be tens of MB, so grep reads it, in two
// passes of one pattern each (macOS grep is slow with many): where each tool result and each
// queued_command row is, then those rows. Read again only when the messages changed: at most
// every MID_TURN_SCAN_MS while a turn runs, and always when it ends. Kept in the plugin's store
// by session, so a reload shows them at once.
const MID_TURN_SCAN_MS = 5_000
const QUEUED = '"type":"queued_command"'
const MARKS = `${QUEUED}|"tool_use_id":"[A-Za-z0-9_]+","type":"tool_result"|"type":"tool_result","tool_use_id":"[A-Za-z0-9_]+"`
async function midTurnOf($: any, count: number, isFinal: boolean): Promise<MidTurn[]> {
  const isDue = remote.midTurnCount < 0 || (count !== remote.midTurnCount && (isFinal || Date.now() - remote.midTurnAt >= MID_TURN_SCAN_MS))
  if (!isDue) return remote.midTurn
  const id: string = await $.session.id().catch(() => '')
  const kept: MidTurn[] = remote.midTurnCount >= 0 ? remote.midTurn : await storedMidTurn($, id)
  remote.midTurnCount = count
  remote.midTurnAt = Date.now()
  const file = id ? await transcriptFile($, id) : ''
  if (!file) return (remote.midTurn = kept)
  const grep = async (args: string[]) => {
    const r = await $.process.run(['grep', '-n', ...args, file]).catch(() => undefined)
    return String(r?.stdout ?? '').split('\n').filter(Boolean)
  }
  const isNew = (t: MidTurn) => !kept.some(k => k.after === t.after && k.text === t.text)
  const found = midTurnsIn(await grep(['-o', '-E', MARKS]), await grep(['-F', QUEUED])).filter(isNew).map(t => ({ ...t, at: Date.now() }))
  remote.midTurn = [...kept, ...found].slice(-MID_TURN_MAX)
  if (found.length) await $.store.set(midTurnKey(id), remote.midTurn).catch(() => undefined)
  return remote.midTurn
}

async function storedMidTurn($: any, id: string): Promise<MidTurn[]> {
  const stored = id ? await $.store.get(midTurnKey(id)).catch(() => undefined) : undefined
  return Array.isArray(stored) ? stored : []
}

// <config>/projects/<the folder the session started in, each other character a ->/<id>.jsonl;
// a session moved since (/cd) is looked for in each project folder, once.
async function transcriptFile($: any, id: string) {
  if (remote.transcriptFile.endsWith(`/${id}.jsonl`)) return remote.transcriptFile
  const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
  const base = `${(await $.env.get('CLAUDE_CONFIG_DIR').catch(() => '')) || `${home}/.claude`}/projects`
  const starts = [await $.session.root().catch(() => ''), await $.session.cwd().catch(() => '')].filter(Boolean)
  const guesses = starts.map(d => `${base}/${String(d).replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`)
  for (const f of guesses) if (await $.fs.exists(f).catch(() => false)) return (remote.transcriptFile = f)
  const dirs: any[] = await $.fs.list(base).catch(() => [])
  for (const d of dirs) {
    const f = `${base}/${d.name}/${id}.jsonl`
    if (d.kind === 'directory' && (await $.fs.exists(f).catch(() => false))) return (remote.transcriptFile = f)
  }
  return ''
}

// The prompts people typed mid-turn, from grep -n of the transcript: `marks`, the tool results
// and queued_command rows by line (-o), and `queued`, those rows whole. Each prompt goes after the
// last tool result written before it: the one it came in with.
export function midTurnsIn(marks: readonly string[], queued: readonly string[]): MidTurn[] {
  const resultBefore = new Map<number, string>()
  let last = ''
  for (const m of marks) {
    const line = Number.parseInt(m, 10)
    if (m.includes(QUEUED)) resultBefore.set(line, last)
    else last = /"tool_use_id":"([A-Za-z0-9_]+)"/.exec(m)?.[1] ?? last
  }
  const found: MidTurn[] = []
  for (const q of queued) {
    const at = q.indexOf(':')
    let row: any
    try { row = JSON.parse(q.slice(at + 1)) } catch { continue }
    const a = row?.attachment, after = resultBefore.get(Number.parseInt(q, 10)) ?? ''
    if (row?.isSidechain || a?.type !== 'queued_command' || a.origin?.kind !== 'human' || typeof a.prompt !== 'string' || !a.prompt.trim() || !after) continue
    found.push({ after, text: a.prompt.trim(), at: 0 })
  }
  return found
}

// The phone keeps whole turns, each from your prompt, so no answer loses its question: the last
// TURNS_MAX, and in each the last TOOLS_PER_TURN tool calls (the earlier ones counted, not shown).
const TURNS_MAX = 20
const TOOLS_PER_TURN = 30
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}\n… ${t.length - n} more characters` : t)
const lineCount = (t: string) => (t ? t.split('\n').length : 0)

// What the engine adds around a prompt, which the terminal does not show: reminders,
// notifications, the Claude in Chrome instructions on a session's first prompt, and a slash
// command's markup put back as /name args.
function promptText(text: string) {
  return text
    .replace(/<(system-reminder|task-notification|local-command-caveat|browser_instruction)>[\s\S]*?<\/\1>/g, '')
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

// The session's messages as the terminal draws them: the last TURNS_MAX turns, long ones trimmed.
export function transcriptOf(list: readonly any[], cwd: string, cmds: readonly { anchor: number; command: string; text: string; isError: boolean }[] = [], mids: readonly MidTurn[] = []) {
  const items: TranscriptItem[] = []
  // a command run from the phone is in no message: it goes where the session stood when it ran
  const cmdsAt = (from: number, to: number) => {
    for (const c of cmds) if (c.anchor >= from && c.anchor < to) items.push({ k: 'cmd', command: c.command, text: c.text, isError: c.isError })
  }
  for (const [i, m] of list.entries()) {
    cmdsAt(i, i + 1)
    if (m.role === 'user') {
      // what a command typed in the terminal printed goes under the command, as a phone command's does
      const out = /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>\s*$/.exec(String(m.text ?? ''))
      if (out) {
        const last = items[items.length - 1]
        // eslint-disable-next-line no-control-regex -- strips ANSI styles the terminal drew it with
        const text = out[2]!.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
        if (last?.k === 'user' && last.text.startsWith('/')) items[items.length - 1] = { k: 'cmd', command: last.text, text: cut(text, 4000), isError: out[1] === 'stderr' }
        continue
      }
      const text = promptText(String(m.text ?? ''))
      if (text) items.push({ k: 'user', text: cut(text, 8000) })
      continue
    }
    if (typeof m.text === 'string' && m.text.trim()) items.push({ k: 'text', text: cut(m.text.trim(), 12000) })
    for (const u of m.toolUses ?? []) items.push(toolItem(u, cwd))
    // a prompt typed while Claude worked: after the tool call it came in on
    for (const u of m.toolUses ?? []) for (const t of mids) if (t.after === u.tool_use_id) items.push({ k: 'user', text: cut(t.text, 8000) })
  }
  cmdsAt(list.length, Infinity)
  const turns: TranscriptItem[][] = []
  for (const it of items) {
    if (it.k === 'user' || it.k === 'cmd' || !turns.length) turns.push([])
    turns[turns.length - 1]!.push(it)
  }
  return turns.slice(-TURNS_MAX).flatMap(trimTurn)
}

// A turn with more than TOOLS_PER_TURN tool calls: its prompt and Claude's text all kept, its
// earliest tool calls left out and counted in one row where the first of them stood.
function trimTurn(turn: TranscriptItem[]): TranscriptItem[] {
  const tools = turn.filter(t => t.k === 'tool').length
  const drop = tools - TOOLS_PER_TURN
  if (drop <= 0) return turn
  const out: TranscriptItem[] = []
  let seen = 0
  for (const it of turn) {
    if (it.k === 'tool' && seen++ < drop) {
      if (seen === 1) out.push({ k: 'more', n: drop })
      continue
    }
    out.push(it)
  }
  return out
}

// The files a session's messages put in context: those @-mentioned in a prompt (as typed, made
// absolute against the folder; ~ is HOME), and those Claude read. Newest last, each once, 50 at most.
export function contextOf(list: readonly any[], cwd: string, home: string) {
  const mentions: string[] = [], reads: string[] = []
  const absolute = (p: string) => (p.startsWith('/') ? p : p.startsWith('~/') && home ? `${home}${p.slice(1)}` : `${cwd.replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`)
  const keep = (into: string[], p: string) => {
    const at = into.indexOf(p)
    if (at >= 0) into.splice(at, 1)
    into.push(p)
  }
  for (const m of list) {
    if (m.role === 'user') {
      for (const hit of promptText(String(m.text ?? '')).matchAll(/(?:^|\s)@("[^"]+"|[^\s,;!?)\]]+)/g)) {
        const raw = hit[1]!.replace(/^"|"$/g, '').replace(/[.:]$/, '')
        // a path, not a handle: it holds a slash or a dot
        if (/[/.]/.test(raw)) keep(mentions, absolute(raw))
      }
    }
    for (const u of m.toolUses ?? []) if ((u.tool === 'Read' || u.tool === 'NotebookRead') && typeof (u.input?.file_path ?? u.input?.notebook_path) === 'string') keep(reads, String(u.input.file_path ?? u.input.notebook_path))
  }
  return { mentions: mentions.slice(-50), reads: reads.slice(-50) }
}

// A folder given to /add-dir, typed or sent from the phone or a chip. The command may still ask
// (this session or remember) or be turned down, so rootsOf keeps it only once Claude may read there.
export function noteAddDir(command: string, args: string) {
  const dir = args.trim().replace(/^(["'])(.*)\1$/, '$2')
  if (command === 'add-dir' && dir && !remote.addedDirs.includes(dir)) remote.addedDirs = [...remote.addedDirs, dir]
}

// The folders the session works in: its own, then those added; each absolute, each once.
export async function rootsOf($: any) {
  const cwd: string = await $.session.cwd().catch(() => '')
  const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
  const abs = (d: string) => (d.startsWith('/') ? d : d.startsWith('~/') && home ? `${home}${d.slice(1)}` : `${cwd}/${d}`).replace(/\/+$/, '')
  const perms = (await $.settings.read({ key: 'permissions' }).catch(() => undefined)) as { additionalDirectories?: unknown } | undefined
  const fromSettings = Array.isArray(perms?.additionalDirectories) ? perms!.additionalDirectories.filter((d): d is string => typeof d === 'string') : []
  // a folder /add-dir was given counts once a Read there needs no prompt: the engine took it as a working folder
  const added: string[] = []
  for (const d of remote.addedDirs.map(abs)) {
    const r = await $.tool.check({ tool: 'Read', input: { file_path: `${d}/.dir-probe` } }).catch(() => undefined)
    if (r?.decision === 'allow') added.push(d)
  }
  return { cwd, dirs: [...new Set([...fromSettings.map(abs), ...added])].filter(d => d && d !== cwd) }
}

// The memory files the session loads (CLAUDE.md, rules), from the engine's local estimate of the
// context; read on joining and then at most once a minute.
async function readMemory($: any) {
  if (Date.now() - remote.memoryAt < 60_000) return
  remote.memoryAt = Date.now()
  const u = await $.session.usage({ breakdown: 'summary', columns: 80 }).catch(() => undefined)
  const files = u?.context?.breakdown?.memoryFiles
  if (Array.isArray(files)) remote.context.memory = files.map((f: any) => ({ path: String(f.path), type: String(f.type ?? ''), tokens: Number(f.tokens ?? 0) }))
}

// The built-in commands the phone may run: those that print text or hand the model a prompt, and
// those that take a value (with one; bare, they open a picker). Every other built-in opens a
// panel in the terminal on the computer, which nothing can close from the phone, so it runs only there.
// Names as this Claude Code lists them (it has no /cost: the cost is in /usage, which the phone
// draws itself): commands that print or switch a mode, and the skills it bundles, which hand the
// model a prompt. A name not here and not given a value is computer only.
const PHONE_BUILTINS = new Set([
  'clear', 'compact', 'plan', 'fast',
  'init', 'security-review', 'code-review', 'simplify', 'fewer-permission-prompts', 'loop', 'schedule', 'claude-api', 'update-config',
  'keybindings-help', 'dataviz', 'artifact-design', 'artifact-diagramming', 'artifact-capabilities', 'workflow-authoring', 'plugin-authoring',
  'claude-in-chrome', 'run',
])
const PHONE_WITH_VALUE = new Set(['model', 'effort', 'output-style', 'add-dir'])
// true when the phone may run it; else why not
export function phoneMayRun(name: string, args: string, isBuiltin: boolean): true | string {
  if (!isBuiltin || PHONE_BUILTINS.has(name)) return true
  if (isPage(name) && !args) return `/${name} opens as a page on the phone: pick it from the + menu's Slash commands`
  if (PHONE_WITH_VALUE.has(name)) return args ? true : `/${name} with no value opens a picker on the computer; give it one, as /${name} <value>`
  return `/${name} opens a panel on the computer, and the phone cannot close it; run it at the computer`
}

// What a text from the phone is: a command to run, one of this mod's own (answered here: a plugin's
// $.command.run never reaches its own command.run hooks), a command refused (with why), or a prompt. A
// /name that names no command of this session is refused rather than handed to the model as words;
// a path (/Users/me/file) holds a slash past its first, and goes in as a prompt.
export function phoneCommand(text: string, commands: readonly { name: string; isBuiltin: boolean; isOwn?: boolean }[]):
  { kind: 'run' | 'own'; name: string; args: string } | { kind: 'refuse'; text: string } | { kind: 'prompt' } {
  const m = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return { kind: 'prompt' }
  const name = m[1]!, args = (m[2] ?? '').trim()
  const cmd = commands.find(c => c.name === name)
  if (!cmd) return { kind: 'refuse', text: `/${name} is not a command in this session` }
  if (cmd.isOwn) return { kind: 'own', name, args }
  const verdict = phoneMayRun(name, args, cmd.isBuiltin)
  return verdict === true ? { kind: 'run', name, args } : { kind: 'refuse', text: verdict }
}

// The commands the phone lists, as the ⁄ menu has them: the ones typed most first, then by group.
async function readCommands($: any) {
  if (Date.now() - remote.commandsAt < 300_000) return
  remote.commandsAt = Date.now()
  const list: any[] = await $.command.list().catch(() => [])
  const rows = list.map(c => {
    const name = String(c.name), isBuiltin = c.source === 'builtin'
    // a panel the phone draws as a page of its own (pages.ts) is neither computer only nor in need of a value
    const isPhonePage = isBuiltin && isPage(name)
    return { name, description: oneLine(String(c.description ?? ''), 120), group: groupOf(c), isBuiltin, isComputerOnly: isBuiltin && !isPhonePage && !PHONE_BUILTINS.has(name) && !PHONE_WITH_VALUE.has(name), needsArgs: isBuiltin && !isPhonePage && PHONE_WITH_VALUE.has(name), isPage: isPhonePage, isOwn: c.plugin === ME }
  })
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
  const counts = ((await $.store.get(USE_KEY).catch(() => undefined)) ?? {}) as Record<string, { n: number; last: number }>
  const top = Object.entries(counts).filter(([name]) => rows.some(r => r.name === name)).sort(([, a], [, b]) => b.n - a.n || b.last - a.last).slice(0, cfg.topCommands)
    .map(([name]) => ({ ...rows.find(r => r.name === name)!, group: TOP_GROUP }))
  remote.commands = [...top, ...rows]
}

// The conversation for the phone, read again, and what it put in context.
// `isFinal`: a turn ended, so prompts typed during it are looked for whatever the time.
export async function readRemoteMessages($: any, isFinal = false) {
  if (!cfg.selfRemote || !remote.status) return
  const list: any[] = await $.session.messages().catch(() => [])
  const { cwd, dirs } = await rootsOf($)
  const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
  remote.context = { ...remote.context, ...contextOf(list, cwd, home), dirs }
  await readMemory($)
  await readCommands($)
  remote.transcript = transcriptOf(list, cwd, remote.cmdLog, await midTurnOf($, list.length, isFinal))
  remote.lastAt = Date.now()
  // a sent text the transcript now shows, or one two minutes old, leaves the sending list
  const shown = new Set(remote.transcript.filter(t => t.k === 'user').map(t => (t as { text: string }).text.trim()))
  remote.sending = remote.sending.filter(s => !shown.has(s.text.trim()) && Date.now() - s.at < 120_000)
}

async function snapshotOf($: any) {
  const b = await read($, bar)
  const u = await read($, usage)
  const turn = await read($, lastTurn)
  return {
    folder: b.folder,
    branch: b.branch,
    model: shortModel(b.model),
    effort: b.effort ?? null,
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
    usage: { five: b.five, week: b.week, ctx: u?.ctxPercent ?? null, cost: u?.costUsd ?? null, limits: u?.rateLimits ?? [], tokens: u?.tokens ?? null, window: u?.window ?? 0, startedAt: u?.startedAt ?? 0 },
    transcript: remote.transcript,
    queued: remote.queue,
    sending: remote.sending.map(s => s.text),
    // what the phone may browse: the session's folder and the folders added; what is in context
    roots: [await $.session.cwd().catch(() => ''), ...remote.context.dirs].filter(Boolean),
    context: remote.context,
    commands: remote.commands,
    // the chips under Claude's last answer (features/chips.ts), sent at a press
    suggestions: rt.isBusy ? [] : suggestionChips(remote.suggestion, rt.answerChips),
    vaultNote: remote.vaultNote,
    lastAt: remote.lastAt,
    // the question Claude waits on, for the phone to answer
    ask: ask.pending && !ask.pending.result ? { id: ask.pending.id, questions: ask.pending.questions } : null,
    // the permission prompts waiting for the person, shown on the phone; answered at the computer
    permissions: waitingPrompts(Date.now()),
    // the pages the phone opened in the last ten minutes
    pages: Object.values(remote.pages).filter(p => Date.now() - p!.at < 600_000),
  }
}

// Every two seconds with the setting on: join the hub when one runs, send this session's
// snapshot, take what the phone sent, and tell the terminal of a phone asking to pair.
export async function tickRemote($: any) {
  if (!cfg.selfRemote) return
  const id = await $.session.id().catch(() => '')
  if (!id) return
  // a session nothing draws (an SDK or -p run, such as claude-mem's observer) stays off the phone;
  // the terminal, the VS Code extension and the desktop app each draw one. Asked again until one
  // does: a client may attach a moment after the session starts.
  remote.hasSurface ||= ((await $.session.surfaces().catch(() => [])) as readonly string[]).length > 0
  if (!remote.hasSurface) return
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
      $.ui.toast(`statusbar: remote: ${p.name} asks to pair, code ${p.code}. Open ⇄ to allow it within ${secondsToPair(p)} s`)
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
  // a page the phone opened, or a press on one: carried out, the page built again, and the
  // snapshot sent at once rather than at the next tick
  const asked = Array.isArray(inbox?.pages) ? inbox.pages : []
  for (const a of asked) {
    const name = String(a?.cmd ?? '')
    if (!isPage(name)) continue
    const rebuild = async () => {
      remote.pages = { ...remote.pages, [name]: await buildPage($, name) }
      await hub($, 'POST', `/session?id=${encodeURIComponent(id)}`, await snapshotOf($))
    }
    const error = typeof a.key === 'string' ? await pageAction($, name, a.key, a.value, p => void p.then(rebuild, rebuild)).catch((e: unknown) => `It did not go through: ${String(e).slice(0, 200)}`) : ''
    remote.pages = { ...remote.pages, [name]: await buildPage($, name, error || undefined) }
  }
  if (asked.length) await hub($, 'POST', `/session?id=${encodeURIComponent(id)}`, await snapshotOf($))
  // secrets typed on the phone go to the keychain; the phone hears the NAME and host, never the value
  for (const given of Array.isArray(inbox?.secrets) ? inbox.secrets : []) {
    const r: any = await saveTyped($, given).catch(() => ({ error: 'the keychain refused it' }))
    remote.vaultNote = { at: Date.now(), text: r.error ? `Not saved: ${r.error}` : `${r.name} saved to the ${r.where}; it goes only to ${r.host}`, isError: Boolean(r.error) }
    $.ui.toast(r.error ? `statusbar: remote: a secret from the phone was not saved (${r.error})` : `statusbar: remote: ${r.name} saved from the phone (sent only to ${r.host})`)
  }
  // one text a turn, and never into a running one; "/name args" runs that command, as typed
  if (remote.queue.length && !rt.isBusy) {
    const text = remote.queue.shift()!
    const what = phoneCommand(text, remote.commands)
    // where the session stands before the command runs: its place in the transcript
    const anchor = (await $.session.messages().catch(() => [])).length
    const log = async (out: string, isError: boolean) => {
      remote.cmdLog = [...remote.cmdLog, { at: Date.now(), anchor, command: text.trim(), text: out, isError }].slice(-10)
      await readRemoteMessages($)
    }
    if (what.kind === 'refuse') return log(what.text, true)
    // this mod's own commands, answered by the same code their hooks run
    if (what.kind === 'own') {
      if (what.name === 'secrets') return log(await listSecrets($).catch(() => 'could not list the secrets'), false)
      if (what.name === 'secret-forget') return log(await forgetSecret($, what.args).catch(() => 'could not delete the secret'), false)
      return log(`/${what.name} opens a dialog on the computer; add a secret from the + menu here instead`, true)
    }
    if (what.kind === 'run') {
      // what the command printed goes back to the phone; a prompt for the model prints nothing
      const r: any = await $.command.run({ command: what.name, args: what.args }).catch((err: unknown) => ({ error: String(err) }))
      if (!r?.error) noteAddDir(what.name, what.args ?? '') // a plugin's own command.run passes its hooks by
      if (r?.error) return log(`/${what.name} did not run: ${oneLine(r.error, 200)}`, true)
      $.ui.toast(`statusbar: remote: ran /${what.name} from the phone`)
      await log(typeof r?.text === 'string' && r.text.trim() ? (r.text.length > 8000 ? `${r.text.slice(0, 8000)}…` : r.text) : 'ran', false)
      return
    }
    const isSent = await $.prompt.submit({ text, asUser: true }).then(() => true, () => false)
    if (isSent) {
      remote.sending = [...remote.sending, { text, at: Date.now() }]
      $.ui.toast(`statusbar: remote: sent from the phone: ${oneLine(text, 60)}`)
    }
    else remote.queue.unshift(text)
  }
}

// A push to every subscribed phone: a turn ended, or Claude waits for the person.
export async function notifyRemote($: any, title: string, body: string) {
  if (!cfg.selfRemote || !remote.isJoined) return
  const id = await $.session.id().catch(() => '')
  await hub($, 'POST', `/notify?id=${encodeURIComponent(id)}`, { title, body })
}
