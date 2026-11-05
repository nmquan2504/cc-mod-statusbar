import { expect, test } from 'claude-code/testing'
import { heldAsk, heldCall, heldDecision, suggestionText } from '../remote/held.mjs'
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

test('"don\'t ask again" is offered only when the dialog has rules to add, and adds them', () => {
  expect(suggestionText(RULES)).toBe('Bash(mkdir:*)')
  expect(suggestionText([{ type: 'addDirectories', directories: ['/work/lib'], destination: 'session' }])).toBe('the folder /work/lib')
  const h = held({ suggestions: RULES })
  const labels = heldAsk(h).questions[0]!.options!.map(o => o.label)
  expect(labels).toEqual(['Yes', "Yes, and don't ask again: Bash(mkdir:*)", 'No'])
  const q = heldAsk(h).questions[0]!.question
  expect(heldDecision(h, { [q]: "Yes, and don't ask again: Bash(mkdir:*)" }, false)).toEqual({ behavior: 'allow', updatedPermissions: RULES })
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
