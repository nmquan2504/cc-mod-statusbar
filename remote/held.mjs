// Claude Code's own dialogs, held for the phone: what the phone is asked and what its answer tells
// the engine. A PermissionRequest hook (dialog-hook.mjs) posts the dialog to the hub while it is up
// and waits; the phone sees the oldest held call as the session's question (a permission as Yes /
// don't ask again / No, an AskUserQuestion as itself) and answers it; the hook prints the decision,
// which closes the dialog. Answered at the computer, the engine leaves the hook running: the mod
// tells the hub when the call ends (isHeldCall picks it out) or the turn does. "Don't ask again"
// from the phone allows this call only; the rules it would add wait for Allow in the terminal
// (heldRules, taken by the mod), as every rule a phone loosens does. Kept out of server.mjs so the
// plugin's tests run it.
import { maskSecrets } from './mask.mjs'

export const HELD_YES = 'Yes'
export const HELD_NO = 'No'
const ruleText = r => (r?.ruleContent ? `${r.toolName}(${r.ruleContent})` : String(r?.toolName ?? ''))
// the allow rules the engine suggests, as settings.json spells them; its other suggestions (a
// folder to add, a mode to switch to) stay the dialog's at the computer
export function allowRulesOf(list) {
  const rules = []
  for (const u of Array.isArray(list) ? list : []) if (u?.type === 'addRules' && u.behavior === 'allow') rules.push(...(u.rules ?? []).map(ruleText))
  return rules.filter(r => /^[\w-]+(\([^()\n]{1,300}\))?$/.test(r) && maskSecrets(r) === r)
}
// a rule holding something shaped like a secret is not offered: the phone would show it
export const suggestionText = list => allowRulesOf(list).join(', ').slice(0, 300)
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
  if (suggestionText(h.suggestions)) options.push({ label: heldAlways(h), description: 'this time; the rule after Allow in the terminal' })
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
  if (isAlways(h, a)) return { behavior: 'allow' }
  if (a === HELD_YES || a.startsWith(`${HELD_YES}, `)) return { behavior: 'allow' }
  const said = a === HELD_NO ? '' : a.startsWith(`${HELD_NO}, `) ? a.slice(HELD_NO.length + 2) : a
  return { behavior: 'deny', message: said ? `The person declined this call and said: ${said}` : 'The person declined this call.' }
}

const isAlways = (h, a) => Boolean(suggestionText(h.suggestions)) && (a === heldAlways(h) || a.startsWith(`${heldAlways(h)}, `))
// The rules the phone's "don't ask again" asks for; the mod adds them after Allow in the terminal.
export function heldRules(h, answers, isDismissed) {
  if (isDismissed || h.tool === 'AskUserQuestion') return []
  return isAlways(h, String(Object.values(answers)[0] ?? '').trim()) ? allowRulesOf(h.suggestions) : []
}

// Whether a call that ended is this held one: the same tool, and the input the dialog showed (each
// field the hook was given, the same in the call).
// The mod sends the call's input shrunk (hooks/features/remote.ts shrinkInput), so both sides are
// shrunk the same way before they are compared.
export function isHeldCall(h, tool, input) {
  if (h.tool !== tool || !input || typeof input !== 'object') return false
  return Object.entries(h.input).every(([k, v]) => JSON.stringify(shrinkInput(input[k])) === JSON.stringify(shrinkInput(v)))
}

// keys sorted, a string over 2000 characters cut to its start and its length (under 2000 again, so a second pass changes nothing)
export function shrinkInput(v) {
  if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 1980)}…(${v.length})` : v
  if (Array.isArray(v)) return v.map(shrinkInput)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, shrinkInput(v[k])]))
  return v
}
