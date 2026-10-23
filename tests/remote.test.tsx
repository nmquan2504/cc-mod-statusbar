import { expect, mock, test } from 'claude-code/testing'
import { contextOf, midTurnsIn, phoneCommand, phoneMayRun, sessionTitleIn, transcriptOf } from '../hooks/features/remote'
import { isOneTap } from '../hooks/features/ask'
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

// where the tools are, as the lookup script answers: a test takes one away by setting it to ''
type Tools = { cloudflared: string; brew: string }
function engine(on: any, opts: { argvs?: string[][]; hub?: (path: string, body: string) => unknown; toasts?: string[]; tools?: Tools; run?: (argv: string[]) => unknown } = {}) {
  const tools = opts.tools ?? { cloudflared: '/opt/homebrew/bin/cloudflared', brew: '/opt/homebrew/bin/brew' }
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
    const given = opts.run?.(e.argv)
    if (given) return { value: given }
    // a question's hook sleeps in process.run while it waits: a short real wait, as the shell's
    if (e.argv[0] === 'sleep') await new Promise(r => setTimeout(r, 5))
    if (e.argv[0] === '/bin/sh' && e.argv[2]?.includes('command -v'))
      return { value: ran(e.argv.slice(4).map(n => `${n}=${tools[n as keyof Tools] ?? ''}`).join('\n')) }
    if (e.argv[1] === 'install' && e.argv[2] === 'cloudflared') {
      tools.cloudflared = '/opt/homebrew/bin/cloudflared'
      return { value: ran('==> Pouring cloudflared') }
    }
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
  const sh = argvs.find(a => a[0] === '/bin/sh' && a[2]!.includes('nohup'))!
  expect(sh[2]).toContain('nohup node "$0" "$1" "$2"')
  expect(sh[3]).toMatch(/\/remote\/server\.mjs$/)
  expect(sh.slice(4)).toEqual(['/tmp/qsb-remote-501', '30'])
})

test('with the hub up: the QR code on request, a phone asking to pair with its code, Allow sent to the hub', async ($, on) => {
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
  // a request to pair waits a minute: the chip and the row count it down
  expect((await band.find({ key: 'remote' }))?.text).toBe(' ⇄ ? 60s ')
  // ⇄ sits right after the usage figures, before the rest of the right group
  const bar = await textOf(band)
  expect(bar.indexOf('"key":"usage"')).toBeLessThan(bar.indexOf('"key":"remote"'))
  expect(bar.indexOf('"key":"remote"')).toBeLessThan(bar.indexOf('"key":"guard"'))
  expect(drawn).toContain('Android, Chrome asks to pair, code K7M3')
  expect(drawn).toContain('"60 s"')
  expect(drawn).not.toContain('█▀') // a hub this session did not start keeps its code hidden
  expect(drawn).toContain('Sessions on the link ')
  await band.press({ key: 'remote-qr' })
  expect(await textOf(band)).toContain('█▀') // the QR code's rows
  await band.press({ key: 'allow:p1' })
  expect(asked).toContain('/allow {"id":"p1"}')
  expect((await band.find({ key: 'remote' }))?.text).toBe(' ⇄ 1 ')
})

test('a request to pair a minute old is gone from the terminal; Allow on one the hub dropped says so', async ($, on) => {
  const toasts: string[] = []
  let late = false
  engine(on, {
    toasts,
    hub: path => {
      if (path === '/allow') return undefined // the hub answers 410 for an expired request
      return { ...STATUS, pending: [{ id: 'p1', code: 'K7M3', name: 'Android, Chrome', at: 0, expiresAt: late ? Date.now() - 1 : Date.now() + 30_000 }] }
    },
  })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await band.press({ key: 'remote' })
  expect((await band.find({ key: 'remote' }))?.text).toBe(' ⇄ ? 30s ')
  await band.press({ key: 'allow:p1' })
  expect(toasts.join()).toContain('had expired')
  // its minute over, the request leaves the menu and the chip before the hub's next answer
  late = true
  await band.press({ key: 'close-menu' })
  await band.press({ key: 'remote' })
  expect(await textOf(band)).not.toContain('asks to pair')
  expect((await band.find({ key: 'remote' }))?.text).not.toContain('?')
})

test('the transcript reads as the terminal: prompts without reminders, text, tool calls with output', () => {
  const items = transcriptOf([
    { role: 'user', text: '<browser_instruction># Claude in Chrome browser automation</browser_instruction>\nfix the test<system-reminder>not for the phone</system-reminder>', toolUses: [] },
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

test('a prompt shows as typed whatever the engine put around it, and a notice holding its words shows nothing', () => {
  const items = transcriptOf([
    { role: 'user', text: '<ide_opened_file>The user opened src/qr.ts in the IDE.</ide_opened_file>\nfix it', toolUses: [] },
    { role: 'user', text: '<some_new_tag>\nsetup notes\n</some_new_tag>\nok', toolUses: [] },
    { role: 'user', text: '<task-notification>\n<summary>ok\nfix it</summary>\n</task-notification>', toolUses: [] },
    { role: 'user', text: '<future_tag>older prompt</future_tag>\nnot kept', toolUses: [] },
    // a prompt from before they were kept: the fallback knows the IDE's file
    { role: 'user', text: '<ide_opened_file>The user opened a.ts.</ide_opened_file>\nresumed', toolUses: [] },
  ], '/w', [], [], ['fix it', 'ok'])
  expect(items).toEqual([
    { k: 'user', text: 'fix it' },
    { k: 'user', text: 'ok' },
    { k: 'user', text: '<future_tag>older prompt</future_tag>\nnot kept' },
    { k: 'user', text: 'resumed' },
  ])
})

test('the session title: the last /rename name, else the last title Claude Code wrote', () => {
  expect(sessionTitleIn(['"aiTitle":"First guess"', '"aiTitle":"Fix the \\"login\\" bug"'])).toBe('Fix the "login" bug')
  expect(sessionTitleIn(['"aiTitle":"Fix login"', '"customTitle":"auth work"', '"aiTitle":"Later guess"'])).toBe('auth work')
  expect(sessionTitleIn([])).toBe('')
})

// ---- Claude's AskUserQuestion, asked in the band ---------------------------------------------
declare function setTimeout(callback: (...args: never[]) => void, ms: number): unknown
const QUESTIONS = [
  { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'relational', preview: 'CREATE TABLE users (...)' }, { label: 'SQLite', description: 'one file' }] },
  { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'lint', description: '' }, { label: 'types', description: '' }, { label: 'tests', description: '' }] },
]
// the session on a surface, with the engine's own dialog beneath the mod (it answers only when the
// band does not); `isLinked`: Self remote switched on and this session joined to a running hub
async function asking($: any, on: any, surface = 'terminal', isLinked = true) {
  engine(on, { hub: () => STATUS })
  on('session.surfaces', () => ({ value: [surface] }))
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { answers: { native: 'dialog' } }, text: 'the engine asked' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/work/shop', surface, isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  if (isLinked) {
    await switchOn(band)
    await clock.advance(2000) // the remote's tick: this session joins the hub
  }
  return band
}
const settle = () => new Promise(r => setTimeout(r, 30))

test('a question opens in the band, every one at once; picks and Other go back as the dialog words them', async ($, on) => {
  const band = await asking($, on)
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

test('one question, one choice, no previews: a pick is the answer, with no Submit', async ($, on) => {
  const band = await asking($, on)
  const one = [{ question: 'Ship it?', header: 'Ship', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }]
  const call = ($ as any).tool.call({ tool: 'AskUserQuestion', questions: one })
  await settle()
  await band.press({ key: 'ask:0:1' })
  const r = await call
  expect(r.result.answers).toEqual({ 'Ship it?': 'No' })
  // a preview, several questions or several choices: Submit sends them
  expect(isOneTap(one)).toBe(true)
  expect(isOneTap(QUESTIONS.slice(0, 1))).toBe(false)
  expect(isOneTap([...one, ...one])).toBe(false)
  expect(isOneTap([{ ...one[0]!, multiSelect: true }])).toBe(false)
  expect(isOneTap([{ question: 'Name?', kind: 'text' }])).toBe(false)
})

test('Dismiss refuses the call with a reason; shut, the menu leaves a chip that opens it again', async ($, on) => {
  const band = await asking($, on)
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
  await asking($, on, 'vscode')
  const r = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS.slice(0, 1) })
  expect(r.text).toBe('the engine asked')
})

test('with Self remote off, or on with no hub running, the engine\'s own dialog asks', async ($, on) => {
  await asking($, on, 'terminal', false)
  const r = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS.slice(0, 1) })
  expect(r.text).toBe('the engine asked')
})

test('a session the VS Code extension draws joins the hub; one nothing draws (-p, an SDK run) stays off', async ($, on) => {
  const posted: string[] = []
  engine(on, { hub: path => (posted.push(path), STATUS) })
  let surfaces: string[] = []
  on('session.surfaces', () => ({ value: surfaces as never }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'vscode', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  posted.length = 0
  await clock.advance(2000)
  expect(posted).not.toContain('/session') // nothing draws it yet
  surfaces = ['vscode'] // the extension attaches
  await clock.advance(2000)
  expect(posted).toContain('/session')
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

test('while the tunnel waits for its address, the menu and the chip turn a spinner', async ($, on) => {
  engine(on, { hub: () => ({ ...STATUS, url: '', link: '', pending: [], phones: 0 }) })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await band.press({ key: 'remote' })
  const drawn = await textOf(band)
  expect(drawn).toContain("Waiting for the tunnel's address…")
  expect(drawn).toContain('usually 10 to 20 s')
  expect(drawn).not.toContain('█▀') // no QR code before the address
  expect((await band.find({ key: 'remote' }))?.text).toMatch(/^ ⇄ [·✢✳✶✻✽] $/)
})

test('without cloudflared, Start starts no hub: Install with Homebrew takes two presses, then starts', async ($, on) => {
  const argvs: string[][] = []
  engine(on, { argvs, tools: { cloudflared: '', brew: '/opt/homebrew/bin/brew' } })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await band.press({ key: 'remote' })
  await band.press({ key: 'remote-start' })
  await band.press({ key: 'remote-start' })
  const isHubStarted = () => argvs.some(a => a[0] === '/bin/sh' && a[2]!.includes('nohup'))
  expect(isHubStarted()).toBe(false)
  const drawn = await textOf(band)
  expect(drawn).toContain('cloudflared is not installed on this Mac')
  expect(drawn).toContain('Install with Homebrew')
  await band.press({ key: 'remote-install' })
  expect(argvs.some(a => a[1] === 'install')).toBe(false)
  await band.press({ key: 'remote-install' })
  expect(argvs.find(a => a[1] === 'install')).toEqual(['/opt/homebrew/bin/brew', 'install', 'cloudflared'])
  expect(isHubStarted()).toBe(true)
})

test('without cloudflared or Homebrew, the menu gives the download link and looks again', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts, tools: { cloudflared: '', brew: '' } })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await band.press({ key: 'remote' })
  await band.press({ key: 'remote-start' })
  await band.press({ key: 'remote-start' })
  const drawn = await textOf(band)
  expect(drawn).toContain('Homebrew is not installed either')
  expect(drawn).toContain('https://github.com/cloudflare/cloudflared/releases/latest')
  expect(await band.find({ key: 'remote-install' })).toBeUndefined()
  await band.press({ key: 'remote-recheck' })
  expect(toasts.join()).toContain('cloudflared is still not found')
})

test('what a session holds in context: files @-mentioned in a prompt, and files Claude read', () => {
  const c = contextOf([
    { role: 'user', text: 'look at @src/qr.ts and @"docs/my notes.md", ask @team; also @~/.zshrc.', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool: 'Read', input: { file_path: '/work/shop/README.md' } }, { tool: 'Bash', input: { command: 'cat x' } }] },
    { role: 'user', text: 'again @src/qr.ts', toolUses: [] },
  ], '/work/shop', '/Users/me')
  expect(c.mentions).toEqual(['/work/shop/docs/my notes.md', '/Users/me/.zshrc', '/work/shop/src/qr.ts'])
  expect(c.reads).toEqual(['/work/shop/README.md'])
})

test('the QR code shows after a Start until the menu shuts; a hub already up keeps it hidden until q', async ($, on) => {
  const argvs: string[][] = []
  // the hub answers once this session started it
  engine(on, { argvs, hub: () => (argvs.some(a => a[0] === '/bin/sh' && a[2]!.includes('nohup')) ? { ...STATUS, pending: [] } : undefined) })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await band.press({ key: 'remote' })
  await band.press({ key: 'remote-start' })
  await band.press({ key: 'remote-start' })
  await clock.advance(2000)
  expect(await textOf(band)).toContain('█▀')
  await band.press({ key: 'close-menu' })
  await band.press({ key: 'remote' })
  const shut = await textOf(band)
  expect(shut).not.toContain('█▀')
  expect(shut).toContain('Show the QR code')
  await band.press({ key: 'remote-qr' })
  expect(await textOf(band)).toContain('█▀')
  await band.press({ key: 'close-menu' })
  await band.press({ key: 'remote' })
  expect(await textOf(band)).not.toContain('█▀')
})

test('a hub started from other code: the menu says which and restarts it on two presses', async ($, on) => {
  const argvs: string[][] = []
  const asked: string[] = []
  let hubVersion = '0.2.0 · aaaaaaa'
  let isUp = true
  engine(on, {
    argvs,
    run: argv => argv[0] === 'cat' ? ran('{"version":"0.2.1"}')
      : argv[0] === 'git' && argv.includes('log') ? ran('bbbbbbb 1761190860\n') : undefined,
    hub: path => {
      asked.push(path)
      if (path === '/stop') isUp = false
      return isUp ? { ...STATUS, pending: [], version: hubVersion } : undefined
    },
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await clock.advance(2000)
  await band.press({ key: 'remote' })
  expect(await textOf(band)).toContain('The hub runs 0.2.0 · aaaaaaa; this session loaded 0.2.1 · bbbbbbb.')
  await band.press({ key: 'remote-restart' })
  await band.press({ key: 'remote-restart' })
  expect(asked).toContain('/stop')
  expect(argvs.some(a => a[0] === '/bin/sh' && a[2]!.includes('nohup'))).toBe(true)
  // the same code: nothing to say
  isUp = true
  hubVersion = '0.2.1 · bbbbbbb'
  await clock.advance(2000)
  await band.press({ key: 'close-menu' })
  await band.press({ key: 'remote' })
  expect(await textOf(band)).not.toContain('The hub runs')
  expect(await band.find({ key: 'remote-restart' })).toBeUndefined()
})

test('Stop on the phone ends the running turn, as Esc does; with no turn running it does nothing', async ($, on) => {
  let stop = false
  const toasts: string[] = []
  // the hub hands the session the phone's Stop once
  const takeStop = () => {
    const was = stop
    stop = false
    return was
  }
  engine(on, { toasts, hub: path => (path === '/inbox' ? { texts: [], stop: takeStop() } : { ...STATUS, pending: [] }) })
  const aborted: string[] = []
  on('turn.abort', (_: unknown, e: any) => (aborted.push(e.turnId), { value: undefined }))
  on('turn.start', () => ({ turnId: 't9' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  const t = $ as any
  await t.session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await clock.advance(2000)
  // idle: a Stop asks nothing of the engine
  stop = true
  await clock.advance(2000)
  expect(aborted).toEqual([])
  // a turn runs (the band drawn working): Stop ends that turn
  await t.turn.start({ text: 'go', turnId: 't9', kind: 'engine' })
  await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } } as never)
  stop = true
  await clock.advance(2000)
  expect(aborted).toEqual(['t9'])
  expect(toasts.join()).toContain('stopped from the phone')
})

test('a hub on older code restarts by itself when no phone watches; a newer one, or one watched, is left', async ($, on) => {
  const argvs: string[][] = []
  const asked: string[] = []
  let hub = { version: '0.2.0 · aaaaaaa', versionAt: 1_761_000_000_000, phones: 1 }
  let isUp = true
  engine(on, {
    argvs,
    run: argv => argv[0] === 'cat' ? ran('{"version":"0.2.1"}')
      : argv[0] === 'git' && argv.includes('log') ? ran('bbbbbbb 1761190860\n') : undefined,
    hub: path => {
      asked.push(path)
      if (path === '/stop') isUp = false
      return isUp ? { ...STATUS, pending: [], ...hub } : undefined
    },
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  // a phone watches: left for r in the menu
  await clock.advance(2000)
  expect(asked).not.toContain('/stop')
  // a newer hub, no phone: a session on older code leaves it alone
  hub = { version: '0.2.2 · ccccccc', versionAt: 1_762_000_000_000, phones: 0 }
  await clock.advance(2000)
  expect(asked).not.toContain('/stop')
  // an older hub, no phone: restarted on this session's code
  hub = { version: '0.2.0 · aaaaaaa', versionAt: 1_761_000_000_000, phones: 0 }
  await clock.advance(2000)
  expect(asked).toContain('/stop')
  expect(argvs.some(a => a[0] === '/bin/sh' && a[2]!.includes('nohup'))).toBe(true)
})

test('a text queued from the phone can be taken back before the turn ends; the rest goes in', async ($, on) => {
  const snapshots: any[] = []
  let inbox: any = { texts: [] }
  engine(on, {
    hub: (path, body) => {
      if (path === '/session') snapshots.push(JSON.parse(body))
      if (path !== '/inbox') return { ...STATUS, pending: [] }
      const given = inbox
      inbox = { texts: [] }
      return given
    },
  })
  const submitted: string[] = []
  on('prompt.submit', (_: unknown, e: any) => (submitted.push(e.text), { text: e.text }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  // Claude works: two texts from the phone wait
  await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } } as never)
  // a tick sends its snapshot, then reads the inbox: the next snapshot shows what came in
  inbox = { texts: ['run the tests', 'then open a PR'] }
  await clock.advance(2000)
  await clock.advance(2000)
  expect(snapshots.at(-1).queued).toEqual(['run the tests', 'then open a PR'])
  // ✕ on the first: gone from the queue at the next call
  inbox = { texts: [], unqueue: ['run the tests'] }
  await clock.advance(2000)
  await clock.advance(2000)
  expect(snapshots.at(-1).queued).toEqual(['then open a PR'])
  // the turn ends: only the one left goes in
  await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await clock.advance(2000)
  expect(submitted).toEqual(['then open a PR'])
})

test('from the phone a built-in runs only when it prints text or takes a value; a panel stays on the computer', () => {
  expect(phoneMayRun('humanizer', '', false)).toBe(true) // a skill hands the model a prompt
  expect(phoneMayRun('compact', '', true)).toBe(true)
  expect(phoneMayRun('code-review', '', true)).toBe(true) // a bundled skill
  expect(phoneMayRun('model', 'opus', true)).toBe(true)
  // a panel the phone draws as a page of its own opens there, not on the computer
  expect(phoneMayRun('model', '', true)).toContain('opens as a page on the phone')
  expect(phoneMayRun('config', '', true)).toContain('opens as a page on the phone')
  expect(phoneMayRun('config', 'verbose=true', true)).toContain('the phone cannot close it')
  expect(phoneMayRun('usage', '', true)).toContain('opens a panel on the computer')
  expect(phoneMayRun('exit', '', true)).toContain('run it at the computer')
})

test('a text from the phone: a listed command runs, an unknown /name is refused, a path goes in as a prompt', () => {
  const commands = [{ name: 'compact', isBuiltin: true }, { name: 'usage', isBuiltin: true }, { name: 'humanizer', isBuiltin: false }, { name: 'model', isBuiltin: true }]
  expect(phoneCommand('/compact', commands)).toEqual({ kind: 'run', name: 'compact', args: '' })
  expect(phoneCommand('/humanizer fix the README', commands)).toEqual({ kind: 'run', name: 'humanizer', args: 'fix the README' })
  expect(phoneCommand('/model opus', commands)).toEqual({ kind: 'run', name: 'model', args: 'opus' })
  expect(phoneCommand('/cost', commands)).toEqual({ kind: 'refuse', text: '/cost is not a command in this session' })
  expect(phoneCommand('/usage', commands)).toMatchObject({ kind: 'refuse' })
  expect(phoneCommand('/Users/me/notes.md read this', commands)).toEqual({ kind: 'prompt' })
  expect(phoneCommand('run the tests', commands)).toEqual({ kind: 'prompt' })
  // the mod's own commands are answered by the mod: its own $.command.run would reach none of its hooks
  const own = [...commands, { name: 'secrets', isBuiltin: false, isOwn: true }, { name: 'secret-forget', isBuiltin: false, isOwn: true }]
  expect(phoneCommand('/secrets', own)).toEqual({ kind: 'own', name: 'secrets', args: '' })
  expect(phoneCommand('/secret-forget ACME_KEY', own)).toEqual({ kind: 'own', name: 'secret-forget', args: 'ACME_KEY' })
})

test('the phone keeps whole turns, each from its prompt; a long turn shows its last 30 tool calls', () => {
  const tool = (i: number) => ({ tool_use_id: `t${i}`, tool: 'Bash', input: { command: `step ${i}` }, text: 'ok' })
  const turn = (n: number, tools: number) => [
    { role: 'user', text: `prompt ${n}`, toolUses: [] },
    { role: 'assistant', text: `answer ${n}`, toolUses: Array.from({ length: tools }, (_, i) => tool(n * 100 + i)) },
  ]
  // 25 turns: the first 5 go whole, never half of one
  const many = transcriptOf(Array.from({ length: 25 }, (_, n) => turn(n, 2)).flat(), '/w')
  expect(many[0]).toEqual({ k: 'user', text: 'prompt 5' })
  expect(many.filter(t => t.k === 'user').length).toBe(20)
  // one turn of 45 tool calls: its prompt stays, 15 are counted, the last 30 shown
  const long = transcriptOf(turn(1, 45), '/w')
  expect(long.slice(0, 3)).toEqual([{ k: 'user', text: 'prompt 1' }, { k: 'text', text: 'answer 1' }, { k: 'more', n: 15 }])
  expect(long.filter(t => t.k === 'tool').length).toBe(30)
  expect((long[3] as { arg: string }).arg).toBe('step 115')
})

test('a command sent from the phone takes its place in the transcript, where the session stood when it ran', () => {
  const list = [
    { role: 'user', text: 'first', toolUses: [] },
    { role: 'assistant', text: 'one', toolUses: [] },
    { role: 'user', text: 'second', toolUses: [] },
    { role: 'assistant', text: 'two', toolUses: [] },
  ]
  const items = transcriptOf(list, '/w', [
    { anchor: 2, command: '/secrets', text: 'FIGMA_TOKEN -> api.figma.com', isError: false },
    { anchor: 4, command: '/compact', text: 'ran', isError: false },
  ])
  expect(items.map(t => (t.k === 'cmd' ? t.command : t.k === 'user' || t.k === 'text' ? t.text : t.k))).toEqual(['first', 'one', '/secrets', 'second', 'two', '/compact'])
})

test('a command typed in the terminal: what it printed goes under it, not in a bubble of yours', () => {
  const items = transcriptOf([
    { role: 'user', text: '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>', toolUses: [] },
    { role: 'user', text: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>', toolUses: [] },
    { role: 'user', text: '<local-command-stdout>\x1b[2mCompacted (ctrl+o to see full summary)\x1b[22m</local-command-stdout>', toolUses: [] },
    { role: 'user', text: '<local-command-stderr>nothing to do</local-command-stderr>', toolUses: [] },
    { role: 'user', text: '[Image #3] fix this', toolUses: [] },
  ], '/w')
  expect(items).toEqual([
    { k: 'cmd', command: '/compact', text: 'Compacted (ctrl+o to see full summary)', isError: false },
    { k: 'user', text: '[Image #3] fix this' },
  ])
})

test('a prompt typed while Claude worked shows after the tool call it came in on', () => {
  // grep -n -o of the tool results and queued rows, and grep -n of those rows whole
  const row = (r: object) => JSON.stringify(r)
  const marks = ['3:"tool_use_id":"a","type":"tool_result"', '5:"type":"tool_result","tool_use_id":"b"', '7:"type":"queued_command"', '8:"type":"queued_command"', '9:"type":"queued_command"', '10:"type":"queued_command"']
  const queued = [
    `7:${row({ attachment: { type: 'queued_command', prompt: '[Image #4] the bubble is gone', origin: { kind: 'human' } } })}`,
    `8:${row({ attachment: { type: 'queued_command', prompt: '<task-notification>done</task-notification>' } })}`,
    `9:${row({ isSidechain: true, attachment: { type: 'queued_command', prompt: 'an agent', origin: { kind: 'human' } } })}`,
    '10:not json',
  ]
  const mids = midTurnsIn(marks, queued)
  expect(mids).toEqual([{ after: 'b', text: '[Image #4] the bubble is gone', at: 0 }])
  const items = transcriptOf([
    { role: 'user', text: 'fix it', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: { command: 'ls' }, text: 'x' }, { tool_use_id: 'b', tool: 'Bash', input: { command: 'pwd' }, text: '/w' }] },
    { role: 'assistant', text: 'Done.', toolUses: [] },
  ], '/w', [], [...mids, { after: 'gone', text: 'compacted away', at: 2 }])
  expect(items.map(i => (i.k === 'tool' ? `tool:${i.id}` : `${i.k}:${(i as any).text}`))).toEqual(['user:fix it', 'tool:a', 'tool:b', 'user:[Image #4] the bubble is gone', 'text:Done.'])
})

test('a panel\'s command as a page on the phone: built on ask, a press carried out, the page sent again', async ($, on) => {
  let inbox: unknown[] = []
  const snapshots: any[] = []
  engine(on, {
    hub: (path, body) => {
      if (path === '/session') snapshots.push(JSON.parse(body))
      if (path === '/inbox') {
        const pages = inbox
        inbox = []
        return { texts: [], pages }
      }
      return STATUS
    },
  })
  const ran: string[] = []
  const set: unknown[] = []
  const written: Record<string, string> = {}
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('command.run', (_: unknown, e: any) => (ran.push(`${e.command} ${e.args}`), { text: '' }))
  on('config.list', () => ({ value: [
    { key: 'verbose', label: 'Verbose output', kind: 'boolean', value: false, provider: { plugin: 'engine' }, isLocked: false },
    { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], provider: { plugin: 'engine' }, isLocked: true },
    { key: 'defaultMode', label: 'Default permission mode', kind: 'choice', value: 'default', options: ['default', 'bypassPermissions'], provider: { plugin: 'engine' }, isLocked: false },
  ] as never }))
  on('config.set', (_: unknown, e: any) => (set.push(e), { value: e.value }))
  // the file as last written, read back
  on('fs.exists', (_: unknown, e: any) => ({ value: e.path in written }))
  on('fs.read', (_: unknown, e: any) => ({ value: written[e.path] ?? '' }))
  on('fs.write', (_: unknown, e: any) => ((written[e.path] = e.text), { value: undefined }))
  // the terminal's answer to the phone's request to loosen the guard
  const asked: string[] = []
  let answer = 'Allow'
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: any) => {
    asked.push(e.questions[0].question)
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } } }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await switchOn(band)
  await clock.advance(2000)
  const pageOf = (name: string) => [...snapshots].reverse().find(s => s.pages?.some((p: any) => p.name === name))?.pages.find((p: any) => p.name === name)
  // /model: the models to pick from; a pick runs /model
  inbox = [{ cmd: 'model' }]
  await clock.advance(2000)
  expect(pageOf('model').sections[0].rows.map((r: any) => r.label)).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.1'])
  inbox = [{ cmd: 'model', key: 'm:sonnet' }]
  await clock.advance(2000)
  expect(ran).toContain('model sonnet')
  // /config: a toggle set as the menu sets it; a locked row refused
  inbox = [{ cmd: 'config' }]
  await clock.advance(2000)
  const rows = pageOf('config').sections[0].rows
  expect(rows[0]).toMatchObject({ key: 'c:verbose', kind: 'toggle', isOn: false })
  expect(rows[1]).toMatchObject({ key: 'c:theme', kind: 'choice', isLocked: true, options: ['dark', 'light'] })
  inbox = [{ cmd: 'config', key: 'c:verbose', value: true }, { cmd: 'config', key: 'c:theme', value: 'light' }]
  await clock.advance(2000)
  expect(set).toEqual([expect.objectContaining({ key: 'verbose', value: true })])
  expect(pageOf('config').error).toBe('Your organization sets this one.')
  // a row past the look of things waits for Allow in the terminal: Deny changes nothing
  answer = 'Deny'
  inbox = [{ cmd: 'config', key: 'c:defaultMode', value: 'bypassPermissions' }]
  await clock.advance(2000)
  expect(asked.at(-1)).toContain('Default permission mode (defaultMode) to "bypassPermissions"')
  expect(set).toHaveLength(1)
  answer = 'Allow'
  inbox = [{ cmd: 'config', key: 'c:defaultMode', value: 'bypassPermissions' }]
  await clock.advance(2000)
  expect(set.at(-1)).toMatchObject({ key: 'defaultMode', value: 'bypassPermissions' })
  asked.length = 0
  // /permissions: a rule added goes to .claude/settings.local.json; a malformed one is refused.
  // An ask or deny rule goes in at once; an allow rule waits for Allow in the terminal
  inbox = [{ cmd: 'permissions', key: 'add', value: 'deny\nRead(./secrets/**)' }]
  await clock.advance(2000)
  expect(JSON.parse(written['/work/shop/.claude/settings.local.json']!).permissions.deny).toEqual(['Read(./secrets/**)'])
  expect(asked).toEqual([])
  answer = 'Deny'
  inbox = [{ cmd: 'permissions', key: 'add', value: 'allow\nBash(npm test:*)' }]
  await clock.advance(2000)
  expect(asked[0]).toContain('add the allow rule Bash(npm test:*)')
  // asked in the terminal's own dialog: never on the phone, which could answer for itself
  expect(snapshots.some(s => s.ask)).toBe(false)
  expect(JSON.parse(written['/work/shop/.claude/settings.local.json']!).permissions.allow).toBeUndefined()
  answer = 'Allow'
  inbox = [{ cmd: 'permissions', key: 'add', value: 'allow\nBash(npm test:*)' }]
  await clock.advance(2000)
  expect(JSON.parse(written['/work/shop/.claude/settings.local.json']!).permissions.allow).toEqual(['Bash(npm test:*)'])
  inbox = [{ cmd: 'permissions', key: 'add', value: 'allow\nrm -rf /' }]
  await clock.advance(2000)
  expect(pageOf('permissions').error).toContain('Tool(pattern)')
  // a name that is no page is left alone
  inbox = [{ cmd: 'exit' }]
  await clock.advance(2000)
  expect(pageOf('exit')).toBeUndefined()
})

test('a folder given to /add-dir reaches the phone once Claude may read there', async ($, on) => {
  const snapshots: any[] = []
  engine(on, { hub: (path, body) => (path === '/session' && snapshots.push(JSON.parse(body)), STATUS) })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('command.run', () => ({ text: '' }))
  // the engine took /work/lib as a working folder; /etc it was never given or turned down
  on('tool.check', (_: unknown, e: any) => ({ decision: String(e.input?.file_path ?? '').startsWith('/work/lib/') ? 'allow' : 'ask' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: e.name } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  const clock = mock.clock(on)
  await ($ as any).session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'cc-mod-statusbar', surface: 'terminal', ...BAND } as never)
  await ($ as any).command.run({ command: 'add-dir', args: '/work/lib' })
  await ($ as any).command.run({ command: 'add-dir', args: '/etc' })
  await switchOn(band) // joining reads the folders
  await clock.advance(2000)
  expect(snapshots.at(-1).roots).toEqual(['/work/shop', '/work/lib'])
})
