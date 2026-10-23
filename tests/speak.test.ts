import { expect, test } from 'claude-code/testing'
import { segments, speechText } from '../remote/speak.mjs'

// Reading Claude's answer aloud on the phone (remote/speak.mjs; the page wires it to a button on
// the bubble): what is said, and which voice says each piece.

test('a Vietnamese answer is one Vietnamese piece a sentence, an English one English', () => {
  expect(segments('Đã sửa xong lỗi. Chạy lại test đi.')).toEqual([
    { lang: 'vi', text: 'Đã sửa xong lỗi.' },
    { lang: 'vi', text: 'Chạy lại test đi.' },
  ])
  expect(segments('All tests pass. Ready to merge.')).toEqual([
    { lang: 'en', text: 'All tests pass.' },
    { lang: 'en', text: 'Ready to merge.' },
  ])
})

test('an English sentence in a Vietnamese answer gets the English voice, however short', () => {
  expect(segments('Xong rồi.\nDone.')).toEqual([
    { lang: 'vi', text: 'Xong rồi.' },
    { lang: 'en', text: 'Done.' },
  ])
})

test('inside a Vietnamese sentence, three English words in a row switch voice; fewer do not', () => {
  expect(segments('Mình đã fix bug trong auth.ts, giờ chạy lại để verify the whole suite passes.')).toEqual([
    { lang: 'vi', text: 'Mình đã fix bug trong auth.ts, giờ chạy lại để' },
    { lang: 'en', text: 'verify the whole suite passes.' },
  ])
  expect(segments('Giờ commit, push rồi merge nhé.')).toEqual([{ lang: 'vi', text: 'Giờ commit, push rồi merge nhé.' }])
})

test('a Vietnamese word with no mark stays Vietnamese next to English words', () => {
  // "cho", "anh", "xem" read as English would make a run of three
  expect(segments('Gửi cho anh xem trước khi merge.')).toEqual([{ lang: 'vi', text: 'Gửi cho anh xem trước khi merge.' }])
  // at the edge of an English run, it goes with the Vietnamese side
  expect(segments('Mình chạy run the full test suite cho nó.')).toEqual([
    { lang: 'vi', text: 'Mình chạy' },
    { lang: 'en', text: 'run the full test suite' },
    { lang: 'vi', text: 'cho nó.' },
  ])
})

test('what is said: a code block named, links and paths short, the markdown marks gone', () => {
  expect(speechText('## Kết quả\n\n- **Sửa** `remote/app.js` xong\n- Xem [PR #45](https://github.com/x/y/pull/45)\n\n```ts\nconst a = 1\n```\nHết.')).toBe(
    'Kết quả\nSửa app.js xong\nXem PR #45\nCode block.\nHết.',
  )
  expect(speechText('| File | Lines |\n|---|---|\n| a.ts | 12 |')).toBe('File, Lines\na.ts, 12')
  expect(speechText('build → test → ship, see https://example.com/x')).toBe('build, test, ship, see link')
})
