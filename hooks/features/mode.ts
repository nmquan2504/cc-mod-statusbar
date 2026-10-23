import { rt } from '../state/runtime'

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
