import { rt } from '../state/runtime'

// The permission mode right now. The hint line is read from the frame on screen and can be a
// frame behind, so ask the permission checks instead: nothing runs and no dialog opens.
// Edit allowed: accept edits; refused for plan mode: plan; Edit and Bash both allowed: bypass;
// both denied: don't ask; both asked: manual or auto, which the hint line tells apart.
export async function probeMode($: any, root: string): Promise<string | undefined> {
  try {
    // a plain name: a dot file is a sensitive file, which every mode asks for
    const edit = await $.tool.check({ tool: 'Edit', input: { file_path: `${root}/qsb-mode-probe.txt`, old_string: 'a', new_string: 'b' } })
    const bash = await $.tool.check({ tool: 'Bash', input: { command: 'mode-probe --dry' } })
    if (edit.decision === 'allow' && bash.decision === 'allow') return 'bypass'
    if (edit.decision === 'deny' && bash.decision === 'deny') return 'dontAsk'
    if (/plan mode/i.test(edit.reason ?? '')) return 'plan'
    if (edit.decision === 'allow') return 'acceptEdits'
    // both ask: manual and auto look the same to the checks; the hint line tells them apart
    // (events/ui.ts reads it). None read yet: the bar keeps what it shows.
    return rt.hintMode
  } catch {
    return undefined // no session bound yet, or shutting down: keep what the bar shows
  }
}
