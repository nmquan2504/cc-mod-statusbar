import { atom, read } from 'claude-code'
import { oneLine, shortModel } from '../lib/format'
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
  // texts the phone sent while Claude was working, sent one at a time between turns
  queue: [] as string[],
  // the conversation as the phone shows it, read at a turn's start and end
  messages: [] as { role: string; text: string }[],
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

// The conversation for the phone: the last 30 messages with text, each cut to 6000 characters.
export async function readRemoteMessages($: any) {
  if (!cfg.selfRemote || !remote.status) return
  const list: any[] = await $.session.messages().catch(() => [])
  remote.messages = list
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-30)
    .map(m => ({ role: m.role, text: m.text.length > 6000 ? `${m.text.slice(0, 6000)}…` : m.text }))
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
    messages: remote.messages,
    queued: remote.queue,
    lastAt: remote.lastAt,
  }
}

// Every two seconds with the setting on: join the hub when one runs, send this session's
// snapshot, take what the phone sent, and tell the terminal of a phone asking to pair.
export async function tickRemote($: any) {
  if (!cfg.selfRemote) return
  const id = await $.session.id().catch(() => '')
  if (!id) return
  if (remote.isHidden) return void (await readRemote($))
  if (!remote.isJoined && !(await readRemote($))) {
    if (remote.isStarting && Date.now() - remote.startedAt > HUB_START_MS) {
      remote.isStarting = false
      $.ui.toast(`statusbar: remote: the hub did not start; see ${remote.dir}/hub.out`)
    }
    return
  }
  if (!remote.isJoined) await readRemoteMessages($)
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
