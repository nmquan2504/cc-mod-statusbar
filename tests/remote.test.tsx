import { expect, test } from 'claude-code/testing'
import { transcriptOf } from '../hooks/features/remote'
import { qrMatrix, qrRows } from '../hooks/lib/qr'

// Self remote: the ⇄ chip and its menu. The hooks registered here stand for the engine; the hub
// (remote/server.mjs) is answered by http.fetch on its Unix socket.
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 60, bodyColumns: 140, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const LINK = 'https://tribal-reviewer-flex-arrange.trycloudflare.com/#k=CYS-KIzFW_BSyB46JlbhKJn1EK__Y2GZKgP4l73z3KI'
const STATUS = {
  url: 'https://tribal-reviewer-flex-arrange.trycloudflare.com',
  link: LINK,
  error: '',
  sessions: 2,
  devices: [{ name: 'iPhone, Safari', seenAt: 0 }],
  pending: [{ id: 'p1', code: 'K7M3', name: 'Android, Chrome', at: 0 }],
  phones: 1,
  isLocked: false,
  subscriptions: 1,
}
const ran = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

function engine(on: any, opts: { argvs?: string[][]; hub?: (path: string, body: string) => unknown; toasts?: string[] } = {}) {
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_: unknown, e: any) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.cwd', () => ({ value: '/work/shop' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 4 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: { permissions: { deny: ['Read(./.env)'] }, hooks: { PreToolUse: [] } } }))
  on('process.run', async (_: unknown, e: { argv: string[] }) => {
    opts.argvs?.push(e.argv)
    // a question's hook sleeps in process.run while it waits: a short real wait, as the shell's
    if (e.argv[0] === 'sleep') await new Promise(r => setTimeout(r, 5))
    return { value: e.argv[0] === 'id' ? ran('501\n') : e.argv[0] === '/bin/sh' || e.argv[0] === 'sleep' ? ran() : { ...ran(), exitCode: 1 } }
  })
  on('http.fetch', (_: unknown, e: any) => {
    const answer = e.init?.socketPath === '/tmp/qsb-remote-501/hub.sock' ? opts.hub?.(new URL(e.url).pathname, e.init?.body ?? '') : undefined
    return { value: answer === undefined ? { status: 502, ok: false, headers: {}, text: '' } : { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } }
  })
  on('ui.toast', (_: unknown, e: unknown) => (opts.toasts?.push(JSON.stringify(e)), { value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
  return store
}
const textOf = async (ui: any) => JSON.stringify(await ui.drawn())

// turns Self remote on through + then Settings, as a person would
async function switchOn(band: any) {
  await band.press({ key: 'add' })
  await band.press({ key: 'settings' })
  // its own group, under the other switches and before the output style
  const drawn = await textOf(band)
  expect(drawn.indexOf('Confirm dangerous commands')).toBeLessThan(drawn.indexOf('every session on this machine on your phone'))
  expect(drawn.indexOf('every session on this machine on your phone')).toBeLessThan(drawn.indexOf('Remote stops after'))
  expect(drawn.indexOf('Remote stops after')).toBeLessThan(drawn.indexOf('Output style'))
  await band.press({ key: 'set:selfRemote' })
  await band.press({ key: 'close-menu' })
}

test('the QR code: a tunnel link (99 bytes) fits version 5, drawn two module rows to a text row', () => {
  const m = qrMatrix(LINK)
  expect(m.length).toBe(37)
  // the three finder patterns: a dark ring around a dark 3x3 core
  for (const [x, y] of [[0, 0], [30, 0], [0, 30]] as const) {
    expect(m[y]![x]).toBe(true)
    expect(m[y + 1]![x + 1]).toBe(false)
    expect(m[y + 3]![x + 3]).toBe(true)
  }
  const rows = qrRows(m)
  expect(rows.length).toBe(21) // 37 modules and a quiet zone of 2 each side: 41, two to a row
  expect(rows.every(r => [...r].length === 41)).toBe(true)
  expect(rows[0]).toBe('█'.repeat(41)) // the quiet zone is light
})

test('Self remote is off by default: no ⇄ on the bar, and no hub is asked', async ($, on) => {
  const argvs: string[][] = []
  engine(on, { argvs })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ key: 'remote' })).toBeUndefined()
  expect(argvs.some(a => a[0] === '/bin/sh')).toBe(false)
})

test('switched on, ⇄ opens the menu; Start takes two presses and starts the hub detached', async ($, on) => {
  const argvs: string[][] = []
  const toasts: string[] = []
  const store = engine(on, { argvs, toasts })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  expect(store.get('settings')).toMatchObject({ selfRemote: true, remoteIdleMinutes: 30 })
  expect((await band.find({ key: 'remote' }))?.text).toBe(' ⇄ ')
  await band.press({ key: 'remote' })
  expect(await textOf(band)).toContain('Start the remote')
  await band.press({ key: 'remote-start' })
  expect(argvs.some(a => a[0] === '/bin/sh')).toBe(false)
  expect(toasts.join()).toContain('press again within 5 s to start the remote')
  await band.press({ key: 'remote-start' })
  const sh = argvs.find(a => a[0] === '/bin/sh')!
  expect(sh[2]).toContain('nohup node "$0" "$1" "$2"')
  expect(sh[3]).toMatch(/\/remote\/server\.mjs$/)
  expect(sh.slice(4)).toEqual(['/tmp/qsb-remote-501', '30'])
})

test('with the hub up: the QR code, a phone asking to pair with its code, Allow sent to the hub', async ($, on) => {
  const asked: string[] = []
  engine(on, {
    hub: (path, body) => {
      asked.push(`${path} ${body}`)
      return path === '/allow' ? { ...STATUS, pending: [] } : STATUS
    },
  })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await band.press({ key: 'remote' })
  const drawn = await textOf(band)
  expect((await band.find({ key: 'remote' }))?.text).toBe(' ⇄ ? ')
  expect(drawn).toContain('Android, Chrome asks to pair, code K7M3')
  expect(drawn).toContain('█▀') // the QR code's rows
  expect(drawn).toContain('Sessions on the link ')
  await band.press({ key: 'allow:p1' })
  expect(asked).toContain('/allow {"id":"p1"}')
  expect((await band.find({ key: 'remote' }))?.text).toBe(' ⇄ 1 ')
})

test('the transcript reads as the terminal: prompts without reminders, text, tool calls with output', () => {
  const items = transcriptOf([
    { role: 'user', text: 'fix the test<system-reminder>not for the phone</system-reminder>', toolUses: [] },
    { role: 'user', text: '<command-name>/model</command-name>\n<command-args>opus</command-args>', toolUses: [] },
    {
      role: 'assistant',
      text: 'Reading it first.',
      toolUses: [
        { tool_use_id: 'a', tool: 'Read', input: { file_path: '/work/shop/src/qr.ts' }, text: 'one\ntwo\nthree' },
        { tool_use_id: 'b', tool: 'Edit', input: { file_path: '/work/shop/src/qr.ts', old_string: 'x = 1', new_string: 'x = 2' }, text: 'updated' },
        { tool_use_id: 'c', tool: 'Bash', input: { command: 'npm test' }, text: 'Error: 1 failed', isError: true },
        { tool_use_id: 'd', tool: 'mcp__github__get_pr', input: { number: 3 } },
      ],
    },
    { role: 'user', text: '', toolUses: [] },
  ], '/work/shop')
  expect(items).toEqual([
    { k: 'user', text: 'fix the test' },
    { k: 'user', text: '/model opus' },
    { k: 'text', text: 'Reading it first.' },
    { k: 'tool', id: 'a', name: 'Read', arg: 'src/qr.ts', path: '/work/shop/src/qr.ts', out: 'Read 3 lines', isError: undefined },
    { k: 'tool', id: 'b', name: 'Update', arg: 'src/qr.ts', path: '/work/shop/src/qr.ts', out: 'updated', isError: undefined, old: 'x = 1', new: 'x = 2' },
    { k: 'tool', id: 'c', name: 'Bash', arg: 'npm test', out: 'Error: 1 failed', isError: true },
    { k: 'tool', id: 'd', name: 'github - get_pr (MCP)', arg: '', out: undefined, isError: undefined },
  ])
})

// ---- Claude's AskUserQuestion, asked in the band ---------------------------------------------
declare function setTimeout(callback: (...args: never[]) => void, ms: number): unknown
const QUESTIONS = [
  { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'relational', preview: 'CREATE TABLE users (...)' }, { label: 'SQLite', description: 'one file' }] },
  { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'lint', description: '' }, { label: 'types', description: '' }, { label: 'tests', description: '' }] },
]
function asking(on: any, surface = 'terminal') {
  engine(on)
  on('session.surfaces', () => ({ value: [surface] }))
  // beneath the mod: the engine's own dialog, which answers only when the band does not
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { answers: { native: 'dialog' } }, text: 'the engine asked' }))
}
const settle = () => new Promise(r => setTimeout(r, 30))

test('a question opens in the band, every one at once; picks and Other go back as the dialog words them', async ($, on) => {
  asking(on)
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  const call = ($ as any).tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
  await settle()
  const drawn = await textOf(band)
  for (const seen of ['Which database?', 'Which checks?', 'Postgres', 'one file', 'pick an option to see its preview', 'Submit 0/2']) expect(drawn).toContain(seen)
  await band.press({ key: 'ask:0:0' })
  expect(await textOf(band)).toContain('CREATE TABLE users') // the picked option's preview
  await band.press({ key: 'ask:1:0' })
  await band.press({ key: 'ask:1:2' })
  await (band as any).input({ key: 'ask-other:1', text: 'docs' })
  await band.press({ key: 'ask-submit' })
  const r = await call
  expect(r.result.answers).toEqual({ 'Which database?': 'Postgres', 'Which checks?': 'lint, tests, docs' })
  expect(r.text).toBe('Your questions have been answered: "Which database?"="Postgres", "Which checks?"="lint, tests, docs". You can now continue with these answers in mind.')
  await settle()
  expect(await textOf(band)).not.toContain('Which database?') // the menu shut with the answer
})

test('Dismiss refuses the call with a reason; shut, the menu leaves a chip that opens it again', async ($, on) => {
  asking(on)
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  const call = ($ as any).tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS.slice(0, 1) })
  await settle()
  await band.press({ key: 'close-menu' })
  expect((await band.find({ key: 'ask-chip' }))?.text).toBe(' ? Claude asks ')
  await band.press({ key: 'ask-chip' })
  await band.press({ key: 'ask-dismiss' })
  const r = await call
  expect(r.deny).toContain('dismissed the question')
})

test('where no band draws (VS Code), the engine\'s own dialog asks', async ($, on) => {
  asking(on, 'vscode')
  const r = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS.slice(0, 1) })
  expect(r.text).toBe('the engine asked')
})

test('a question Claude asked reads as Ask, each question with the answer it got', () => {
  const items = transcriptOf([{
    role: 'assistant', text: '', toolUses: [
      { tool_use_id: 'q1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which color?' }, { question: 'Which size?' }] }, text: 'Your questions have been answered: "Which color?"="Orange". You can now continue with these answers in mind.' },
      { tool_use_id: 'q2', tool: 'AskUserQuestion', input: { questions: [{ question: 'Ship it?' }] }, result: { answers: { 'Ship it?': 'Yes' } }, text: 'answered' },
      { tool_use_id: 'q3', tool: 'AskUserQuestion', input: { questions: [{ question: 'Now?' }] } },
    ],
  }], '/work')
  expect(items.map(i => (i.k === 'tool' ? [i.name, i.arg, i.qa] : i))).toEqual([
    ['Ask', 'Which color?', [{ q: 'Which color?', a: 'Orange' }, { q: 'Which size?', a: '' }]],
    ['Ask', 'Ship it?', [{ q: 'Ship it?', a: 'Yes' }]],
    ['Ask', 'Now?', [{ q: 'Now?', a: '' }]],
  ])
})
