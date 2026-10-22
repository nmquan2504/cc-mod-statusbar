import { atom, update } from 'claude-code'
import { arena, arenaEvents } from '../features/arena'
import { logAudit } from '../features/audit'
import { keepEdit, lineCount } from '../features/edits'
import { hostsOf, keepEgress } from '../features/egress'
import { keepMcpCall } from '../features/mcp'
import { IN_TEXT, SERVICE, cache } from '../features/vault'
import { describeCall } from '../features/work'
import { dangerOf } from '../lib/danger'
import { oneLine } from '../lib/format'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// What Claude is working through, for the tasks menu Claude's ✻ opens: its task list (from
// TaskCreate, TaskUpdate, TodoWrite and TaskList) and the agents running for it.
const tasks = atom({ plugin: 'cc-mod-statusbar', key: 'tasks' } as const, [])
// The dangerous commands caught this session, for the ⚠ n chip beside the shield.
const dangers = atom({ plugin: 'cc-mod-statusbar', key: 'dangers' } as const, 0)

import type { On } from 'claude-code'

export function registerTools(on: On) {
  // ---- what Claude works on: the tool now, and its task list ------------------
  // One hook for every tool (the engine takes one without a matcher): the main loop's tool
  // now, for the tasks menu, and every host a call reaches, the main loop's and its agents',
  // for the shield menu's Network list.
  // A dangerous Bash command asks the person in Claude Code's own question dialog, in any mode:
  // in auto or bypass no one else would. Where the engine itself will ask the person (manual,
  // accept edits, plan, with no allow rule) its dialog is the one asked; a deny needs no asking.
  // A dialog that cannot open (dismissed, a -p run) refuses the command. rm -rf on the disk, the
  // home folder or the project is refused with no question: a press on Run there costs too much.
  on('tool.call', { tool: 'Bash' }, async ($, e: any, next) => {
    const command = String(e.command ?? '')
    if (!cfg.dangerConfirm) return next(e)
    const where = {
      home: (await $.env.get('HOME').catch(() => undefined)) ?? undefined,
      cwd: (await $.session.cwd().catch(() => undefined)) ?? undefined,
      tmpdir: (await $.env.get('TMPDIR').catch(() => undefined)) ?? undefined,
    }
    const found = dangerOf(command, where)
    if (!found) return next(e)
    await update($, dangers, n => n + 1)
    const danger = found.name
    if (found.isBlocked) {
      await logAudit($, `⚠ ${danger} on ${found.target}: refused, ${oneLine(command, 60)}`, true)
      return { deny: `Refused: ${danger} on ${found.target} would delete ${found.target === '/' ? 'the whole disk' : 'the home folder, a parent folder or the project itself'}. This check refuses it without asking. Name what to delete inside the folder instead, or ask the person to run it themselves.` }
    }
    const who = e.agentId ? 'an agent of Claude' : 'Claude'
    const verdict = await $.tool.check({ tool: 'Bash', input: { command } }).catch(() => undefined)
    const isPersonAsked = verdict?.decision === 'ask' && ['manual', 'acceptEdits', 'plan'].includes(rt.drawnMode ?? '')
    if (verdict?.decision === 'deny' || isPersonAsked) {
      const r: any = await next(e)
      await logAudit($, `⚠ ${danger}: ${r?.deny ? 'refused' : 'ran'}, ${oneLine(command, 60)}`, Boolean(r?.deny))
      return r
    }
    const RUN = 'Run it', STOP = 'Do not run'
    const answer = await $.ui.ask(`${who} wants to run a dangerous command (${danger}): ${oneLine(command, 160)} Run it?`, { header: '⚠ danger', options: [RUN, STOP] })
      .catch(() => STOP)
    if (answer !== RUN) {
      await logAudit($, `⚠ ${danger}: you refused, ${oneLine(command, 60)}`, true)
      return { deny: `The person refused this command at the dangerous-command check (${danger}). Do not run it another way; ask them what they want instead.` }
    }
    await logAudit($, `⚠ ${danger}: you allowed, ${oneLine(command, 60)}`)
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'The dangerous-command check failed, so the command was refused.' }))

  on('tool.call', async ($, e, next) => {
    const isMain = !e.agentId && e.tool !== 'TaskList'
    const hosts = hostsOf(e)
    if (isMain) {
      rt.nowTool = describeCall(e)
      rt.turnTools = [...rt.turnTools, rt.nowTool].slice(-60)
    }
    if (rt.isBusy && e.tool !== 'TaskList') {
      arenaEvents.lastToolAt = Date.now()
      arenaEvents.spawns = [...arenaEvents.spawns, e.tool].slice(-12)
    }
    if (e.agentId && e.tool !== 'TaskList') {
      const log = (rt.agentLog[e.agentId] ??= { startedAt: Date.now(), tools: [] })
      log.tools = [...log.tools, describeCall(e)].slice(-30)
    }
    try {
      const r: any = await next(e)
      // a command left running in the background: its log is the session's tasks/<id>.output
      const bgId = e.tool === 'Bash' ? r?.result?.backgroundTaskId : undefined
      if (typeof bgId === 'string' && /^[\w-]+$/.test(bgId))
        rt.bgTasks = [...rt.bgTasks.filter(t => t.id !== bgId), { id: bgId, command: String((e as { command?: string }).command ?? ''), at: Date.now() }].slice(-10)
      if (rt.isBusy && e.tool !== 'TaskList') {
        const isFailed = Boolean(r?.isError) || (e.tool === 'Bash' && typeof r?.result?.exitCode === 'number' && r.result.exitCode !== 0)
        if (isFailed) arenaEvents.errors++
        else if (!r?.deny && arena.monsters.some(m => m.isError)) arenaEvents.fixes++
      }
      const server = /^mcp__(.+?)__/.exec(e.tool)?.[1]
      if (server) await keepMcpCall($, server, Boolean(r?.deny || r?.isError)).catch(() => undefined)
      if (hosts.length) {
        const via = e.tool === 'mcp__cc-mod-statusbar__secret_fetch' ? 'secret_fetch' : e.tool.startsWith('mcp__') ? 'MCP' : e.tool
        await keepEgress($, hosts, e.agentId ? `${via} (agent)` : via, Boolean(r?.deny)).catch(() => undefined)
      }
      return r
    } finally {
      if (isMain) rt.nowTool = ''
    }
  })

  // the files the main loop writes, for "Edited this turn"
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r: any = await next(e)
    if (!e.agentId && r && !r.deny && !r.isError) await keepEdit($, e.file_path, lineCount(e.new_string), lineCount(e.old_string))
    return r
  }).catch(($, e, next) => next(e)) // keeping the list never holds up the tool
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r: any = await next(e)
    if (!e.agentId && r && !r.deny && !r.isError) await keepEdit($, e.file_path, lineCount(e.content), 0)
    return r
  }).catch(($, e, next) => next(e)) // keeping the list never holds up the tool

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r: any = await next(e)
    const t = r?.result?.task
    if (t && !e.agentId) await update($, tasks, l => [...l, { id: String(t.id), subject: String(t.subject), status: 'pending' }])
    return r
  }).catch(($, e, next) => next(e)) // keeping the list never holds up the tool

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r: any = await next(e)
    if (r?.result?.success && e.status === 'completed' && rt.isBusy) arenaEvents.volleys++
    if (r?.result?.success && !e.agentId) {
      const id = String(e.taskId)
      await update($, tasks, l =>
        e.status === 'deleted'
          ? l.filter(t => t.id !== id)
          : l.map(t => (t.id === id ? { ...t, subject: e.subject ?? t.subject, status: e.status ?? t.status } : t)))
    }
    return r
  }).catch(($, e, next) => next(e)) // keeping the list never holds up the tool

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r: any = await next(e)
    if (!e.agentId)
      await update($, tasks, () => e.todos.map((t, i) => ({
        id: `todo-${i}`,
        subject: t.status === 'in_progress' ? t.activeForm : t.content,
        status: t.status,
      })))
    return r
  }).catch(($, e, next) => next(e)) // keeping the list never holds up the tool

  // web content in: from here on a secret goes out on GET only
  on('tool.call', { tool: 'WebFetch' }, ($, e, next) => {
    rt.isTainted = true
    return next(e)
  })
  on('tool.call', { tool: 'WebSearch' }, ($, e, next) => {
    rt.isTainted = true
    return next(e)
  })

  // keep Claude away from the vault in the shell
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const c = e.command
    const hit = c.includes(SERVICE) || new RegExp(IN_TEXT.source).test(c) || [...cache.values()].some(v => c.includes(v))
    if (!hit) return next(e)
    void logAudit($, `blocked a Bash command that reached the vault: ${oneLine(c, 50)}`, true)
    return { deny: 'statusbar vault: secrets are used only through secret_fetch.' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'statusbar vault: its guard failed.' }))
}
