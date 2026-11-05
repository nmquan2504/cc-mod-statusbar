// Claude Code's own dialogs, held for the phone: what the phone is asked and what its answer tells
// the engine. A PermissionRequest hook (dialog-hook.mjs) posts the dialog to the hub while it is up
// and waits; the phone sees the oldest held call as the session's question (a permission as Yes /
// don't ask again / No, an AskUserQuestion as itself) and answers it; the hook prints the decision,
// which closes the dialog. Answered at the computer, the engine ends the hook and the held call
// goes. Kept out of server.mjs so the plugin's tests run it.
export const HELD_YES = 'Yes'
export const HELD_NO = 'No'
const ruleText = r => (r?.ruleContent ? `${r.toolName}(${r.ruleContent})` : String(r?.toolName ?? ''))
// the engine's own suggestions, as words: the rules to add, the folders to allow
export function suggestionText(list) {
  const said = []
  for (const u of Array.isArray(list) ? list : []) {
    if (u?.type === 'addRules' && u.behavior === 'allow') said.push(...(u.rules ?? []).map(ruleText))
    if (u?.type === 'addDirectories') said.push(...(u.directories ?? []).map(d => `the folder ${d}`))
    if (u?.type === 'setMode') said.push(`${u.mode} mode`)
  }
  return said.filter(Boolean).join(', ').slice(0, 300)
}
export const heldAlways = h => `Yes, and don't ask again: ${suggestionText(h.suggestions)}`
// the call as the dialog shows it: the whole command, the file or the URL, else the input
export function heldCall(input) {
  const str = v => (typeof v === 'string' ? v : '')
  const text = str(input.command) || str(input.file_path) || str(input.notebook_path) || str(input.url) || str(input.pattern) || JSON.stringify(input)
  return text.length > 1500 ? `${text.slice(0, 1500)}… ${text.length - 1500} more characters` : text
}
export function heldAsk(h) {
  const id = `held:${h.hid}`
  if (h.tool === 'AskUserQuestion' && Array.isArray(h.input.questions)) return { id, questions: h.input.questions }
  const options = [{ label: HELD_YES, description: 'this time' }]
  if (suggestionText(h.suggestions)) options.push({ label: heldAlways(h), description: 'as the dialog offers it' })
  options.push({ label: HELD_NO, description: 'or type below what Claude should do instead' })
  return { id, questions: [{ header: 'Permission', question: `Claude wants to use ${h.tool}: allow it?`, description: heldCall(h.input), options }] }
}
// The phone's answer as the hook's decision.
export function heldDecision(h, answers, isDismissed) {
  if (h.tool === 'AskUserQuestion') {
    if (isDismissed || !Object.keys(answers).length) return { behavior: 'deny', message: 'The person dismissed the question without answering. Go on with your best judgment, or ask in plain text if you cannot.' }
    return { behavior: 'allow', updatedInput: { ...h.input, answers } }
  }
  if (isDismissed) return { behavior: 'deny', message: 'The person dismissed the permission prompt without allowing the call.' }
  const a = String(Object.values(answers)[0] ?? '').trim()
  const always = heldAlways(h)
  if (suggestionText(h.suggestions) && (a === always || a.startsWith(`${always}, `))) return { behavior: 'allow', updatedPermissions: h.suggestions }
  if (a === HELD_YES || a.startsWith(`${HELD_YES}, `)) return { behavior: 'allow' }
  const said = a === HELD_NO ? '' : a.startsWith(`${HELD_NO}, `) ? a.slice(HELD_NO.length + 2) : a
  return { behavior: 'deny', message: said ? `The person declined this call and said: ${said}` : 'The person declined this call.' }
}
