import { expect, test } from 'claude-code/testing'
import { shrinkInput as modShrink } from '../hooks/features/remote'
import { heldAsk, heldCall, heldDecision, heldRules, isHeldCall, shrinkInput, suggestionText } from '../remote/held.mjs'
import type { Held } from '../remote/held.mjs'

// Claude Code's own dialogs, held for the phone (remote/held.mjs): the question the phone is
// asked while the dialog is up at the computer, and the decision its answer prints for the engine.

const held = (more: Partial<Held> = {}): Held => ({ hid: 'h1', tool: 'Bash', input: { command: 'mkdir /tmp/x' }, suggestions: null, at: 0, ...more })
const RULES = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'mkdir:*' }], behavior: 'allow', destination: 'localSettings' }]

test('a permission dialog reads on the phone as Yes and No, with the call as the dialog shows it', () => {
  const a = heldAsk(held())
  expect(a.id).toBe('held:h1')
  expect(a.questions).toEqual([{
    header: 'Permission',
    question: 'Claude wants to use Bash: allow it?',
    description: 'mkdir /tmp/x',
    options: [{ label: 'Yes', description: 'this time' }, { label: 'No', description: 'or type below what Claude should do instead' }],
  }])
  expect(heldCall({ file_path: '/work/a.md', content: 'x' })).toBe('/work/a.md')
  expect(heldCall({ command: 'x'.repeat(1600) })).toBe(`${'x'.repeat(1500)}… 100 more characters`)
})

test('"don\'t ask again" is offered only when the dialog suggests allow rules; the phone allows the call, the rules wait for the terminal', () => {
  expect(suggestionText(RULES)).toBe('Bash(mkdir:*)')
  // a folder or a mode stays the dialog's own, at the computer
  expect(suggestionText([{ type: 'addDirectories', directories: ['/work/lib'], destination: 'session' }, { type: 'setMode', mode: 'bypassPermissions' }])).toBe('')
  const h = held({ suggestions: RULES })
  const labels = heldAsk(h).questions[0]!.options!.map(o => o.label)
  expect(labels).toEqual(['Yes', "Yes, and don't ask again: Bash(mkdir:*)", 'No'])
  expect(heldAsk(held({ suggestions: [{ type: 'setMode', mode: 'bypassPermissions' }] })).questions[0]!.options!.map(o => o.label)).toEqual(['Yes', 'No'])
  const q = heldAsk(h).questions[0]!.question
  const always = { [q]: "Yes, and don't ask again: Bash(mkdir:*)" }
  // never updatedPermissions: the phone cannot add a rule by itself
  expect(heldDecision(h, always, false)).toEqual({ behavior: 'allow' })
  expect(heldRules(h, always, false)).toEqual(['Bash(mkdir:*)'])
  expect(heldRules(h, { [q]: 'Yes' }, false)).toEqual([])
  expect(heldRules(h, always, true)).toEqual([])
})

test('a call that ended is matched to its own held dialog by its input, not by its tool alone', () => {
  const a = held({ hid: 'a', tool: 'WebSearch', input: { query: 'bun test' } })
  const b = held({ hid: 'b', tool: 'WebSearch', input: { query: 'vitest' } })
  expect(isHeldCall(a, 'WebSearch', { query: 'bun test', extra: 1 })).toBe(true)
  expect(isHeldCall(b, 'WebSearch', { query: 'bun test' })).toBe(false)
  expect(isHeldCall(a, 'WebFetch', { query: 'bun test' })).toBe(false)
  const grep = held({ tool: 'Grep', input: { pattern: 'TODO', path: '/work/a' } })
  expect(isHeldCall(grep, 'Grep', { pattern: 'TODO', path: '/work/b' })).toBe(false)
  // a big Write is sent shrunk, and matched shrunk; the mod and the hub shrink alike
  const big = 'x'.repeat(5000)
  const write = held({ tool: 'Write', input: { file_path: '/work/a.md', content: big } })
  expect(isHeldCall(write, 'Write', modShrink({ content: big, file_path: '/work/a.md' }) as Record<string, unknown>)).toBe(true)
  for (const v of [{ b: 1, a: [{ d: 'y'.repeat(3000), c: null }] }, 'short', 7]) expect(JSON.stringify(modShrink(v))).toBe(JSON.stringify(shrinkInput(v)))
})

test('a suggested rule holding something shaped like a secret is not offered on the phone', () => {
  const token = `ghp_${'Ab1'.repeat(12)}`
  const rules = [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: `curl -H "Authorization: Bearer ${token}":*` }, { toolName: 'Bash', ruleContent: 'npm test:*' }] }]
  expect(suggestionText(rules)).toBe('Bash(npm test:*)')
})

test('the phone\'s answer is the decision: Yes allows, No denies with what to do instead', () => {
  const h = held()
  const q = heldAsk(h).questions[0]!.question
  const said = (a: string) => heldDecision(h, { [q]: a }, false)
  expect(said('Yes')).toEqual({ behavior: 'allow' })
  expect(said('No')).toEqual({ behavior: 'deny', message: 'The person declined this call.' })
  expect(said('No, use the scratchpad')).toEqual({ behavior: 'deny', message: 'The person declined this call and said: use the scratchpad' })
  expect(said('make it under ./tmp')).toEqual({ behavior: 'deny', message: 'The person declined this call and said: make it under ./tmp' })
  expect(heldDecision(h, {}, true).behavior).toBe('deny')
  // Yes with a note typed in Other is still a Yes; with no rules offered nothing is added
  expect(said('Yes, then run the tests')).toEqual({ behavior: 'allow' })
})

test('an AskUserQuestion dialog is asked on the phone as it is, and answered through the tool\'s input', () => {
  const questions = [{ question: 'Pick a color', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] }]
  const h = held({ tool: 'AskUserQuestion', input: { questions } })
  expect(heldAsk(h)).toEqual({ id: 'held:h1', questions })
  expect(heldDecision(h, { 'Pick a color': 'Blue' }, false)).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Pick a color': 'Blue' } } })
  expect(heldDecision(h, {}, true).behavior).toBe('deny')
  expect(heldDecision(h, {}, false).behavior).toBe('deny')
})
