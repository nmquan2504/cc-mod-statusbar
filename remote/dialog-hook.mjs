// The phone's half of Claude Code's own dialogs: a command hook, named in hooks/hooks.json.
//
//   node dialog-hook.mjs session-start   SessionStart: marks this session as one the hook runs in,
//                                        so the mod leaves its questions to the engine's dialog
//   node dialog-hook.mjs permission      PermissionRequest: the dialog is up; the hook asks the
//                                        hub to show it on the phone and waits for the answer
//
// Claude Code runs a PermissionRequest hook beside its dialog: the person answers at the computer
// (the engine then ends this process) or on the phone (the hub answers this request, and the hook
// prints the decision, which closes the dialog). With no hub, or a session the remote is off in,
// the hub answers null and the hook prints nothing: the dialog alone asks. Node 18 or newer.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'

const DIR = `/tmp/qsb-remote-${process.getuid?.() ?? ''}`
const MARKS = join(DIR, 'hooked')
const MARK_TTL = 7 * 24 * 3600_000
// the person's own dialogs: a plan to approve is the engine's to show
const SKIP = new Set(['ExitPlanMode', 'EnterPlanMode'])

const stdin = () =>
  new Promise(done => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', d => (text += d))
    process.stdin.on('end', () => done(text))
    process.stdin.on('error', () => done(text))
  })

// A session id is a file name here: letters, digits and dashes only.
const idOf = e => (/^[\w-]{1,128}$/.test(String(e?.session_id ?? '')) ? String(e.session_id) : '')

function markSession(id) {
  mkdirSync(MARKS, { recursive: true, mode: 0o700 })
  writeFileSync(join(MARKS, id), String(Date.now()))
  // the marks of sessions gone a week
  for (const name of readdirSync(MARKS)) {
    try {
      if (Date.now() - statSync(join(MARKS, name)).mtimeMs > MARK_TTL) rmSync(join(MARKS, name), { force: true })
    } catch {}
  }
}

// POST /held to the hub, and wait as long as the dialog is up for its answer.
function held(id, body) {
  return new Promise(done => {
    const req = request({ socketPath: join(DIR, 'hub.sock'), path: `/held?id=${encodeURIComponent(id)}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', d => (text += d))
      res.on('end', () => {
        try {
          done(res.statusCode === 200 ? JSON.parse(text)?.decision ?? null : null)
        } catch {
          done(null)
        }
      })
    })
    req.on('error', () => done(null))
    req.end(JSON.stringify(body))
  })
}

async function main() {
  const e = JSON.parse((await stdin()) || '{}')
  const id = idOf(e)
  if (!id) return
  if (process.argv[2] === 'session-start') return markSession(id)
  if (process.argv[2] !== 'permission' || SKIP.has(e.tool_name)) return
  const decision = await held(id, { tool: String(e.tool_name ?? ''), input: e.tool_input ?? {}, suggestions: e.permission_suggestions ?? null })
  if (!decision) return
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }))
}

// whatever fails, the dialog still asks: a hook that prints nothing decides nothing
main().catch(() => undefined)
