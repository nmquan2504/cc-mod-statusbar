// The chips under Claude's last answer: Claude Code's own next-prompt suggestion when it made one,
// else what Haiku proposes from the request and the answer (features/chips.ts), MAX at most.
export const MAX = 3

// What Haiku is asked: the prompts the person may send next, one a line, as they would type them.
export function suggestPrompt(request: string, answer: string) {
  return [
    'Guess what the person will type next in Claude Code, a coding assistant, after the answer below.',
    `Reply with at most ${MAX} short prompts they are likely to send next, one per line and nothing else: no numbering, no quotes, no explanation.`,
    'Each under 60 characters, worded as the person would type it, in the language of their request.',
    'When the answer asks a question or offers options, the likely replies come first.',
    'A slash command the answer tells them to run may be a line, as typed (/reload-plugins).',
    'Reply NONE when nothing fits.',
    '',
    `Their request: ${request.slice(0, 1500)}`,
    `Claude's answer (its end): ${answer.slice(-3000)}`,
  ].join('\n')
}

// Haiku's reply as chips: a line each, list marks and quotes taken off, each once, MAX at most.
export function suggestionsFrom(reply: string): string[] {
  const found: string[] = []
  for (const line of reply.split('\n')) {
    const t = line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“'`](.*)["”'`]$/, '$1').trim()
    if (!t || /^none\.?$/i.test(t) || t.length > 80) continue
    if (!found.some(f => f.toLowerCase() === t.toLowerCase())) found.push(t)
  }
  return found.slice(0, MAX)
}

// The chips to show: Claude Code's own suggestion alone when it made one, else Haiku's
export function suggestionChips(engine: string, fromHaiku: readonly string[]) {
  const t = engine.trim()
  return t ? [t] : fromHaiku.slice(0, MAX)
}
