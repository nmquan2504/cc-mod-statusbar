import { atom, update } from 'claude-code'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// What the guardrails did this session, newest last, for the shield menu.
const audit = atom({ plugin: 'cc-mod-statusbar', key: 'audit' } as const, [])

export async function logAudit($: any, line: string, isBlock = false) {
  await update($, audit, l => [...l, { at: Date.now(), line, isBlock }].slice(-50))
}
