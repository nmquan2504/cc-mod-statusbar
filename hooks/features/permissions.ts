import { logAudit } from './audit'
import { editSettings, scopeFile, scopeNow } from './settingsfile'

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

// The deny rules the shield menu suggests when there are none: the secrets this mod locks in
// the files menu (.env, secrets/, exports/, key files) and the SSH and cloud keys in the home folder.
export const SUGGESTED_DENY = [
  'Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)', 'Read(./exports/**)',
  'Read(./**/*.pem)', 'Read(./**/*.key)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)',
]

// The settings hook the shield menu suggests when there is none: an audit trail, each Bash call's
// hook input appended as one JSON line to .claude/audit.jsonl. It records; it blocks nothing.
export const AUDIT_LOG = '"$CLAUDE_PROJECT_DIR/.claude/audit.jsonl"'

export const AUDIT_HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: `cat >> ${AUDIT_LOG}; echo >> ${AUDIT_LOG}` }] }

export async function addSuggestedDeny($: any) {
  await editSettings($, json => {
    json.permissions ??= {}
    json.permissions.deny ??= []
    for (const rule of SUGGESTED_DENY) if (!json.permissions.deny.includes(rule)) json.permissions.deny.push(rule)
  })
  await logAudit($, `added ${SUGGESTED_DENY.length} deny rules to ${scopeFile[scopeNow()]}`)
}

export async function addAuditHook($: any) {
  await editSettings($, json => {
    json.hooks ??= {}
    json.hooks.PreToolUse ??= []
    if (!JSON.stringify(json.hooks.PreToolUse).includes('audit.jsonl')) json.hooks.PreToolUse.push(AUDIT_HOOK)
  })
  await logAudit($, `added a PreToolUse audit hook to ${scopeFile[scopeNow()]}`)
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
