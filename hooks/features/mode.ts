import { atom, read, update } from 'claude-code'
import { MODES } from '../lib/catalog'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})

// The permission mode a settings-hook event carried, kept for the bar.
export async function keepMode($: any, id: string | undefined) {
  const found = MODES.find(m => m.id === id)
  if (found && found.mode !== (await read($, bar)).mode) await update($, bar, b => ({ ...b, mode: found.mode }))
}

// The permission mode right now. The hint line is read from the frame on screen and can be a
// frame behind, so ask the permission checks instead: nothing runs and no dialog opens.
// Edit allowed: accept edits; refused for plan mode: plan; Edit and Bash both allowed: bypass;
// both denied: don't ask; both asked: manual or auto, which the hint line tells apart.
export async function probeMode($: any, root: string): Promise<string | undefined> {
  try {
    const edit = await $.tool.check({ tool: 'Edit', input: { file_path: `${root}/.mode-probe`, old_string: 'a', new_string: 'b' } })
    const bash = await $.tool.check({ tool: 'Bash', input: { command: 'mode-probe --dry' } })
    if (edit.decision === 'allow' && bash.decision === 'allow') return 'bypass'
    if (edit.decision === 'deny' && bash.decision === 'deny') return 'dontAsk'
    if (/plan mode/i.test(edit.reason ?? '')) return 'plan'
    if (edit.decision === 'allow') return 'acceptEdits'
    if (/\? for shortcuts/.test(rt.lastHint)) return 'manual'
    if (/shift\+tab to cycle/.test(rt.lastHint)) return 'auto'
    return undefined
  } catch {
    return undefined // no session bound yet, or shutting down: keep what the bar shows
  }
}
