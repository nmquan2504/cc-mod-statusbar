import { expect, test } from 'claude-code/testing'
import '../remote/i18n.js'

// The phone's page in English or Vietnamese (remote/i18n.js, a plain script that sets
// globalThis.I18N for the page and the service worker; the page passes what it shows through
// translate, and Settings picks the language).
type Notice = { title: string; body: string; session?: string }
const { VI, WORKING_VI, langOf, translate, localText, localNotice } = (globalThis as any).I18N as {
  VI: Record<string, string>
  WORKING_VI: readonly string[]
  langOf: (navLang?: string) => 'en' | 'vi'
  translate: (lang: string, text: string, values?: Record<string, string | number>) => string
  localText: (lang: string, text: string) => string
  localNotice: (lang: string, n: Notice) => Notice
}

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

test('what the hub and the mod send: a known message in Vietnamese, with its names kept; an unknown one as written', () => {
  expect(localText('vi', 'That session is gone.')).toBe('Phiên đó không còn.')
  expect(localText('vi', '/foo is not a command in this session')).toBe('/foo không phải lệnh của phiên này')
  expect(localText('vi', 'Not saved: no keychain available')).toBe('Chưa lưu: không có keychain')
  expect(localText('vi', 'GH_TOKEN saved to the keychain; it goes only to api.github.com')).toBe('GH_TOKEN đã lưu vào keychain; chỉ gửi tới api.github.com')
  expect(localText('vi', 'ENOENT: no such file')).toBe('ENOENT: no such file')
  expect(localText('en', 'That session is gone.')).toBe('That session is gone.')
})

test('a notice in Vietnamese: the words of its title and the mod\'s lines; the folder, time, cost and Claude\'s words as written', () => {
  expect(localNotice('vi', { title: 'Done · /shop · 1m 12s · 3 files · $0.42 · Fix login', body: 'Claude finished.' })).toEqual(
    { title: 'Xong · /shop · 1m 12s · 3 tệp · $0.42 · Fix login', body: 'Claude đã xong.' })
  expect(localNotice('vi', { title: 'Claude needs you · /shop', body: 'Asks to run npm test', session: 's1' })).toEqual(
    { title: 'Claude cần bạn · /shop', body: 'Xin chạy npm test', session: 's1' })
  expect(localNotice('vi', { title: 'Done · /shop · 4s · 1 file', body: 'Fixed the login check.' }).body).toBe('Fixed the login check.')
  expect(localNotice('en', { title: 'Done · /shop', body: 'Claude finished.' }).title).toBe('Done · /shop')
})
