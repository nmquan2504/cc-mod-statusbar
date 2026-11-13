import { logAudit } from '../features/audit'
import { hostsOf } from '../features/egress'
import { isHostAllowed, isOn } from '../features/guardrails'
import { TASKS_TEXT, TASK_NUDGE, TASK_STOP, isTaskTool, keepWorkState, openTasks, readTaskTools } from '../features/tasklist'
import { rootsOf } from '../features/remote'
import { VERIFY_RE, gitRisk, newPackage } from '../lib/gitguard'
import { oneLine } from '../lib/format'
import { projectDir } from '../lib/project'
import { cfg, saveSettings } from '../state/config'
import { rt } from '../state/runtime'
import type { On } from 'claude-code'

// The guardrails this mod enforces (features/guardrails.ts lists them, the shield menu switches
// them). Each asks the person in Claude Code's own question dialog where it asks; a dialog that
// cannot open (dismissed, a -p run) counts as no.
async function asked($: any, question: string, header: string, options: string[]): Promise<string> {
  return (await $.ui.ask(question, { header, options }).catch(() => '')) as string
}

const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
// the calls in a row with the task list unchanged before the guardrail nudges
export const TASK_STALE = 8
// a prompt the guardrails sent (prove done, the task list), not the person's own
const isGuardPrompt = (text: string) => text.includes(PROVE_TEXT) || text.includes(TASKS_TEXT)

export const PROVE_TEXT = 'Before you call this done: run the tests, the build or the type check that show these changes work, and show what they printed. If nothing here can check them, say so plainly and say how to check them by hand.'

// a path made absolute and its . and .. resolved
function normal(path: string, cwd: string) {
  const parts: string[] = []
  for (const p of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (!p || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return `/${parts.join('/')}`
}
const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir.replace(/\/+$/, '')}/`)

// ---- stay in the project: Edit, Write and NotebookEdit outside it ask --------------------------
async function stayIn($: any, e: any, next: any) {
  if (!isOn('outside')) return next(e)
  const raw = String(e.file_path ?? e.notebook_path ?? '')
  if (!raw) return next(e)
  const { cwd, dirs } = await rootsOf($).catch(() => ({ cwd: '', dirs: [] as string[] }))
  if (!cwd) return next(e)
  const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
  const tmp: string = (await $.env.get('TMPDIR').catch(() => '')) ?? ''
  const path = normal(raw.startsWith('~/') && home ? `${home}${raw.slice(1)}` : raw, cwd)
  // the project, its added folders, the temp folders, and the plans and memory Claude Code keeps
  const inside = [cwd, ...dirs, '/tmp', '/private/tmp', tmp, home && `${home}/.claude/plans`, home && `${home}/.claude/projects`, ...rt.outsideAllowed].filter(Boolean)
  if (inside.some(d => under(path, normal(d, cwd)))) return next(e)
  const folder = path.slice(0, path.lastIndexOf('/')) || '/'
  const ONCE = 'Allow once', FOLDER = `Allow ${folder} for this session`, NO = 'Refuse'
  const answer = await asked($, `${e.agentId ? 'An agent of Claude' : 'Claude'} wants to write outside the project: ${path}. Allow it?`, '◈ outside', [ONCE, FOLDER, NO])
  if (answer === FOLDER) rt.outsideAllowed.add(folder)
  if (answer === ONCE || answer === FOLDER) {
    await logAudit($, `◈ outside: you allowed ${path}`)
    return next(e)
  }
  await logAudit($, `◈ outside: you refused ${path}`, true)
  return { deny: `The person refused a write outside the project (${path}) at the stay-in-the-project guardrail. Keep to the project's folders, or ask them.` }
}
function stayInFailed($: any, e: any, next: any) {
  return next.called ? next(e) : { deny: 'The stay-in-the-project check failed, so the write was refused.' }
}

export function registerGuards(on: On) {
  // ---- protect git, new packages, the allowlist on Bash -------------------------------------------
  on('tool.call', { tool: 'Bash' }, async ($, e: any, next) => {
    const command = String(e.command ?? '')
    const who = e.agentId ? 'An agent of Claude' : 'Claude'
    if (isOn('git') && /\bgit\b/.test(command)) {
      const root = await projectDir($).catch(() => '')
      const git = async (args: string[]) => (await $.process.run(['git', '-C', root || '.', ...args]).catch(() => undefined)) as { exitCode: number; stdout: string } | undefined
      const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
      const branch = head?.exitCode === 0 ? head.stdout.trim() : null
      const up = /\breset\b/.test(command) ? await git(['rev-parse', '--abbrev-ref', '@{u}']) : undefined
      const risk = gitRisk(command, branch, up?.exitCode === 0)
      if (risk?.kind === 'deny') {
        await logAudit($, `◈ git: refused ${oneLine(command, 60)}`, true)
        return { deny: `Refused by the protect-git guardrail: ${risk.why}. Do not try another way; ask the person if they want it, and they can switch the guardrail off in the shield menu.` }
      }
      // reset --hard: the dangerous-command check asks it when that is on, so one question, not two
      if (risk?.kind === 'ask' && !cfg.dangerConfirm) {
        const RUN = 'Run it', STOP = 'Do not run'
        if ((await asked($, `${who} wants to run ${oneLine(command, 140)}: ${risk.why}. Run it?`, '◈ git', [RUN, STOP])) !== RUN) {
          await logAudit($, `◈ git: you refused ${oneLine(command, 60)}`, true)
          return { deny: 'The person refused this command at the protect-git guardrail. Ask them what they want instead.' }
        }
      }
    }
    if (isOn('deps')) {
      const pkg = newPackage(command)
      if (pkg) {
        const YES = 'Install it', NO = 'Do not install'
        if ((await asked($, `${who} wants to install a new package, ${pkg}: ${oneLine(command, 140)}. Install it?`, '◈ package', [YES, NO])) !== YES) {
          await logAudit($, `◈ package: you refused ${pkg}`, true)
          return { deny: `The person refused installing ${pkg} at the new-packages guardrail. Ask them before adding a dependency.` }
        }
        await logAudit($, `◈ package: you allowed ${pkg}`)
      }
    }
    const refused = await egressCheck($, e, who)
    return refused ?? next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'A guardrail check failed, so the command was refused.' }))

  on('tool.call', { tool: 'WebFetch' }, async ($, e: any, next) => (await egressCheck($, e, e.agentId ? 'An agent of Claude' : 'Claude')) ?? next(e))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'The network allowlist check failed, so the fetch was refused.' }))

  // ---- stay in the project: Edit, Write and NotebookEdit outside it ask
  on('tool.call', { tool: 'Edit' }, stayIn).catch(stayInFailed)
  on('tool.call', { tool: 'Write' }, stayIn).catch(stayInFailed)
  on('tool.call', { tool: 'NotebookEdit' }, stayIn).catch(stayInFailed)

}

// ---- task list first: the main loop's first edit, or its third command, with no task list is
// stopped once a turn; a list left as it was for TASK_STALE calls is nudged once until it changes.
// Called from events/tools.ts's one unmatched tool.call hook: before the call, the refusal or
// nothing; after it, what a task tool changed.
export async function taskListGate($: any, e: any): Promise<{ deny: string } | undefined> {
  if (e.agentId || !isOn('taskList') || isTaskTool(e.tool)) return undefined
  // a session with no task tool has no list to make: the guardrail stands down
  if (!(rt.taskTools ?? (await readTaskTools($))).length) return undefined
  const isWork = WRITE_TOOLS.includes(e.tool) || (e.tool === 'Bash' && ++rt.taskBash >= 3)
  rt.callsSinceTask++
  const hasList = rt.isTaskTouched || (await openTasks($)).length > 0
  if (isWork && !hasList && !rt.isTaskGated) {
    rt.isTaskGated = true
    await logAudit($, `◈ task list: ${e.tool} stopped, no task list yet; Claude is asked to make one`, true)
    return { deny: TASK_STOP }
  }
  if (hasList && rt.callsSinceTask >= TASK_STALE && !rt.isTaskNudged) {
    rt.isTaskNudged = true
    rt.callsSinceTask = 0
    await logAudit($, `◈ task list: ${TASK_STALE} calls with the list unchanged; Claude is asked to update it`, true)
    return { deny: TASK_NUDGE }
  }
  return undefined
}

export async function taskListAfter($: any, e: any, r: any) {
  if (e.agentId || !isOn('taskList') || !isTaskTool(e.tool) || r?.deny || r?.isError) return
  rt.isTaskTouched = true
  rt.callsSinceTask = 0
  rt.isTaskNudged = false
  if (e.tool.endsWith('__work_state_write')) await keepWorkState($, e)
}

// The guardrails' part of a turn's start (called from events/turn.ts, which holds the one
// turn.start hook): the calls list and the budget start over; a prompt of the person's own lets
// prove done ask once again.
export function guardsOnTurnStart($: any, e: any) {
  if (e.agentId) return
  rt.turnCalls = []
  rt.budgetWarned = false
  rt.budgetStopped = false
  rt.isTaskTouched = false
  rt.taskBash = 0
  rt.callsSinceTask = 0
  rt.isTaskGated = false
  rt.isTaskNudged = false
  if (!isGuardPrompt(String(e.text ?? ''))) {
    rt.isProveAsked = false
    rt.isTasksAsked = false
  }
  // which task tools the session has, read again each turn (an MCP server may have come or gone)
  if (isOn('taskList')) void readTaskTools($).catch(() => undefined)
  // the budget's timer starts with the first turn that has the guardrail on
  if (isOn('budget')) startBudgetTimer($)
}

// At a main-loop answer (called from events/turn.ts's turn.complete), one prompt for what the
// guardrails still want, both asks in it when both want something:
//   prove done: files changed and nothing run since to check them asks Claude once to show it
//     works; a second time, a toast.
//   task list: tasks left open after a turn that worked asks Claude once to bring the list up to
//     date and say what is left.
export async function guardsOnTurnComplete($: any, e: any) {
  if (e.agentId || e.reason !== 'answer') return
  const asks: string[] = []
  const calls = rt.turnCalls
  const lastEdit = calls.map(c => WRITE_TOOLS.includes(c.tool) && !/\.(md|mdx|txt|rst|adoc)$/i.test(c.path ?? '')).lastIndexOf(true)
  if (isOn('proveDone') && lastEdit >= 0 && !calls.slice(lastEdit + 1).some(c => c.tool === 'Bash' && VERIFY_RE.test(c.command ?? ''))) {
    if (!rt.isProveAsked) {
      rt.isProveAsked = true
      await logAudit($, '◈ prove done: files changed and nothing checked them; Claude is asked to show it')
      asks.push(PROVE_TEXT)
    } else {
      await logAudit($, '◈ prove done: still nothing checked the changes', true)
      $.ui.toast('statusbar: ◈ prove done: the changes were not checked (no test, build or type check ran after the last edit)')
    }
  }
  if (isOn('taskList') && !rt.isTasksAsked && rt.taskTools?.length && (rt.isTaskTouched || calls.length > 0) && (await openTasks($)).length) {
    rt.isTasksAsked = true
    await logAudit($, '◈ task list: the turn ended with tasks open; Claude is asked to bring the list up to date')
    asks.push(TASKS_TEXT)
  }
  if (asks.length) void $.prompt.submit({ text: asks.join('\n\n'), asUser: true }).catch(() => undefined)
}

// ---- the network allowlist: a host off it asks before a call reaches it ---------------------------
async function egressCheck($: any, e: any, who: string) {
  if (!isOn('egress')) return undefined
  const hosts = [...new Set(hostsOf(e).filter(h => /^[a-z0-9.-]+$/.test(h) && !isHostAllowed(h) && !rt.hostsAllowed.has(h)))]
  for (const host of hosts) {
    const ONCE = 'Allow once', ALWAYS = `Always allow ${host}`, NO = 'Refuse'
    const answer = await asked($, `${who} wants to reach ${host}, which is not on the network allowlist: ${oneLine(String(e.url ?? e.command ?? ''), 140)}. Allow it?`, '◈ network', [ONCE, ALWAYS, NO])
    if (answer === ALWAYS) {
      cfg.egressHosts = [...cfg.egressHosts.split(',').filter(Boolean), host].join(',')
      await saveSettings($)
    } else if (answer === ONCE) rt.hostsAllowed.add(host)
    else {
      await logAudit($, `◈ network: you refused ${host}`, true)
      return { deny: `The person refused reaching ${host} at the network allowlist. Do not reach it another way; ask them.` }
    }
    await logAudit($, `◈ network: you allowed ${host}${answer === ALWAYS ? ' (kept)' : ''}`)
  }
  return undefined
}

// ---- the turn budget: a toast at it, the turn stopped at twice it ----------------------------------
function startBudgetTimer($: any) {
  if (rt.isBudgetTimer) return
  rt.isBudgetTimer = true
  $.clock.every(5000, async () => {
    if (!isOn('budget') || !rt.isBusy || !rt.turnStartedAt || rt.budgetStopped) return
    const minutes = ((await $.clock.now()) - rt.turnStartedAt) / 60_000
    const cost = rt.turnCostAt === null ? 0 : (((await $.session.usage().catch(() => undefined))?.cost?.usd ?? rt.turnCostAt) - rt.turnCostAt)
    const share = Math.max(cost / cfg.budgetUsd, minutes / cfg.budgetMinutes)
    const spent = `$${cost.toFixed(2)} and ${Math.round(minutes)} min`
    if (share >= 2 && rt.turnId) {
      rt.budgetStopped = true
      await logAudit($, `◈ budget: the turn passed twice its budget (${spent}) and was stopped`, true)
      await $.turn.abort({ turnId: rt.turnId }).catch(() => undefined)
      $.ui.toast(`statusbar: ◈ budget: the turn was stopped at ${spent}, twice its budget ($${cfg.budgetUsd} or ${cfg.budgetMinutes} min)`)
    } else if (share >= 1 && !rt.budgetWarned) {
      rt.budgetWarned = true
      await logAudit($, `◈ budget: the turn reached its budget (${spent})`)
      $.ui.toast(`statusbar: ◈ budget: this turn has used ${spent}, its budget; it stops at twice that`)
    }
  })
}
