import { atom, read, update } from 'claude-code'
import { ME } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const collapsed = atom({ plugin: 'cc-mod-statusbar', key: 'collapsed' } as const, [])

// The commands you type, counted across sessions in this mod's store, for the top five.
export const USE_KEY = 'command-use'

export const TOP_GROUP = '0 · most used'

export async function countCommand($: any, name: string) {
  const all = ((await $.store.get(USE_KEY).catch(() => undefined)) ?? {}) as Record<string, { n: number; last: number }>
  all[name] = { n: (all[name]?.n ?? 0) + 1, last: Date.now() }
  await $.store.set(USE_KEY, all)
}

export const groupOf = (c: { source: string; plugin?: string }) =>
  c.source === 'plugin'
    ? c.plugin === ME
      ? '1 · cc-mod-statusbar (this mod)'
      : `2 · plugin ${c.plugin ?? ''}`.trim()
    : c.source === 'user'
      ? '3 · skills & your commands'
      : c.source === 'mcp'
        ? '4 · MCP'
        : '5 · built-in'

// The command groups folded away in the commands menu, kept across sessions in the store.
export const COLLAPSED_KEY = 'collapsed-groups'

export async function toggleGroup($: any, group: string) {
  const now = await read($, collapsed)
  const next = now.includes(group) ? now.filter(g => g !== group) : [...now, group]
  await update($, collapsed, () => next)
  await $.store.set(COLLAPSED_KEY, next).catch(() => undefined)
}
