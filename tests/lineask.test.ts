import { expect, test } from 'claude-code/testing'
import { lineAskPhase, lineAskText, lineAt, linesLabel, pickLines } from '../remote/lineask.mjs'
import type { LineAskState } from '../remote/lineask.mjs'

// The phone's box for asking Claude about one line of a file (remote/lineask.mjs; the page wires it
// to the gutter and the box).

test('a tap on the gutter lands on the line under it, held to the file', () => {
  // 8 px of padding, 18 px a line: line 1 from 8 to 26, line 2 from 26 to 44
  expect(lineAt(10, 8, 18, 40)).toBe(1)
  expect(lineAt(25.9, 8, 18, 40)).toBe(1)
  expect(lineAt(26, 8, 18, 40)).toBe(2)
  expect(lineAt(8 + 18 * 11 + 1, 8, 18, 40)).toBe(12)
  // in the padding above the first line, or past the last
  expect(lineAt(2, 8, 18, 40)).toBe(1)
  expect(lineAt(5000, 8, 18, 40)).toBe(40)
})

test('a second line number tapped makes a range, either way round; a third starts again', () => {
  const one = pickLines(null, 12)
  expect(one).toEqual({ from: 12, to: 12 })
  expect(pickLines(one, 20)).toEqual({ from: 12, to: 20 })
  expect(pickLines(one, 4)).toEqual({ from: 4, to: 12 })
  // the same line again stays one line; a tap with a range marked starts over
  expect(pickLines(one, 12)).toEqual({ from: 12, to: 12 })
  expect(pickLines({ from: 12, to: 20 }, 30)).toEqual({ from: 30, to: 30 })
  expect(linesLabel(12, 12)).toBe('line 12')
  expect(linesLabel(12, 20)).toBe('lines 12-20')
})

test('the prompt: the file as @path, the lines and their text fenced, then the question', () => {
  expect(lineAskText('@src/auth.ts', 42, 42, 'if (!token) return next()', 'why skip the check here?')).toBe(
    '@src/auth.ts line 42:\n```\nif (!token) return next()\n```\nwhy skip the check here?',
  )
  expect(lineAskText('@src/auth.ts', 41, 43, 'try {\n  check(token)\n}', 'simplify this')).toBe(
    '@src/auth.ts lines 41-43:\n```\ntry {\n  check(token)\n}\n```\nsimplify this',
  )
  // a path with a space keeps its quotes; lines holding backticks get a longer fence
  expect(lineAskText('@"docs/read me.md"', 3, 3, 'Run ```npm test``` first', 'reword this')).toBe(
    '@"docs/read me.md" line 3:\n````\nRun ```npm test``` first\n````\nreword this',
  )
})

test('the box: sending, then working until its turn has run, then done', () => {
  const ask: LineAskState = { status: 'sending', wasBusy: false, sawBusy: false }
  expect(lineAskPhase(ask, false)).toBe('sending')
  ask.status = 'sent'
  // the hub took it; the session has not started its turn yet
  expect(lineAskPhase(ask, false)).toBe('working')
  expect(lineAskPhase(ask, true)).toBe('working')
  expect(lineAskPhase(ask, false)).toBe('done')
})

test('sent during a turn: it waits for that turn, then works, then is done; the first turn ending is not its own', () => {
  const ask: LineAskState = { status: 'sent', wasBusy: true, sawBusy: false }
  expect(lineAskPhase(ask, true)).toBe('waits')
  expect(lineAskPhase(ask, true)).toBe('waits')
  // the turn before it ends: its own has not run yet
  expect(lineAskPhase(ask, false)).toBe('working')
  expect(lineAskPhase(ask, true)).toBe('working')
  expect(lineAskPhase(ask, false)).toBe('done')
})
