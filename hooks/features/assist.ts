import { atom, read, update } from 'claude-code'
import { scrub } from './vault'
import { oneLine } from '../lib/format'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The files the main loop wrote this turn, with the lines each call added and removed.
const edited = atom({ plugin: 'cc-mod-statusbar', key: 'edited' } as const, [])
// The last long turn, as Haiku summed it up: what was done and how it came out.
const lastTurn = atom({ plugin: 'cc-mod-statusbar', key: 'lastTurn' } as const, null)

// The model the bar's helpers use: small and fast, billed to the session like the rest.
export const ASSIST_MODEL = 'haiku'

// Two lines for a long turn: Did (what was done) and Result (how it came out), from the
// request, the tools run, the files changed and Claude's last message.
export async function summarizeTurn($: any, took: number, cost: number | null) {
  const messages: any[] = await $.session.messages().catch(() => [])
  const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text)?.text ?? ''
  const files = (await read($, edited)).map(f => `${f.path} (+${f.added} -${f.removed})`)
  const prompt = [
    'Sum up this Claude Code turn for the person who asked. Reply with exactly two lines and nothing else:',
    'Did: <what was done, one sentence>',
    'Result: <how it came out: what works now, what failed, or what is left; one sentence>',
    'Write both lines in the language of the request.',
    '',
    `Request: ${scrub(rt.turnPrompt).slice(0, 1500)}`,
    `Tools run, in order: ${rt.turnTools.slice(-40).join(' | ') || 'none'}`,
    `Files changed: ${files.join(', ') || 'none'}`,
    `Claude's last message: ${scrub(last).slice(0, 3000)}`,
  ].join('\n')
  const r = await $.model.complete({ model: ASSIST_MODEL, prompt, maxTokens: 300, timeoutMs: 30_000 }).catch(() => undefined)
  if (!r?.isAnswered) return
  const line = (label: string) => new RegExp(`^\\s*${label}:\\s*(.+)$`, 'mi').exec(r.text)?.[1]?.trim() ?? ''
  const did = line('Did') || oneLine(r.text, 200)
  await update($, lastTurn, () => ({ at: Date.now(), took, cost, prompt: oneLine(rt.turnPrompt, 120), did, result: line('Result') }))
}

// Polish rewrites the prompt box's draft clear and specific; Translate puts it in English.
// The draft is kept, so + then "Put back the draft" undoes either.
export async function rewritePrompt($: any, how: 'polish' | 'translate') {
  const box = await $.prompt.read().catch(() => undefined)
  const draft = String(box?.text ?? '').trim()
  if (!draft) return void $.ui.toast('statusbar: the prompt box is empty')
  const ask = how === 'translate'
    ? 'Translate this prompt for a coding assistant into English. Keep code, file names, paths, commands and names exactly as they are. Reply with the translation alone.'
    : 'Rewrite this prompt for a coding assistant so it is clear and specific. Keep every fact, file name, path, command and constraint, and add nothing new. '
      + (cfg.polishEnglish ? 'Write it in English. ' : 'Keep the language it is written in. ')
      + 'Reply with the rewritten prompt alone.'
  $.ui.toast(`statusbar: ${how === 'translate' ? 'translating' : 'polishing'} the prompt…`)
  const r = await $.model.complete({ model: ASSIST_MODEL, system: ask, prompt: draft, maxTokens: 2000, timeoutMs: 30_000 }).catch(() => undefined)
  if (!r?.isAnswered || !r.text.trim()) return void $.ui.toast('statusbar: no rewrite came back; the draft is as it was')
  rt.lastDraft = draft
  await $.prompt.fill({ text: r.text.trim(), mode: 'replace' })
}

// The output styles to pick from: the three built in, then the person's and the project's files.
export async function outputStyles($: any): Promise<string[]> {
  const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
  const cwd: string = await $.session.cwd().catch(() => '')
  // the styles /config offers, built-in and custom, as Claude Code lists them; the built-ins of
  // 2.1.296 and the style files where that list is not there
  const rows: { key: string; options?: readonly string[] }[] = await $.config.list().catch(() => [])
  const offered = rows.find(r => r.key === 'outputStyle')?.options ?? []
  const names = [...offered, 'default', 'Explanatory', 'Learning', 'Concise']
  for (const dir of [`${home}/.claude/output-styles`, `${cwd}/.claude/output-styles`]) {
    const files: { name: string; kind: string }[] = await $.fs.list(dir).catch(() => [])
    for (const f of files) if (f.kind === 'file' && f.name.endsWith('.md')) names.push(f.name.slice(0, -3))
  }
  return [...new Set(names)]
}
