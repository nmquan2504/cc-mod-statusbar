import { expect, test } from 'claude-code/testing'
import { VI, WORKING_VI, langOf, translate } from '../remote/i18n.mjs'

// The phone's page in English or Vietnamese (remote/i18n.mjs; the page passes what it shows through
// translate, and Settings picks the language).

test('a text in Vietnamese when that is picked, in English otherwise, its {names} filled', () => {
  expect(translate('vi', 'Load earlier turns')).toBe('Tải các lượt trước')
  expect(translate('en', 'Load earlier turns')).toBe('Load earlier turns')
  expect(translate('vi', 'Submit {n}/{total}', { n: 1, total: 3 })).toBe('Gửi 1/3')
  expect(translate('en', 'Submit {n}/{total}', { n: 1, total: 3 })).toBe('Submit 1/3')
  // the dollar of a cost stays; a name not given stays as written
  expect(translate('vi', 'Cost so far ${cost}', { cost: '0.42' })).toBe('Chi phí đến giờ $0.42')
  expect(translate('vi', 'Image #{n}')).toBe('Ảnh #{n}')
})

test('what the session sends, never in the table, comes through as written', () => {
  expect(translate('vi', 'That session is gone.')).toBe('That session is gone.')
})

test('every Vietnamese text keeps the {names} of its English one', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
  for (const [en, vi] of Object.entries(VI)) {
    expect(vi.length > 0).toBe(true)
    expect(names(vi)).toEqual(names(en))
  }
  expect(WORKING_VI.length > 10).toBe(true)
})

test('a phone starts in Vietnamese when its own language is', () => {
  expect(langOf('vi-VN')).toBe('vi')
  expect(langOf('vi')).toBe('vi')
  expect(langOf('en-US')).toBe('en')
  expect(langOf('')).toBe('en')
})
