import { atom, read, update } from 'claude-code'
import { rt } from '../state/runtime'

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
export const TASKS_TEXT = 'Before you finish: bring the task list up to date. Mark what is done, and for each task still open say what is left.'
