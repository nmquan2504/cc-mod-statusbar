import { atom, read } from 'claude-code'
import { oneLine } from '../lib/format'
import type { AskPending, AskQuestion } from './ask'
import { countAsk, rulesFor } from './permissions'
import { notifyRemote } from './remote'
import { describeCall } from './work'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})

// A permission prompt waiting for the person. The classic PermissionRequest and Notification hooks
// may never reach this mod (a plugin that runs first may not pass them on), so it is told from
// tool.check: a main-loop call the engine puts to a person, not let run since. While the dialog
// waits the spinner stays on tool-input; it turns to tool-use the moment the call runs, or the
// mode's classifier lets it. The phone shows it after SHOW_MS; after WAIT_MS it is counted toward
// "Asked most" and the phone gets a push, once. These are the prompts the mod does not ask itself
// (below): answered at the computer.
export const SHOW_MS = 1000
export const WAIT_MS = 5000
type Pending = { id: string; tool: string; input: Record<string, unknown>; reason: string; at: number; isTold?: boolean }
export const prompts = { pending: [] as Pending[], spinner: '' }

// Questions put to the person are the ask feature's, which the phone shows on its own.
const OWN_DIALOG = new Set(['AskUserQuestion'])

export function noteCheck(e: { tool: string; input: unknown; tool_use_id?: string; agentId?: string; approver?: string }, r: { decision?: string; reason?: string }, now: number) {
  if (r.decision !== 'ask' || !e.tool_use_id || e.agentId !== undefined || e.approver !== 'person' || OWN_DIALOG.has(e.tool)) return
  const input = (e.input && typeof e.input === 'object' ? e.input : {}) as Record<string, unknown>
  prompts.pending = [...prompts.pending.filter(p => p.id !== e.tool_use_id), { id: e.tool_use_id, tool: e.tool, input, reason: String(r.reason ?? ''), at: now }]
}

// A turn to tool-use: the waiting calls were let run. Only the turn counts: the spinner is drawn
// about every 100 ms, on tool-use already while another call runs.
export function noteSpinner(mode: string) {
  if (mode === 'tool-use' && prompts.spinner !== 'tool-use') prompts.pending = []
  prompts.spinner = mode
}

export function clearPrompts() {
  prompts.pending = []
}

// The prompts that have waited WAIT_MS and were not counted yet; marked counted.
export function duePrompts(now: number) {
  const due = prompts.pending.filter(p => !p.isTold && now - p.at >= WAIT_MS)
  for (const p of due) p.isTold = true
  return due
}

// The call, as the dialog shows it: the whole command, the file or the URL, else the input.
export function callText(input: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const text = str(input.command) || str(input.file_path) || str(input.notebook_path) || str(input.url) || str(input.pattern) || JSON.stringify(input)
  return text.length > 1500 ? `${text.slice(0, 1500)}… ${text.length - 1500} more characters` : text
}

// For the phone: the prompts waiting SHOW_MS or more, each with what it would run and why it asks.
export function waitingPrompts(now: number) {
  return prompts.pending.filter(p => now - p.at >= SHOW_MS).map(p => ({ id: p.id, tool: p.tool, text: callText(p.input), reason: p.reason, at: p.at }))
}

export async function tickPrompts($: any) {
  const due = duePrompts(Date.now())
  if (!due.length) return
  for (const p of due) await countAsk($, rulesFor({ tool_name: p.tool, tool_input: p.input })).catch(() => undefined)
  const folder = (await read($, bar)).folder
  const what = due.map(p => describeCall({ tool: p.tool, ...p.input })).join('; ')
  await notifyRemote($, `Claude needs you · /${folder}`, oneLine(`Asks to run ${what}`, 200)).catch(() => undefined)
}

// With Self remote on, a permission prompt is asked as Claude's questions are: in the band and on
// the phone, the first answer in deciding, and the engine's dialog not shown. "Yes, and don't ask
// again" adds the rule "Asked most" would suggest; a No can say what to do instead, in the Other box.
export const YES = 'Yes'
export const NO = 'No'
export const alwaysLabel = (rule: string) => `Yes, and don't ask again for ${rule}`

export function permissionQuestion(tool: string, input: Record<string, unknown>, rule: string, reason: string): AskQuestion {
  return {
    header: 'Permission',
    question: `Claude wants to use ${tool}: allow it?`,
    description: [callText(input), reason].filter(Boolean).join('\n'),
    options: [
      { label: YES, description: 'this time' },
      { label: alwaysLabel(rule), description: 'adds the rule to .claude/settings.local.json' },
      { label: NO, description: 'or type below what Claude should do instead' },
    ],
  }
}

// The verdict for tool.check from the answer: the label picked, then any text typed.
export function verdictOf(result: AskPending['result'], rule: string): { decision: 'allow' | 'deny'; reason: string; isAlways?: boolean } {
  if (!result || result === 'dismissed') return { decision: 'deny', reason: 'The person dismissed the permission prompt without allowing the call.' }
  const a = String(Object.values(result.answers)[0] ?? '').trim()
  const always = alwaysLabel(rule)
  if (a === always || a.startsWith(`${always}, `)) return { decision: 'allow', reason: `The person allowed it and added ${rule} to the allow rules.`, isAlways: true }
  if (a === YES || a.startsWith(`${YES}, `)) return { decision: 'allow', reason: 'The person allowed it.' }
  const said = a === NO ? '' : a.startsWith(`${NO}, `) ? a.slice(NO.length + 2) : a
  return { decision: 'deny', reason: said ? `The person declined this call and said: ${said}` : 'The person declined this call.' }
}
