import { atom, update } from 'claude-code'
import { logAudit } from './audit'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The NAMEs of the saved secrets, as the shield menu lists them.
const vault = atom({ plugin: 'cc-mod-statusbar', key: 'vault' } as const, [])

// ---- secret vault ------------------------------------------------------------
// Secrets go dialog -> OS keychain, never through the prompt. Claude refers to them by NAME
// and uses them only through secret_fetch, which sends each one to the host it is bound to.
// The keychain service this mod keeps its secrets under; a Bash command naming it is refused.

export const SERVICE = 'cc-mod-statusbar-vault' // keychain service; the account is the NAME

export const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/

export type Binding = { host: string; header: string; scheme: string }

export type Known = Binding & { name: string; prefix: RegExp }

// Prefix -> name and where it may be sent. Order matters (sk-ant- before sk-).
export const KNOWN: Known[] = [
  { prefix: /^fig[a-z]_/, name: 'FIGMA_TOKEN', host: 'api.figma.com', header: 'X-Figma-Token', scheme: '' },
  { prefix: /^(gh[pousr]_|github_pat_)/, name: 'GITHUB_TOKEN', host: 'api.github.com', header: 'Authorization', scheme: 'Bearer ' },
  { prefix: /^glpat-/, name: 'GITLAB_TOKEN', host: 'gitlab.com', header: 'PRIVATE-TOKEN', scheme: '' },
  { prefix: /^xox[bp]-/, name: 'SLACK_TOKEN', host: 'slack.com', header: 'Authorization', scheme: 'Bearer ' },
  { prefix: /^sk-ant-/, name: 'ANTHROPIC_API_KEY', host: 'api.anthropic.com', header: 'x-api-key', scheme: '' },
  { prefix: /^sk-/, name: 'OPENAI_API_KEY', host: 'api.openai.com', header: 'Authorization', scheme: 'Bearer ' },
]

// The chat safety net: the same prefixes, anywhere in a prompt.
export const IN_TEXT = /\b(?:fig[a-z]_|gh[pousr]_|github_pat_|glpat-|xox[bp]-|sk-ant-|sk-)[A-Za-z0-9_-]{20,200}/g

export const byValue = (v: string) => KNOWN.find(k => k.prefix.test(v))

export const byName = (n: string) => KNOWN.find(k => k.name === n)

export const normName = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')

export const meta = (name: string) => `secret:${name}`

// Values seen this session, so responses can be scrubbed and Bash guarded.
export const cache = new Map<string, string>()

// ---------- dialogs (native, outside the model's view) ----------
export const as = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export async function dialog($: any, text: string, opts: { hidden?: boolean; initial?: string } = {}) {
  const mac = await $.process.run(
    [
      'osascript',
      '-e',
      `text returned of (display dialog "${as(text)}" default answer "${as(opts.initial ?? '')}"` +
        `${opts.hidden ? ' with hidden answer' : ''} with title "cc-mod-statusbar · secret vault" with icon caution giving up after 120)`,
    ],
    { timeoutMs: 130_000 },
  ).catch(() => undefined)
  if (mac && mac.exitCode === 0) return mac.stdout.replace(/\n$/, '').trim() || undefined
  if (mac && mac.exitCode !== 127) return undefined // shown, then cancelled
  const zen = opts.hidden
    ? ['zenity', '--password', '--title=cc-mod-statusbar secret vault', '--timeout=120']
    : ['zenity', '--entry', '--title=cc-mod-statusbar secret vault', `--text=${text}`, `--entry-text=${opts.initial ?? ''}`, '--timeout=120']
  const linux = await $.process.run(zen, { timeoutMs: 130_000 }).catch(() => undefined)
  if (linux && linux.exitCode === 0) return linux.stdout.replace(/\n$/, '').trim() || undefined
  return undefined
}

// ---------- keychain (value over stdin, never argv) ----------
export async function kcSave($: any, name: string, value: string) {
  const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const mac = await $.process.run(['security', '-i'], {
    stdin: `add-generic-password -U -a ${name} -s ${SERVICE} -w ${q(value)}\n`,
  }).catch(() => undefined)
  if (mac && mac.exitCode === 0) return 'macOS Keychain'
  const linux = await $.process.run(
    ['secret-tool', 'store', `--label=${name} (Claude Code)`, 'service', SERVICE, 'account', name],
    { stdin: value },
  ).catch(() => undefined)
  if (linux && linux.exitCode === 0) return 'Secret Service'
  throw new Error('no keychain available')
}

export async function kcLoad($: any, name: string): Promise<string | undefined> {
  if (cache.has(name)) return cache.get(name)
  const mac = await $.process.run(['security', 'find-generic-password', '-a', name, '-s', SERVICE, '-w'])
    .catch(() => undefined)
  let v = mac && mac.exitCode === 0 ? mac.stdout.trim() : ''
  if (!v) {
    const linux = await $.process.run(['secret-tool', 'lookup', 'service', SERVICE, 'account', name])
      .catch(() => undefined)
    v = linux && linux.exitCode === 0 ? linux.stdout.trim() : ''
  }
  if (v) cache.set(name, v)
  return v || undefined
}

export async function kcDelete($: any, name: string) {
  await $.process.run(['security', 'delete-generic-password', '-a', name, '-s', SERVICE]).catch(() => undefined)
  await $.process.run(['secret-tool', 'clear', 'service', SERVICE, 'account', name]).catch(() => undefined)
}

export async function readVault($: any) {
  const keys: string[] = await $.store.keys().catch(() => [])
  await update($, vault, () => keys.filter(k => k.startsWith('secret:')).map(k => k.slice(7)))
}

// The one flow every entry point uses. Name given: ask only the value. No name: ask the
// value, then name it from its prefix, or ask. Unknown kind: ask which host it may go to.
export async function acquire($: any, want: { name?: string; purpose?: string }) {
  const name0 = want.name ? normName(want.name) : undefined
  if (name0 && !NAME_RE.test(name0)) return { error: `"${want.name}" is not a valid NAME (A-Z, 0-9, _).` }
  const why = want.purpose ? `\n\nClaude says: ${want.purpose.slice(0, 300)}` : ''
  const value = await dialog($, `${name0 ? `Value for ${name0}` : 'Paste a secret (token, API key)'}.${why}`, { hidden: true })
  if (!value) return { error: 'cancelled' }

  const known = byValue(value) ?? (name0 ? byName(name0) : undefined)
  let name = name0 ?? known?.name
  if (!name) {
    const typed = await dialog($, 'Name for this secret (e.g. FIGMA_TOKEN):', { initial: '' })
    name = typed ? normName(typed) : undefined
    if (!name || !NAME_RE.test(name)) return { error: 'no valid name given; nothing saved' }
  }

  let binding: Binding | undefined = (await $.store.get(meta(name))) as Binding | undefined
  if (known) binding = { host: known.host, header: known.header, scheme: known.scheme }
  if (!binding) {
    const host = await dialog($, `Which host may ${name} be sent to? (e.g. api.example.com)`, { initial: '' })
    if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return { error: 'no valid host given; nothing saved' }
    const hdr = await dialog($, `Header for ${name} (Header: scheme):`, { initial: 'Authorization: Bearer' })
    const [header, ...rest] = (hdr ?? 'Authorization: Bearer').split(':')
    binding = { host: host.toLowerCase(), header: (header ?? '').trim(), scheme: rest.join(':').trim() ? rest.join(':').trim() + ' ' : '' }
  }

  const where = await kcSave($, name, value)
  cache.set(name, value)
  await $.store.set(meta(name), binding)
  await readVault($)
  $.ui.toast(`statusbar vault: ${name} saved to ${where} (sent only to ${binding.host}).`)
  await logAudit($, `vault: saved ${name}, sent only to ${binding.host}`)
  return { name, binding, where }
}

// A secret typed on the phone (Self remote), saved with no dialog: a known prefix names it and binds
// its host; any other value needs a NAME, a host and "Header: scheme" with it. typedSecret decides
// (`stored`: the binding a NAME already has), saveTyped keeps it. The value is never shown or logged.
export type Typed = { value?: unknown; name?: unknown; host?: unknown; header?: unknown }
export function typedSecret(given: Typed, stored: (name: string) => Binding | undefined): { value: string; name: string; binding: Binding } | { error: string } {
  const value = typeof given.value === 'string' ? given.value.trim() : ''
  if (!value) return { error: 'no value given; nothing saved' }
  const name0 = typeof given.name === 'string' && given.name.trim() ? normName(given.name) : undefined
  if (name0 && !NAME_RE.test(name0)) return { error: `"${given.name}" is not a valid NAME (A-Z, 0-9, _)` }
  const known = byValue(value) ?? (name0 ? byName(name0) : undefined)
  const name = name0 ?? known?.name
  if (!name) return { error: 'an unknown kind of secret needs a NAME, a host and a header' }
  const kept = known ? { host: known.host, header: known.header, scheme: known.scheme } : stored(name)
  if (kept) return { value, name, binding: kept }
  const host = typeof given.host === 'string' ? given.host.trim().toLowerCase() : ''
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return { error: 'no valid host given; nothing saved' }
  const [header, ...rest] = (typeof given.header === 'string' && given.header.trim() ? given.header : 'Authorization: Bearer').split(':')
  return { value, name, binding: { host, header: (header ?? '').trim(), scheme: rest.join(':').trim() ? `${rest.join(':').trim()} ` : '' } }
}

export async function saveTyped($: any, given: Typed) {
  const name0 = typeof given.name === 'string' && given.name.trim() ? normName(given.name) : ''
  const stored = name0 ? ((await $.store.get(meta(name0)).catch(() => undefined)) as Binding | undefined) : undefined
  const plan = typedSecret(given, () => stored)
  if ('error' in plan) return plan
  const where = await kcSave($, plan.name, plan.value).catch(() => '')
  if (!where) return { error: 'no keychain available' }
  cache.set(plan.name, plan.value)
  await $.store.set(meta(plan.name), plan.binding)
  await readVault($)
  await logAudit($, `vault: saved ${plan.name} from the phone, sent only to ${plan.binding.host}`)
  return { name: plan.name, host: plan.binding.host, where }
}

export async function listSecrets($: any) {
  const keys = ((await $.store.keys()) as string[]).filter(k => k.startsWith('secret:'))
  const rows = await Promise.all(
    keys.map(async k => {
      const b = (await $.store.get(k)) as Binding
      return `${k.slice(7)} -> ${b.host} (${b.header})`
    }),
  )
  return rows.length ? rows.join('\n') : 'No secrets saved.'
}

export const scrub = (s: string) => {
  for (const [n, v] of cache) s = s.split(v).join(`[secret:${n}]`)
  return s
}

// A pasted secret with a known prefix is saved to the keychain and replaced by [secret:NAME].
export async function maskPrompt($: any, text: string): Promise<string> {
  const found = text.match(IN_TEXT)
  if (!found) return text
  for (const v of new Set(found)) {
    const k = byValue(v)!
    try {
      await kcSave($, k.name, v)
      cache.set(k.name, v)
      await $.store.set(meta(k.name), { host: k.host, header: k.header, scheme: k.scheme })
    } catch {
      /* masked even when it cannot be kept */
    }
    text = text.split(v).join(`[secret:${k.name}]`)
  }
  await readVault($)
  $.ui.toast('statusbar vault: a secret in your prompt was masked and saved. Next time use /secret.')
  await logAudit($, `masked ${new Set(found).size} pasted secret(s) in a prompt`, true)
  return text
}

// The vault's tools and commands, registered at session start.
export async function vaultSessionStart($: any) {
  await $.tool.register({
    name: 'secret_list',
    description: 'List the secrets the person has saved: NAME and the host each may be sent to. Never shows values.',
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'secret_request',
    description:
      'Ask the person for a secret in a private dialog (you never see it). Give a NAME if you know it ' +
      '(FIGMA_TOKEN) or leave it out and the person names it. Never ask for secrets in chat.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'NAME such as FIGMA_TOKEN; optional' },
        purpose: { type: 'string', description: 'One line shown in the dialog: why you need it' },
      },
      required: ['purpose'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'secret_fetch',
    description:
      'HTTPS request authenticated with a saved secret, by NAME. The secret is sent only to the host it is bound to ' +
      '(see secret_list) and is scrubbed from the response. If it is missing, the person is asked in a dialog.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        url: { type: 'string', description: 'https URL on the bound host' },
        method: { type: 'string', description: 'GET (default), POST, PUT, PATCH, DELETE' },
        body: { type: 'string' },
      },
      required: ['name', 'url'],
    },
    isDeferred: false,
  })
  await $.command.register({ name: 'secret', description: 'Save a secret through a private dialog', argumentHint: '[NAME]' })
  await $.command.register({ name: 'secrets', description: 'List saved secret names and their hosts' })
  await $.command.register({ name: 'secret-forget', description: 'Delete a saved secret', argumentHint: 'NAME' })
  await readVault($)
}
