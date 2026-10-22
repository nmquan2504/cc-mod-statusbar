import { logAudit } from './audit'

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

// Adds the rule to this project's .claude/settings.local.json (the file you keep out of git).
// Read, change and write this project's .claude/settings.local.json (made when missing).
export async function editLocalSettings($: any, change: (json: any) => void) {
  const root: string = await $.session.cwd()
  const path = `${root}/.claude/settings.local.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const json = JSON.parse(text || '{}')
  change(json)
  await $.fs.write(path, `${JSON.stringify(json, null, 2)}\n`)
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
  await editLocalSettings($, json => {
    json.permissions ??= {}
    json.permissions.deny ??= []
    for (const rule of SUGGESTED_DENY) if (!json.permissions.deny.includes(rule)) json.permissions.deny.push(rule)
  })
  await logAudit($, `added ${SUGGESTED_DENY.length} deny rules to .claude/settings.local.json`)
}

export async function addAuditHook($: any) {
  await editLocalSettings($, json => {
    json.hooks ??= {}
    json.hooks.PreToolUse ??= []
    if (!JSON.stringify(json.hooks.PreToolUse).includes('audit.jsonl')) json.hooks.PreToolUse.push(AUDIT_HOOK)
  })
  await logAudit($, 'added a PreToolUse audit hook to .claude/settings.local.json')
}

export async function allowRule($: any, rule: string) {
  await editLocalSettings($, json => {
    json.permissions ??= {}
    json.permissions.allow ??= []
    if (!json.permissions.allow.includes(rule)) json.permissions.allow.push(rule)
  })
  const all = ((await $.store.get(ASK_KEY).catch(() => undefined)) ?? {}) as AskCount
  delete all[rule]
  await $.store.set(ASK_KEY, all)
  await logAudit($, `allowed ${rule} in .claude/settings.local.json`)
}
