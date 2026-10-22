// What Claude's last answer suggests you send next, read by rule (no model): only its closing lines,
// where an answer puts what to do next, and only these shapes:
//   a phrase quoted after a verb of saying or typing   say "Merge pr", nói "Push và tạo PR đi"
//   a slash command in backticks, after a verb of doing run `/reload-plugins`, chạy `/reload-plugins`
//   options set out as quoted bold                      - **"Yes, delete"**: …
//   a yes-or-no question                                Want me to look into it?  → Yes, No
// A command only named (the `/usage` page), a bold label (**Checks:**) and a table row are not.
// Each once, in that order, MAX at most.
const MAX = 3
const TAIL_LINES = 6
const SAY = /(?:\b(?:say|type|reply|send|answer|pick)|nói|gõ|trả lời|chọn|gửi)\s*:?\s*\**\s*["“]([^"”|`\n]{1,80})["”]/gi
const SLASH = /(?:\b(?:run|type|use|send)|chạy|gõ|dùng|gửi)\s+`(\/[a-z][\w:.-]*(?:\s[^`\n]{0,60})?)`/gi
const BOLD_OPTION = /^\s*(?:[-*•]|\d+[.)])?\s*\*\*\s*["“]([^*"”|`\n]{1,60})["”]\s*:?\s*\*\*/
const YES_NO_VI = /^(?:bạn\s+)?(?:có\s+)?muốn\s|^có\s+(?:nên|cần)\s|^mình\s+(?:có\s+)?nên\s/i
const YES_NO_EN = /^(?:do you want|want me to|would you like|should i|shall i|can i|may i)\b/i

export function suggestionsIn(answer: string): string[] {
  // a table row lists things; it suggests nothing
  const lines = answer.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('|'))
  const tail = lines.slice(-TAIL_LINES)
  const found: string[] = []
  const add = (s: string) => {
    const t = s.trim().replace(/[.:;,]+$/, '')
    if (t && !found.some(f => f.toLowerCase() === t.toLowerCase())) found.push(t)
  }
  for (const line of tail) for (const m of line.matchAll(SAY)) add(m[1]!)
  for (const line of tail) for (const m of line.matchAll(SLASH)) add(m[1]!)
  for (const line of tail) {
    const m = BOLD_OPTION.exec(line)
    if (m) add(m[1]!)
  }
  // a question closing the answer, its "Next:" lead taken off
  const last = (tail.at(-1) ?? '').replace(/^(?:\*\*)?(?:tiếp theo|next)\s*:?(?:\*\*)?\s*/i, '')
  if (last.endsWith('?') && !found.length) {
    if (YES_NO_VI.test(last)) ['Có', 'Không'].forEach(add)
    else if (YES_NO_EN.test(last)) ['Yes', 'No'].forEach(add)
  }
  return found.slice(0, MAX)
}

// The chips to show: Claude Code's own suggestion first, then those read from the answer, MAX at most
export function suggestionChips(engine: string, fromAnswer: readonly string[]) {
  const all: string[] = []
  for (const s of [engine, ...fromAnswer]) {
    const t = s.trim()
    if (t && !all.some(a => a.toLowerCase() === t.toLowerCase())) all.push(t)
  }
  return all.slice(0, MAX)
}
