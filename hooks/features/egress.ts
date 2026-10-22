import { atom, update } from 'claude-code'
import type { EgressRow } from '../../types'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// Every host the session reached out to, for the shield menu's Network list.
const egress = atom({ plugin: 'cc-mod-statusbar', key: 'egress' } as const, [])

// The hosts one tool call reaches: a URL's host, user@host in ssh, scp and git, a remote MCP
// server by its name. The IDE bridge and this mod's own tools stay local (secret_fetch aside).
export const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?/gi

export const SSH_RE = /\b[\w.-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)[:\s/]/gi

export function hostsOf(e: any): string[] {
  const of = (text: string) => [
    ...[...text.matchAll(URL_RE)].map(m => m[1]!.toLowerCase()),
    ...[...text.matchAll(SSH_RE)].map(m => m[1]!.toLowerCase()),
  ]
  if (e.tool === 'WebFetch' || e.tool === 'mcp__cc-mod-statusbar__secret_fetch') return of(String(e.url ?? ''))
  if (e.tool === 'WebSearch') return ['web search']
  if (e.tool === 'Bash') return of(String(e.command ?? ''))
  const mcp = /^mcp__(.+?)__/.exec(e.tool)?.[1]
  if (mcp && mcp !== 'ide' && mcp !== 'cc-mod-statusbar') return [`mcp: ${mcp}`]
  return []
}

export async function keepEgress($: any, hosts: string[], via: string, isBlocked: boolean) {
  const at = Date.now()
  await update($, egress, l => {
    let next = [...l]
    for (const host of new Set(hosts)) {
      const was = next.find(r => r.host === host)
      const row: EgressRow = {
        host,
        count: (was?.count ?? 0) + 1,
        blocked: (was?.blocked ?? 0) + (isBlocked ? 1 : 0),
        via: was?.via.includes(via) ? was.via : [...(was?.via ?? []), via],
        lastAt: at,
      }
      next = [...next.filter(r => r.host !== host), row]
    }
    return next.slice(-100)
  })
}
