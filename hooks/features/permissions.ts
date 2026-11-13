import { logAudit } from './audit'
import { SCOPES, editSettings, scopeFile, scopeNow, scopePath } from './settingsfile'

// The permission prompts you answer, counted across sessions by the rule that would skip them.
export const ASK_KEY = 'permission-asks'

export type AskCount = Record<string, { n: number; last: number }>

// A rule as settings.json spells it: Bash(npm test:*), WebFetch(domain:x.com), mcp__s__tool
export const ruleText = (r: { toolName: string; ruleContent?: string }) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)

// The engine's own allow suggestions when it made some; else the tool, with a Bash command's first word.
export function rulesFor(e: any): string[] {
  const fromEngine = (e.permission_suggestions ?? [])
    .filter((u: any) => u.type === 'addRules' && u.behavior === 'allow')
    .flatMap((u: any) => u.rules.map(ruleText))
  if (fromEngine.length) return fromEngine
  const cmd = e.tool_name === 'Bash' ? String(e.tool_input?.command ?? '').trim().split(/\s+/)[0] : ''
  return [cmd ? `Bash(${cmd}:*)` : e.tool_name]
}

export async function countAsk($: any, rules: string[]) {
  const all = ((await $.store.get(ASK_KEY).catch(() => undefined)) ?? {}) as AskCount
  for (const rule of rules) all[rule] = { n: (all[rule]?.n ?? 0) + 1, last: Date.now() }
  await $.store.set(ASK_KEY, all)
}

export const ARM_MS = 5000

// The phone's Permissions page reads and writes the project's .claude/settings.local.json alone. The
// shield menu's own writes below go to the file its scope chip picks (features/settingsfile.ts).
export async function editLocalSettings($: any, change: (json: any) => void) {
  return editSettings($, change, 'local')
}

// The audit hook a shield menu row switches: each Bash call's hook input appended as one JSON line
// to .claude/audit.jsonl. It records; it blocks nothing.
export const AUDIT_LOG = '"$CLAUDE_PROJECT_DIR/.claude/audit.jsonl"'

export const AUDIT_HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: `cat >> ${AUDIT_LOG}; echo >> ${AUDIT_LOG}` }] }

// Change every settings file that exists (project, local, user), none made: what a switch takes off
// goes from wherever it was written. The files changed, as the scope chip names them.
async function editEveryFile($: any, change: (json: any) => boolean) {
  const changed: string[] = []
  for (const scope of SCOPES) {
    const path = await scopePath($, scope).catch(() => '')
    if (!path || !(await $.fs.exists(path))) continue
    const json = JSON.parse((await $.fs.read(path)) || '{}')
    if (!change(json)) continue
    await $.fs.write(path, `${JSON.stringify(json, null, 2)}\n`)
    changed.push(scopeFile[scope])
  }
  return changed
}

// A set of deny rules switched on: the rules missing from the scope's file added there. Switched off:
// taken out of every settings file. The files written, for the toast.
export async function setDenyRules($: any, rules: readonly string[], on: boolean) {
  if (on) {
    const file = await editSettings($, json => {
      json.permissions ??= {}
      json.permissions.deny ??= []
      for (const rule of rules) if (!json.permissions.deny.includes(rule)) json.permissions.deny.push(rule)
    })
    await logAudit($, `added ${rules.length} deny rules to ${file}`)
    return [file]
  }
  const files = await editEveryFile($, json => {
    const deny = json.permissions?.deny
    if (!Array.isArray(deny) || !deny.some((r: string) => rules.includes(r))) return false
    json.permissions.deny = deny.filter((r: string) => !rules.includes(r))
    return true
  })
  await logAudit($, `took ${rules.length} deny rules out of ${files.join(', ') || 'no file'}`)
  return files
}

// The audit hook switched on (added to the scope's file) or off (taken out of every file)
export async function setAuditHook($: any, on: boolean) {
  if (on) {
    const file = await editSettings($, json => {
      json.hooks ??= {}
      json.hooks.PreToolUse ??= []
      if (!JSON.stringify(json.hooks.PreToolUse).includes('audit.jsonl')) json.hooks.PreToolUse.push(AUDIT_HOOK)
    })
    await logAudit($, `added a PreToolUse audit hook to ${file}`)
    return [file]
  }
  const files = await editEveryFile($, json => {
    const pre = json.hooks?.PreToolUse
    if (!Array.isArray(pre) || !JSON.stringify(pre).includes('audit.jsonl')) return false
    json.hooks.PreToolUse = pre.filter((m: any) => !JSON.stringify(m).includes('audit.jsonl'))
    if (!json.hooks.PreToolUse.length) delete json.hooks.PreToolUse
    if (!Object.keys(json.hooks).length) delete json.hooks
    return true
  })
  await logAudit($, `took the audit hook out of ${files.join(', ') || 'no file'}`)
  return files
}

export async function allowRule($: any, rule: string) {
  await editSettings($, json => {
    json.permissions ??= {}
    json.permissions.allow ??= []
    if (!json.permissions.allow.includes(rule)) json.permissions.allow.push(rule)
  })
  const all = ((await $.store.get(ASK_KEY).catch(() => undefined)) ?? {}) as AskCount
  delete all[rule]
  await $.store.set(ASK_KEY, all)
  await logAudit($, `allowed ${rule} in ${scopeFile[scopeNow()]}`)
}

// An MCP server's or tool's rule (mcp__server, mcp__server__tool) set to allow, deny, or neither, in
// the scope's file: taken out of both lists there first, so a rule is in one list at most
export type McpRule = 'allow' | 'deny' | 'default'
export async function setMcpRule($: any, rule: string, to: McpRule) {
  const file = await editSettings($, json => {
    json.permissions ??= {}
    for (const list of ['allow', 'deny'] as const) {
      if (Array.isArray(json.permissions[list])) json.permissions[list] = json.permissions[list].filter((r: string) => r !== rule)
    }
    if (to !== 'default') (json.permissions[to] ??= []).push(rule)
  })
  await logAudit($, `${to === 'default' ? 'cleared the rule for' : to === 'allow' ? 'allowed' : 'denied'} ${rule} in ${file}`, to === 'deny')
  return file
}
