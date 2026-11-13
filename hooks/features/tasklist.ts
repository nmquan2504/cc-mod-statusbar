import { atom, read, update } from 'claude-code'
import { rt } from '../state/runtime'
import { isOn } from './guardrails'
import { hubDir } from './remote'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// Claude's task list, as events/tools.ts keeps it from TaskCreate, TaskUpdate and TodoWrite.
const tasks = atom({ plugin: 'cc-mod-statusbar', key: 'tasks' } as const, [])

// ---- the task-list guardrail's part that is not a hook: which tools keep a list, and the list ----

// The tools that keep a task list: Claude Code's own, and claude-mem's work state, which a session
// start hook may ask Claude to use instead
const BUILT_IN = ['TaskCreate', 'TaskUpdate', 'TodoWrite']
export const isTaskTool = (tool: string) => BUILT_IN.includes(tool) || tool.endsWith('__work_state_write')

// The task tools this session has, read once a turn (a session may have none of them)
export async function readTaskTools($: any) {
  const list: { name: string }[] = await $.tool.list().catch(() => [])
  rt.taskTools = list.map(t => t.name).filter(isTaskTool)
  return rt.taskTools
}

// The tasks still open: pending or in progress
export async function openTasks($: any) {
  return (await read($, tasks)).filter(t => t.status === 'pending' || t.status === 'in_progress')
}

// The list as the band shows it, for this run of work: the tasks done before the turn started
// left out, as the phone leaves them out. null when there is nothing to show.
export async function taskLine($: any) {
  const list = (await read($, tasks)).filter(t => !(t.status === 'completed' && rt.doneBefore.has(t.id)))
  if (!list.length) return null
  const done = list.filter(t => t.status === 'completed').length
  const now = list.find(t => t.status === 'in_progress') ?? list.find(t => t.status === 'pending')
  return { done, of: list.length, at: now ? list.indexOf(now) + 1 : list.length, subject: now?.subject ?? '', isAllDone: !now }
}

// claude-mem's work_state_write: an entry with a task, kept in the same list as Claude Code's tasks
// (todo, doing, done; dropped takes it off)
const WS_STATUS: Record<string, string> = { todo: 'pending', doing: 'in_progress', done: 'completed' }
export async function keepWorkState($: any, e: any) {
  const f = e.fields ?? {}
  const subject = typeof f.task === 'string' ? f.task : ''
  if (!subject) return
  const id = `ws:${String(e.list ?? '')}:${subject}`
  const status = WS_STATUS[String(f.status ?? 'todo')]
  await update($, tasks, l => {
    const rest = l.filter(t => t.id !== id)
    if (!status) return rest
    return l.some(t => t.id === id) ? l.map(t => (t.id === id ? { ...t, status } : t)) : [...rest, { id, subject, status }]
  })
}

// What the guardrail tells Claude: at the stop, at the nudge, and at the end of a turn
export const TASK_STOP = 'Stopped by the task-list guardrail: make a task list before you work, so the person can follow along (TaskCreate, TodoWrite, or work_state_write if that is the task tool here). One task is fine for a small job. Mark the first one in progress, then run this again.'
export const TASK_NUDGE = 'Stopped once by the task-list guardrail: the task list has not changed for a while. Bring it up to date (mark what is done, add tasks that came up, mark the one in progress), then run this again.'
// The rule each prompt carries while the guardrail is on: asked up front, so the stops are a
// backstop that seldom fires. Claude Code's built-in cc-plugin-sec-default plugin skips a plugin's
// prompt.compose hook (Team and Enterprise organizations), so the rule goes in by a command hook
// (remote/dialog-hook.mjs prompt-submit, UserPromptSubmit), which runs beneath every plugin.
export const TASK_RULE = [
  "# Task list (the person's task-list guardrail is on)",
  'Before you edit a file or run more than two commands, make a task list with your task tool (TaskCreate, TodoWrite, or work_state_write if that is the one here) so the person can follow along. One task is enough for a small job.',
  'Keep one task in progress at a time, add tasks as they come up, and mark each one done as you finish it.',
  'Before you finish a turn, bring the task list up to date: mark what is done, and for each task still open say what is left.',
].join('\n')

// The rule as the command hook reads it: /tmp/qsb-remote-<uid>/task-rule.txt, in the folder that is
// this user's own (mode 700). Empty while the guardrail is off; written at a session's start and at
// each switch, so it follows the switch every session shares.
export async function syncTaskRule($: any) {
  const dir = await hubDir($, true)
  if (!dir) return
  await $.fs.write(`${dir}/task-rule.txt`, isOn('taskList') ? `${TASK_RULE}\n` : '')
}
