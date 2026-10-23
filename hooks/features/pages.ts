import { atom, read, update } from 'claude-code'
import { EFFORTS, MODELS } from '../lib/catalog'
import { shortModel } from '../lib/format'
import { logAudit } from './audit'
import { checkMcp, readMcp } from './mcp'
import { editLocalSettings } from './permissions'
import { refreshBar } from './status'
import { readBreakdown } from './usage'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
const ctxBreakdown = atom({ plugin: 'cc-mod-statusbar', key: 'ctxBreakdown' } as const, null)
const mcpServers = atom({ plugin: 'cc-mod-statusbar', key: 'mcpServers' } as const, [])
const mcpCheck = atom({ plugin: 'cc-mod-statusbar', key: 'mcpCheck' } as const, null)

// The slash commands that open a panel in the terminal, drawn on the phone as pages of their own:
// a panel draws in the terminal alone, and nothing from the phone could close one. The mod builds
// each page as data, the phone draws every page with one renderer, and a press comes back as an
// action ({ key, value }) the page's own code carries out.
export const PAGES = ['model', 'effort', 'config', 'permissions', 'context', 'mcp'] as const
export type PageName = (typeof PAGES)[number]
export const isPage = (name: string): name is PageName => (PAGES as readonly string[]).includes(name)

// info: a figure to read; pick: one of a list (the one in force marked); toggle, choice, text,
// number: a value to change; action: a button; remove: a row a second press deletes; add: a new
// entry, typed, with one of `options` picked.
export type PageRow = {
  key: string
  label: string
  kind: 'info' | 'pick' | 'toggle' | 'choice' | 'text' | 'number' | 'action' | 'remove' | 'add'
  value?: string
  detail?: string
  isOn?: boolean
  options?: string[]
  isLocked?: boolean
  tone?: 'good' | 'warn' | 'bad'
}
export type Page = { name: PageName; title: string; note?: string; error?: string; sections: { title?: string; rows: PageRow[] }[]; at: number }

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

async function modelPage($: any): Promise<Omit<Page, 'name' | 'at'>> {
  const now = shortModel((await read($, bar)).model)
  return {
    title: 'Model',
    note: 'A pick runs /model, which also makes it the default for new sessions.',
    sections: [{ rows: MODELS.map(m => ({ key: `m:${m.alias}`, label: m.label, kind: 'pick', isOn: now === m.label, detail: m.note || undefined })) }],
  }
}

async function effortPage($: any): Promise<Omit<Page, 'name' | 'at'>> {
  const now = (await read($, bar)).effort
  return {
    title: 'Effort',
    note: 'A pick runs /effort, which also makes it the default for new sessions.',
    sections: [{ rows: EFFORTS.map(f => ({ key: `e:${f.level}`, label: f.level, kind: 'pick', isOn: now === f.level, detail: f.note })) }],
  }
}

// /config's rows as the menu would draw them: Claude Code's own, then each plugin's
async function configPage($: any): Promise<Omit<Page, 'name' | 'at'>> {
  const rows: any[] = await $.config.list().catch(() => [])
  const groups = new Map<string, PageRow[]>()
  for (const r of rows) {
    const owner = r.provider?.plugin && r.provider.plugin !== 'engine' ? String(r.provider.plugin) : 'Claude Code'
    const kind: PageRow['kind'] = r.kind === 'boolean' ? 'toggle' : r.kind === 'choice' ? 'choice' : r.kind === 'number' ? 'number' : 'text'
    const row: PageRow = { key: `c:${r.key}`, label: String(r.label ?? r.key), kind, detail: r.description || undefined, isLocked: r.isLocked === true || undefined }
    if (kind === 'toggle') row.isOn = r.value === true
    else row.value = r.value === undefined || r.value === null ? '' : String(r.value)
    if (Array.isArray(r.options)) row.options = r.options.map(String)
    groups.set(owner, [...(groups.get(owner) ?? []), row])
  }
  return {
    title: 'Config',
    note: 'A change is written as /config writes it. A row with a lock is set by your organization.',
    sections: [...groups].map(([title, list]) => ({ title, rows: list })),
  }
}

// The rules in force, merged from every settings file; those in this project's
// .claude/settings.local.json can be removed here, and a rule added goes there.
const LISTS = ['allow', 'ask', 'deny'] as const
async function localRules($: any) {
  const root: string = await $.session.cwd().catch(() => '')
  const path = `${root}/.claude/settings.local.json`
  const text: string = (await $.fs.exists(path).catch(() => false)) ? await $.fs.read(path).catch(() => '{}') : '{}'
  try {
    return (JSON.parse(text || '{}').permissions ?? {}) as Record<string, string[] | undefined>
  } catch {
    return {}
  }
}

async function permissionsPage($: any): Promise<Omit<Page, 'name' | 'at'>> {
  const merged = ((await $.settings.read().catch(() => ({}))) as any)?.permissions ?? {}
  const local = await localRules($)
  const sections = LISTS.map(list => {
    const rules: string[] = Array.isArray(merged[list]) ? merged[list] : []
    const isLocal = (r: string) => (local[list] ?? []).includes(r)
    return {
      title: `${list[0]!.toUpperCase()}${list.slice(1)} rules (${rules.length})`,
      rows: rules.map((r): PageRow => (isLocal(r) ? { key: `rm:${list}:${r}`, label: r, kind: 'remove', detail: 'in .claude/settings.local.json' } : { key: `in:${list}:${r}`, label: r, kind: 'info', detail: 'set in another settings file' })),
    }
  })
  return {
    title: 'Permissions',
    note: 'A rule added here goes to .claude/settings.local.json in this project, the file kept out of git.',
    sections: [...sections, { title: 'Add a rule', rows: [{ key: 'add', label: 'Bash(npm test:*), WebFetch(domain:example.com), Read(./docs/**)', kind: 'add', options: [...LISTS] }] }],
  }
}

async function contextPage($: any): Promise<Omit<Page, 'name' | 'at'>> {
  let c: any = await read($, ctxBreakdown)
  if (!c || Date.now() - c.at > 60_000) {
    await readBreakdown($, c?.detail === 'full' ? 'full' : 'summary').catch(() => undefined)
    c = await read($, ctxBreakdown)
  }
  if (!c) return { title: 'Context', error: 'The session has not reported its context yet.', sections: [] }
  const rows = (list: { label: string; tokens: number; detail?: string }[], key: string) => list.map((r, i): PageRow => ({ key: `${key}:${i}`, label: r.label, kind: 'info', value: k(r.tokens), detail: r.detail }))
  const fill = Math.round(c.percent ?? 0)
  return {
    title: 'Context',
    note: `${k(c.total)} of ${k(c.max)} tokens (${fill}%)${c.autoCompactAt ? `, auto-compacts at ${k(c.autoCompactAt)}` : ''}. ${c.detail === 'full' ? 'Counted exactly.' : 'Estimated; Count exactly asks the API, as /context does.'}`,
    sections: [
      { title: 'By category', rows: rows(c.categories.filter((x: any) => x.tokens > 0).map((x: any) => ({ label: x.name, tokens: x.tokens })), 'cat') },
      { title: 'Memory files', rows: rows(c.memory.map((m: any) => ({ label: String(m.path).split('/').slice(-2).join('/'), tokens: m.tokens, detail: m.type })), 'mem') },
      { title: 'MCP servers', rows: rows(c.mcp.map((m: any) => ({ label: m.server, tokens: m.tokens, detail: `${m.tools} tools, ${m.loaded} loaded` })), 'mcp') },
      { title: 'Agents', rows: rows(c.agents.map((a: any) => ({ label: a.name, tokens: a.tokens, detail: a.source })), 'ag') },
      {
        rows: [
          ...(c.skills ? [{ key: 'skills', label: 'Skills', kind: 'info' as const, value: k(c.skills.tokens), detail: `${c.skills.shown} of ${c.skills.total} listed` }] : []),
          ...(c.commands ? [{ key: 'commands', label: 'Slash commands', kind: 'info' as const, value: k(c.commands.tokens), detail: `${c.commands.shown} of ${c.commands.total} listed` }] : []),
          { key: 'count', label: 'Count exactly', kind: 'action' as const, detail: 'one token-count request per tool and memory file' },
        ],
      },
    ].filter(s => s.rows.length),
  }
}

async function mcpPage($: any): Promise<Omit<Page, 'name' | 'at'>> {
  await readMcp($).catch(() => undefined)
  const servers: any[] = await read($, mcpServers)
  const check: any = await read($, mcpCheck)
  const checked = new Map<string, any>((check?.rows ?? []).map((r: any) => [String(r.name), r]))
  const rows = servers.map((s): PageRow => {
    const c = checked.get(s.name)
    const status = c?.status === 'connected' ? 'connected' : c?.status === 'auth' || s.needsAuth ? 'needs sign-in' : c?.status === 'failed' ? 'failed' : `${s.tools} tools`
    return { key: `s:${s.key}`, label: s.name, kind: 'info', value: status, detail: [c ? `${s.tools} tools` : '', c?.detail, c?.target].filter(Boolean).join(' · ') || undefined, tone: status === 'connected' ? 'good' : status === 'failed' ? 'bad' : status === 'needs sign-in' ? 'warn' : undefined }
  })
  for (const c of check?.rows ?? []) if (!servers.some(s => s.name === c.name)) rows.push({ key: `x:${c.name}`, label: c.name, kind: 'info', value: c.status === 'failed' ? 'failed' : c.status, detail: [c.detail, c.target].filter(Boolean).join(' · ') || undefined, tone: c.status === 'failed' ? 'bad' : c.status === 'auth' ? 'warn' : 'good' })
  return {
    title: 'MCP servers',
    note: check ? `Checked ${Math.max(0, Math.round((Date.now() - check.at) / 60_000))} min ago. Sign-ins and changes are made at the computer.` : 'Not checked yet: Check asks each server whether it answers (claude mcp list).',
    sections: [{ rows }, { rows: [{ key: 'check', label: 'Check servers', kind: 'action', detail: 'runs claude mcp list; it can take a minute' }] }],
  }
}

// each page by name ($ goes only to a function called by its own name)
async function pageOf($: any, name: PageName): Promise<Omit<Page, 'name' | 'at'>> {
  switch (name) {
    case 'model': return modelPage($)
    case 'effort': return effortPage($)
    case 'config': return configPage($)
    case 'permissions': return permissionsPage($)
    case 'context': return contextPage($)
    case 'mcp': return mcpPage($)
  }
}

export async function buildPage($: any, name: PageName, error?: string): Promise<Page> {
  const page = await pageOf($, name).catch((e: unknown) => ({ title: `/${name}`, error: `The page could not be read: ${String(e).slice(0, 200)}`, sections: [] }))
  return { name, at: Date.now(), ...page, ...(error ? { error } : {}) }
}

// A rule as settings.json takes it: a tool name, with what it matches in parentheses
const RULE = /^[A-Za-z][\w-]*(\(.{1,280}\))?$/

// A press on the phone, carried out; the answer is an error to show, or '' when it went through.
// `then` runs what finishes later (a check of every MCP server), and the page is built again after.
// A change from the phone that could loosen the guard asks in the terminal's own dialog first: the
// mod's own $.ui.ask skips its AskUserQuestion hook, so the phone never sees it and cannot answer
// for itself. True on Allow.
async function allowedAtComputer($: any, question: string) {
  const ALLOW = 'Allow'
  return (await $.ui.ask(question, { header: 'Phone', options: [ALLOW, 'Deny'] }).catch(() => undefined)) === ALLOW
}

// The /config rows the phone changes at once, as they only change how things look; any other row
// (a permission mode among them) waits for Allow in the terminal.
const CONFIG_SAFE = new Set(['theme', 'verbose', 'autoCompact'])

export async function pageAction($: any, name: PageName, key: string, value: unknown, then: (p: Promise<unknown>) => void): Promise<string> {
  if (name === 'model' && key.startsWith('m:')) {
    const m = MODELS.find(x => `m:${x.alias}` === key)
    if (!m) return 'No such model.'
    await $.command.run({ command: 'model', args: m.alias })
    await refreshBar($).catch(() => undefined)
    return ''
  }
  if (name === 'effort' && key.startsWith('e:')) {
    const f = EFFORTS.find(x => `e:${x.level}` === key)
    if (!f) return 'No such effort.'
    await $.command.run({ command: 'effort', args: f.level })
    await update($, bar, b => ({ ...b, effort: f.level }))
    return ''
  }
  if (name === 'config' && key.startsWith('c:')) {
    const rowKey = key.slice(2)
    const row: any = ((await $.config.list().catch(() => [])) as any[]).find(r => r.key === rowKey)
    if (!row) return 'That setting is gone.'
    if (row.isLocked) return 'Your organization sets this one.'
    const typed = row.kind === 'boolean' ? value === true || value === 'true' : row.kind === 'number' ? Number(value) : String(value ?? '')
    if (row.kind === 'number' && !Number.isFinite(typed)) return 'Not a number.'
    if (row.kind === 'choice' && Array.isArray(row.options) && !row.options.map(String).includes(String(typed))) return 'Not one of its choices.'
    const set = async () => {
      const r = await $.config.set({ key: rowKey, value: typed }).catch((e: unknown) => ({ deny: String(e) }))
      if (r?.deny) $.ui.toast(`statusbar: remote: ${row.label} not changed: ${r.deny}`)
      else await logAudit($, `set ${rowKey} to ${JSON.stringify(typed)}, from the phone`).catch(() => undefined)
      return r
    }
    if (!CONFIG_SAFE.has(rowKey)) {
      then((async () => {
        if (await allowedAtComputer($, `The phone asks to set ${row.label} (${rowKey}) to ${JSON.stringify(typed)}. Allow it?`)) return set()
        await logAudit($, `refused: the phone would have set ${rowKey} to ${JSON.stringify(typed)}`).catch(() => undefined)
        $.ui.toast(`statusbar: remote: the phone's change to ${row.label} was not made`)
      })())
      return 'Waiting for Allow in the terminal: only the look of things changes from here at once.'
    }
    const r = await set()
    return r?.deny ? `Not changed: ${r.deny}` : ''
  }
  if (name === 'permissions' && (key.startsWith('rm:') || key === 'add')) {
    const [list, rule] = key === 'add' ? String(value ?? '').split('\n', 2).map(s => s.trim()) : [key.split(':')[1], key.split(':').slice(2).join(':')]
    if (!(LISTS as readonly string[]).includes(list ?? '')) return 'Pick allow, ask or deny.'
    if (!rule || !RULE.test(rule)) return 'Write the rule as Tool or Tool(pattern), such as Bash(npm test:*).'
    const what = `${key === 'add' ? 'added' : 'removed'} ${list} rule ${rule} in .claude/settings.local.json`
    const apply = async () => {
      await editLocalSettings($, json => {
        json.permissions ??= {}
        const now: string[] = json.permissions[list!] ?? []
        json.permissions[list!] = key === 'add' ? (now.includes(rule) ? now : [...now, rule]) : now.filter(r => r !== rule)
      })
      await logAudit($, `${what}, from the phone`).catch(() => undefined)
    }
    // an allow rule added or a deny rule taken away loosens the guard: whoever holds the phone
    // waits for Allow in the terminal, as pairing does; the page says so meanwhile
    if ((key === 'add' && list === 'allow') || (key !== 'add' && list === 'deny')) {
      then((async () => {
        if (await allowedAtComputer($, `The phone asks to ${key === 'add' ? 'add the allow rule' : 'remove the deny rule'} ${rule} in .claude/settings.local.json, which lets Claude do more without asking. Allow it?`)) return apply()
        await logAudit($, `refused: the phone ${what.replace(/^added/, 'would have added').replace(/^removed/, 'would have removed')}`).catch(() => undefined)
        $.ui.toast(`statusbar: remote: the phone's ${list} rule change was not made`)
      })())
      return 'Waiting for Allow in the terminal: this rule lets Claude do more without asking.'
    }
    await apply()
    return ''
  }
  if (name === 'context' && key === 'count') {
    then(readBreakdown($, 'full'))
    return ''
  }
  if (name === 'mcp' && key === 'check') {
    then(checkMcp($))
    return ''
  }
  return 'That does nothing on this page.'
}
