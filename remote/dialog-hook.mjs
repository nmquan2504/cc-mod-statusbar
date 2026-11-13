// The phone's half of Claude Code's own dialogs: a command hook, named in hooks/hooks.json.
//
//   node dialog-hook.mjs session-start   SessionStart: marks this session as one the hook runs in,
//                                        so the mod leaves the phone's questions to the hub
//   node dialog-hook.mjs permission      PermissionRequest: the dialog is up; the hook asks the
//                                        hub to show it on the phone and waits for the answer
//   node dialog-hook.mjs prompt-submit   UserPromptSubmit: with the task-list guardrail on, its rule
//                                        (task-rule.txt, which the mod writes) goes in as context
//
// Claude Code runs a PermissionRequest hook beside its dialog: the person answers at the computer
// (the engine leaves this process running; the mod has the hub let it go) or on the phone (the hub
// answers this request, and the hook prints the decision, which closes the dialog). With no hub, or
// a session the remote is off in, the hub answers null and the hook prints nothing: the dialog alone
// asks. The hook trusts the folder only when it is this user's own (owndir.mjs), and prints only an
// allow or a deny it builds itself: never a rewritten command, a rule or a mode. Node 18 or newer.
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { isOwnDir } from './owndir.mjs'

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
  try {
    mkdirSync(DIR, { mode: 0o700 })
  } catch {}
  try {
    mkdirSync(MARKS, { mode: 0o700 })
  } catch {}
  if (!isOwnDir(DIR) || !isOwnDir(MARKS)) return
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

// The decision as the engine reads it, built from the hub's answer: allow or deny, a message, and
// for AskUserQuestion the answers (strings, for the questions asked) with the input unchanged.
function decisionOf(d, e) {
  if (d?.behavior === 'deny') return { behavior: 'deny', message: String(d.message ?? 'The person declined this call.').slice(0, 4000) }
  if (d?.behavior !== 'allow') return null
  if (e.tool_name !== 'AskUserQuestion') return { behavior: 'allow' }
  const asked = new Set((Array.isArray(e.tool_input?.questions) ? e.tool_input.questions : []).map(q => String(q?.question ?? '')))
  const answers = {}
  for (const [q, a] of Object.entries(d.updatedInput?.answers ?? {})) if (asked.has(q) && typeof a === 'string') answers[q] = a.slice(0, 4000)
  return Object.keys(answers).length ? { behavior: 'allow', updatedInput: { ...e.tool_input, answers } } : null
}

// The task-list rule, when the mod wrote one: a plain file of this user's in a folder of this
// user's own, never a link; empty while the guardrail is off
function taskRule() {
  if (!isOwnDir(DIR)) return ''
  const path = join(DIR, 'task-rule.txt')
  try {
    const st = lstatSync(path)
    if (!st.isFile() || st.uid !== process.getuid?.()) return ''
    return readFileSync(path, 'utf8').trim().slice(0, 4000)
  } catch {
    return ''
  }
}

async function main() {
  const e = JSON.parse((await stdin()) || '{}')
  const id = idOf(e)
  if (!id) return
  if (process.argv[2] === 'session-start') return markSession(id)
  if (process.argv[2] === 'prompt-submit') {
    const rule = taskRule()
    if (rule) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: rule } }))
    return
  }
  if (process.argv[2] !== 'permission' || SKIP.has(e.tool_name) || !isOwnDir(DIR)) return
  const answer = await held(id, { tool: String(e.tool_name ?? ''), input: e.tool_input ?? {}, suggestions: e.permission_suggestions ?? null })
  const decision = decisionOf(answer, e)
  if (!decision) return
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }))
}

// whatever fails, the dialog still asks: a hook that prints nothing decides nothing
main().catch(() => undefined)
