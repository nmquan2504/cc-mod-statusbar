import { atom, update } from 'claude-code'
import type { McpRow, McpCheckRow } from '../../types'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The MCP servers: those connected, from the tool list; every configured one with its health,
// from the last `claude mcp list`; and each server's calls this session.
const mcpServers = atom({ plugin: 'cc-mod-statusbar', key: 'mcpServers' } as const, [])
const mcpCheck = atom({ plugin: 'cc-mod-statusbar', key: 'mcpCheck' } as const, null)
const mcpCalls = atom({ plugin: 'cc-mod-statusbar', key: 'mcpCalls' } as const, [])

// The task list as TaskList has it, when the engine answers it outside a turn, and the agents.
// claude_ai_Google_Drive -> claude.ai Google Drive, as /mcp names it; others as the tool says.
export const mcpName = (key: string) => (key.startsWith('claude_ai_') ? `claude.ai ${key.slice(10).replace(/_/g, ' ')}` : key)

// The tools a claude.ai connector shows before it is signed in: it has nothing else yet.
export const AUTH_TOOLS = new Set(['authenticate', 'complete_authentication'])

// The servers connected now, from the tool list: mcp__<server>__<tool>.
export async function readMcp($: any) {
  const list: { name: string; mcp: boolean }[] = await $.tool.list().catch(() => [])
  const by = new Map<string, string[]>()
  for (const t of list) {
    const m = /^mcp__(.+?)__(.+)$/.exec(t.name)
    if (!m) continue
    by.set(m[1]!, [...(by.get(m[1]!) ?? []), m[2]!])
  }
  const rows: McpRow[] = [...by].map(([key, tools]) => ({
    key,
    name: mcpName(key),
    tools: tools.length,
    needsAuth: tools.every(t => AUTH_TOOLS.has(t)),
  }))
  await update($, mcpServers, () => rows.sort((p, q) => Number(p.needsAuth) - Number(q.needsAuth) || p.name.localeCompare(q.name)))
}

export async function checkMcp($: any) {
  if (rt.isCheckingMcp) return
  rt.isCheckingMcp = true
  $.ui.invalidate('ui.render')
  try {
    const cwd: string = await $.session.cwd().catch(() => '.')
    const r = await $.process.run(['claude', 'mcp', 'list'], { cwd, timeoutMs: 90_000 }).catch(() => undefined)
    if (!r) return void $.ui.toast('statusbar: could not run claude mcp list')
    const rows: McpCheckRow[] = []
    for (const line of String(r.stdout).split('\n')) {
      const m = /^(.+?): (.+) - (✔|!|✘) (.+)$/.exec(line.trim())
      if (!m) continue
      const status = m[3] === '✔' ? 'connected' : m[3] === '!' ? 'auth' : 'failed'
      const target = /^https?:\/\//.test(m[2]!) ? m[2]!.replace(/[?#].*$/, '') : (m[2]!.split(' ')[0]!.split('/').pop() ?? '')
      const detail = m[4]!.replace(/^(Connected|Needs authentication)$/, '').replace(/^Failed to connect\s*—?\s*/, '')
      rows.push({ name: m[1]!, status, target, detail })
    }
    await update($, mcpCheck, () => ({ at: Date.now(), rows }))
  } finally {
    rt.isCheckingMcp = false
    $.ui.invalidate('ui.render')
  }
}

export async function keepMcpCall($: any, key: string, isError: boolean) {
  await update($, mcpCalls, l => {
    const was = l.find(c => c.key === key)
    const row = { key, calls: (was?.calls ?? 0) + 1, errors: (was?.errors ?? 0) + (isError ? 1 : 0) }
    return [...l.filter(c => c.key !== key), row]
  })
}
