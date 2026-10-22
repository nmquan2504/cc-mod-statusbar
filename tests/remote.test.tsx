import { expect, test } from 'claude-code/testing'
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
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    opts.argvs?.push(e.argv)
    return { value: e.argv[0] === 'id' ? ran('501\n') : e.argv[0] === '/bin/sh' ? ran() : { ...ran(), exitCode: 1 } }
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
