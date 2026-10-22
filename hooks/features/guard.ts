import { atom, read, update } from 'claude-code'
import type { GuardInfo } from '../../types'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const guard = atom({ plugin: 'cc-mod-statusbar', key: 'guard' } as const, {
  deny: [], ask: 0, allow: 0, allowRules: [], sandbox: false, hooks: [], plugins: 0,
})

// The guardrails the merged settings put in force, as the shield shows them.
export async function readGuard($: any) {
  const s = (await $.settings.read().catch(() => ({}))) as {
    permissions?: { deny?: string[]; ask?: string[]; allow?: string[] }
    sandbox?: { enabled?: boolean }
    hooks?: Record<string, unknown>
    enabledPlugins?: Record<string, boolean>
  }
  const p = s.permissions ?? {}
  const info: GuardInfo = {
    deny: p.deny ?? [],
    ask: p.ask?.length ?? 0,
    allow: p.allow?.length ?? 0,
    allowRules: p.allow ?? [],
    sandbox: s.sandbox?.enabled === true,
    hooks: Object.keys(s.hooks ?? {}),
    plugins: Object.values(s.enabledPlugins ?? {}).filter(Boolean).length,
  }
  // read every 5 seconds: a write only when something changed, so the bar redraws only then
  if (JSON.stringify(info) === JSON.stringify(await read($, guard))) return
  await update($, guard, () => info)
}
