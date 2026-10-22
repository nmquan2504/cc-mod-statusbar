import { rt } from '../state/runtime'
import { atom, read, update } from 'claude-code'
import type { ServerRow } from '../../types'
import { oneLine } from '../lib/format'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// What Claude is working through, for the tasks menu Claude's ✻ opens: its task list (from
// TaskCreate, TaskUpdate, TodoWrite and TaskList) and the agents running for it.
const tasks = atom({ plugin: 'cc-mod-statusbar', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'cc-mod-statusbar', key: 'agents' } as const, [])
const servers = atom({ plugin: 'cc-mod-statusbar', key: 'servers' } as const, [])

// One line for the tool a call runs: the command, the file, the pattern, the URL.
export function describeCall(e: any): string {
  const base = (p: string) => String(p).split('/').pop() ?? ''
  const what =
    e.tool === 'Bash' ? e.command
      : e.file_path ? base(e.file_path)
        : e.notebook_path ? base(e.notebook_path)
          : e.pattern ?? e.url ?? e.query ?? e.description ?? e.subject ?? ''
  return `${e.tool}${what ? `  ${oneLine(String(what), 70)}` : ''}`
}

export async function readServers($: any) {
  const me = await $.process.run(['sh', '-c', 'echo $PPID']).catch(() => undefined)
  const root = Number(me?.stdout?.trim())
  if (!root) return
  const ps = await $.process.run(['ps', '-A', '-o', 'pid=,ppid=,command=']).catch(() => undefined)
  if (!ps || ps.exitCode !== 0) return
  const kids = new Map<number, number[]>()
  const commandOf = new Map<number, string>()
  for (const line of String(ps.stdout).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const [pid, ppid] = [Number(m[1]), Number(m[2])]
    commandOf.set(pid, m[3]!.trim())
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid])
  }
  const under: number[] = []
  for (const stack = [root]; stack.length; ) for (const c of kids.get(stack.pop()!) ?? []) under.push(c), stack.push(c)
  if (under.length === 0) return void (await update($, servers, () => []))
  // -F: one field a line, p<pid> then n<address> for each socket it listens on
  const ls = await $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', under.join(','), '-Fpn']).catch(() => undefined)
  const rows: ServerRow[] = []
  let pid = 0
  for (const line of String(ls?.stdout ?? '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    const port = line.startsWith('n') ? Number(/:(\d+)$/.exec(line)?.[1]) : NaN
    if (!port || rows.some(r => r.port === port)) continue
    rows.push({ pid, port, command: commandOf.get(pid) ?? '' })
  }
  await update($, servers, () => rows.sort((p, q) => p.port - q.port))
}

// The agents running for the session, for the tasks menu and Claude's badge.
export async function readAgents($: any) {
  const list: any[] = await $.agent.list().catch(() => [])
  await update($, agents, () => list.map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status })))
}

export async function readWork($: any) {
  const listed = await $.tool.call({ tool: 'TaskList' } as never).catch(() => undefined)
  const rows = listed?.result?.tasks
  if (Array.isArray(rows))
    await update($, tasks, () => rows.map((t: any) => ({ id: String(t.id), subject: String(t.subject), status: String(t.status) })))
  const list: any[] = await $.agent.list().catch(() => [])
  await update($, agents, () => list.map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status })))
}

// The last lines of a background command's log: the session's tasks/<id>.output, found the way
// the images folder is (/tmp/claude-<uid>/<project>/<session>/); null when it cannot be read.
export async function tailTask($: any, id: string, lines = 15): Promise<string[] | null> {
  if (!/^[\w-]+$/.test(id)) return null
  const session = await $.session.id().catch(() => '')
  if (!session) return null
  const script = 'for d in /private/tmp/claude-$(id -u)/*/"$1"/tasks /tmp/claude-$(id -u)/*/"$1"/tasks; do [ -f "$d/$2.output" ] && { tail -n "$3" "$d/$2.output"; exit 0; }; done; exit 1'
  const r = await $.process.run(['sh', '-c', script, 'sh', session, id, String(lines)]).catch(() => undefined)
  if (!r || r.exitCode !== 0) return null
  return String(r.stdout).replace(/\n$/, '').split('\n')
}

// A background command's short name, for the bar's chip: its first two words, 18 cells at most.
export const taskName = (command: string) => oneLine(command.trim().split(/\s+/).slice(0, 2).join(' '), 18)

// Stops a command Claude left in the background, through the engine's own TaskStop.
export async function stopTask($: any, id: string) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: id } as never).catch(() => undefined)
  const task = rt.bgTasks.find(t => t.id === id)
  if (task && r && !r.deny && !r.isError) task.status = 'killed'
  return Boolean(r && !r.deny && !r.isError)
}
// Stops a server no background command of Claude's accounts for: its process, by pid.
export async function stopPid($: any, pid: number) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  const r = await $.process.run(['kill', String(pid)]).catch(() => undefined)
  await readServers($)
  return r?.exitCode === 0
}

// The words an error leaves in a log; and what the engine's task notification says of a command.
// (Error and Exception also as the end of a name: OSError, TypeError, NullPointerException)
export const LOG_ERROR = /(error|exception)\b|\b(traceback|eaddrinuse|failed|fatal|panic)\b/i
// Every 5 seconds: a running command's log (its last SCAN_LINES) is counted for error lines, the
// first kept for the menu; one that ended is read once more, then left.
export const SCAN_LINES = 200
export async function scanBackground($: any) {
  for (const task of rt.bgTasks) {
    if (task.isScannedDone) continue
    if (task.status) task.isScannedDone = true
    const lines = await tailTask($, task.id, SCAN_LINES)
    if (!lines) continue
    const hits = lines.filter(line => LOG_ERROR.test(line))
    // the addresses it printed, and the port another process holds when it could not listen
    const urls = urlsOf(lines)
    const busyPort = lines.some(line => PORT_TAKEN.test(line)) ? portOf(task.command, lines) : undefined
    if (urls.join() !== (task.urls ?? []).join() || busyPort !== task.busyPort) {
      task.urls = urls
      task.busyPort = busyPort
      $.ui.invalidate('ui.render')
    }
    if (hits.length !== (task.errorCount ?? 0)) {
      task.errorCount = hits.length
      task.errorLine ??= hits[0] ? oneLine(hits[0], 100) : undefined
      $.ui.invalidate('ui.render')
    }
  }
}

// The http(s) addresses a log printed (a dev server's Local and Network lines), four at most.
export function urlsOf(lines: string[]) {
  // eslint-disable-next-line no-control-regex -- strips ANSI color codes from the log
  const found = lines.flatMap(line => [...line.replace(/\x1b\[[0-9;]*m/g, '').matchAll(/https?:\/\/[^\s'"<>)\]]+/g)].map(m => m[0].replace(/[.,;:]+$/, '')))
  return [...new Set(found)].slice(-4)
}
// A port another process holds; and the port a command meant to listen on.
export const PORT_TAKEN = /eaddrinuse|address already in use|port \d+ is (already )?in use/i
export function portOf(command: string, lines: string[]) {
  const said = lines.map(line => /(?:port|:)\s*(\d{2,5})\b/i.exec(line.match(PORT_TAKEN) ? line : '')?.[1]).find(Boolean)
  const asked = /(?:--port[= ]|-p[= ]?|PORT=)(\d{2,5})\b/.exec(command)?.[1] ?? /\b(\d{4,5})\s*$/.exec(command.trim())?.[1]
  const port = Number(said ?? asked)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined
}
// Who listens on a port now: its pid and program, from lsof; undefined when none.
export async function holderOf($: any, port: number) {
  const r = await $.process.run(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']).catch(() => undefined)
  const pid = Number(/^p(\d+)$/m.exec(String(r?.stdout ?? ''))?.[1])
  const program = /^c(.+)$/m.exec(String(r?.stdout ?? ''))?.[1]
  return pid ? { pid, program: program ?? '' } : undefined
}
// Asks Claude about a failed command: the command, how it ended, its error lines and its last lines.
export async function askAboutTask($: any, id: string) {
  const task = rt.bgTasks.find(t => t.id === id)
  if (!task) return false
  const all = (await tailTask($, id, SCAN_LINES)) ?? []
  const errors = all.filter(line => LOG_ERROR.test(line)).slice(-15)
  const last = all.slice(-10)
  const text = [
    `The background command \`${task.command}\` ${task.status === 'failed' ? 'failed' : 'logged errors'}${task.summary ? ` (${task.summary})` : ''}.`,
    errors.length ? `Its error lines:\n\`\`\`\n${errors.join('\n')}\n\`\`\`` : '',
    `Its last lines:\n\`\`\`\n${last.join('\n')}\n\`\`\``,
    'Find the cause and fix it.',
  ].filter(Boolean).join('\n\n')
  return $.prompt.submit({ text, asUser: true }).then(() => true, () => false)
}

// What a server is, from its command line and the command that started it: the framework's name,
// or undefined for a program it does not know.
const FRAMEWORKS: [RegExp, string][] = [
  [/\bvite\b/i, 'Vite'], [/\bnext\b.*\b(dev|start)\b|next-server|\.next\//i, 'Next.js'], [/\bnuxt\b/i, 'Nuxt'],
  [/\bastro\b/i, 'Astro'], [/\bremix\b/i, 'Remix'], [/\bstorybook\b/i, 'Storybook'], [/react-scripts/i, 'Create React App'],
  [/webpack(-dev-server| serve)/i, 'webpack'], [/\bangular|\bng serve\b/i, 'Angular'], [/\bsvelte-?kit\b/i, 'SvelteKit'],
  [/manage\.py\s+runserver/i, 'Django'], [/\bflask\b/i, 'Flask'], [/\buvicorn\b/i, 'Uvicorn'], [/\bgunicorn\b/i, 'Gunicorn'],
  [/\bfastapi\b/i, 'FastAPI'], [/\bstreamlit\b/i, 'Streamlit'], [/\bjupyter\b/i, 'Jupyter'], [/http\.server/i, 'http.server'],
  [/\brails\s+(s|server)\b|\bpuma\b/i, 'Rails'], [/\bphp\s+-S\b|artisan\s+serve/i, 'PHP'], [/\bhugo\b/i, 'Hugo'],
  [/\bjekyll\b/i, 'Jekyll'], [/\bnodemon\b/i, 'nodemon'], [/\bts-node|\btsx\s+watch/i, 'Node (TS)'], [/\bexpress\b/i, 'Express'],
  [/\bgo\s+run\b/i, 'Go'], [/\bcargo\s+run\b/i, 'Rust'], [/\bspring-boot|bootRun\b/i, 'Spring Boot'],
]
export const frameworkOf = (...commands: string[]) => {
  const all = commands.join(' ')
  return FRAMEWORKS.find(([re]) => re.test(all))?.[1]
}

// Runs a background command again, through Bash as Claude would (the permission rules and the
// dangerous-command check apply); the new run lists as a command of its own.
export async function rerunTask($: any, id: string) {
  const task = rt.bgTasks.find(t => t.id === id)
  if (!task?.command) return false
  const r = await $.tool.call({ tool: 'Bash', command: task.command, run_in_background: true, description: `rerun: ${oneLine(task.command, 40)}` } as never).catch(() => undefined)
  return Boolean(r && !r.deny && !r.isError)
}
// <task-notification> rows carry each finished task's id, status and summary.
export function keepTaskNotes(text: string) {
  for (const note of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const body = note[1] ?? ''
    const id = /<task-id>([^<]+)<\/task-id>/.exec(body)?.[1]?.trim()
    const task = rt.bgTasks.find(t => t.id === id)
    if (!task) continue
    task.status = /<status>([^<]+)<\/status>/.exec(body)?.[1]?.trim() ?? task.status
    task.summary = /<summary>([^<]+)<\/summary>/.exec(body)?.[1]?.trim() ?? task.summary
  }
}
// The background command the bar warns about: the newest that failed or logged an error, unseen.
export const failedTask = () =>
  [...rt.bgTasks].reverse().find(t => !t.isSeen && (t.status === 'failed' || Boolean(t.errorLine)))

// Every 30 seconds: each server is asked for / over HTTP, 3 seconds at most; a status of 0 is no
// answer at all. A server that is not HTTP (a database, a socket) answers 0 too.
export const HEALTH_EVERY = 30
export async function checkServers($: any) {
  const listening = await read($, servers)
  let isChanged = false
  for (const sv of listening) {
    const r = await $.process.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', `http://127.0.0.1:${sv.port}/`]).catch(() => undefined)
    const code = Number(String(r?.stdout ?? '').trim()) || 0
    if (rt.serverHealth[sv.port]?.code !== code) isChanged = true
    rt.serverHealth[sv.port] = { code, at: Date.now() }
  }
  if (isChanged) $.ui.invalidate('ui.render')
}
// A health status as the menu says it, and whether it is bad (no answer, or 5xx).
export const healthOf = (code: number | undefined) =>
  code === undefined ? undefined : code === 0 ? { text: '✘ no answer', isBad: true } : code >= 500 ? { text: `✘ ${code}`, isBad: true } : { text: `✓ ${code}`, isBad: false }
