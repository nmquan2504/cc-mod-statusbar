import { atom, update } from 'claude-code'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The files the main loop wrote this turn, with the lines each call added and removed.
const edited = atom({ plugin: 'cc-mod-statusbar', key: 'edited' } as const, [])

export const lineCount = (t: unknown) => (typeof t === 'string' && t.length ? t.split('\n').length : 0)

export async function keepEdit($: any, path: string, added: number, removed: number) {
  await update($, edited, l => {
    const was = l.find(f => f.path === path)
    const rest = l.filter(f => f.path !== path)
    return [...rest, { path, added: (was?.added ?? 0) + added, removed: (was?.removed ?? 0) + removed }]
  })
}
