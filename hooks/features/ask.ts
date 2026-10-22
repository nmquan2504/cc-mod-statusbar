import { atom, update } from 'claude-code'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const menu = atom({ plugin: 'cc-mod-statusbar', key: 'menu' } as const, null)

// Claude's AskUserQuestion, asked in the band instead of the engine's dialog, and on the phone
// when Self remote is on: every question at once, the options, the previews, an "Other" box
// each, then Submit. The first answer in, from the Mac or the phone, is the one Claude gets.
export type AskOption = { label: string; description?: string; preview?: string }
export type AskQuestion = {
  question: string
  header?: string
  description?: string
  kind?: 'choice' | 'text' | 'number'
  options?: AskOption[]
  multiSelect?: boolean
  placeholder?: string
  min?: number
  max?: number
  step?: number
  defaultValue?: number
  unit?: string
}
// what the person gave: the labels picked and the text typed, per question
export type AskAnswer = { picks: Record<number, string[]>; other: Record<number, string> }
export type AskPending = {
  id: string
  questions: AskQuestion[]
  draft: AskAnswer
  // set once answered (or dismissed), from the band or the phone
  result?: { answers: Record<string, string> } | 'dismissed'
  from?: 'mac' | 'phone'
}
export const ask = { pending: null as AskPending | null }

// The answer for each question as the engine's dialog gives it: the labels picked, comma-joined,
// then the text typed; a question left blank is left out.
export function answersOf(questions: readonly AskQuestion[], draft: AskAnswer) {
  const answers: Record<string, string> = {}
  questions.forEach((q, i) => {
    const parts = [...(draft.picks[i] ?? []), ...(draft.other[i]?.trim() ? [draft.other[i]!.trim()] : [])]
    if (parts.length) answers[q.question] = parts.join(', ')
  })
  return answers
}

// What the model reads, worded as the engine's own dialog words it.
export function answerText(answers: Record<string, string>) {
  const pairs = Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(', ')
  return `Your questions have been answered: ${pairs}. You can now continue with these answers in mind.`
}

// One question, one choice, no previews (a permission prompt is one): a pick is the answer, sent at
// once with no Submit. With previews a pick shows one first, and with several questions a pick
// answers only one of them, so Submit sends those.
export function isOneTap(questions: readonly AskQuestion[]) {
  const q = questions.length === 1 ? questions[0]! : undefined
  return Boolean(q && q.kind !== 'text' && q.kind !== 'number' && !q.multiSelect && q.options?.length && !q.options.some(o => o.preview))
}

// A pick: one option of a single-choice question, or one more (or one less) of a multi-select.
export function pick(draft: AskAnswer, q: AskQuestion, i: number, label: string) {
  const now = draft.picks[i] ?? []
  draft.picks[i] = q.multiSelect ? (now.includes(label) ? now.filter(l => l !== label) : [...now, label]) : now[0] === label ? [] : [label]
}

export async function showAsk($: any) {
  await update($, menu, () => 'ask')
  await $.ui.scroll({ to: { key: 'add' }, block: 'end' }).catch(() => undefined)
}

// The answer, from either side; a second one finds the question settled and changes nothing.
export function settleAsk(id: string, result: NonNullable<AskPending['result']>, from: 'mac' | 'phone') {
  const p = ask.pending
  if (!p || p.id !== id || p.result) return false
  p.result = result
  p.from = from
  return true
}

// While the question waits, the hook sleeps in $.process.run: its own clock stops during a $
// call (a $.clock wait does not stop it), and the engine gives a hook 10 s of its own time.
export async function waitForAnswer($: any, signal: AbortSignal) {
  while (ask.pending && !ask.pending.result && !signal.aborted) await $.process.run(['sleep', '0.3']).catch(() => undefined)
}

export async function closeAsk($: any) {
  ask.pending = null
  await update($, menu, now => (now === 'ask' ? null : now))
}
