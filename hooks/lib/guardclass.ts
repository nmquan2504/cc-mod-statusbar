// The shield menu's breakdown of the deny rules and the settings hooks: each rule or hook put under
// what it is for, so the menu says more than "8 rules" or "on PreToolUse".

// ---- deny rules ---------------------------------------------------------------------------------
export type RuleKind = 'secrets' | 'credentials' | 'destructive' | 'network' | 'mcp' | 'files' | 'tools'
export const RULE_KINDS: { kind: RuleKind; title: string }[] = [
  { kind: 'secrets', title: 'Secrets and keys' },
  { kind: 'credentials', title: 'Credential folders' },
  { kind: 'destructive', title: 'Destructive commands' },
  { kind: 'network', title: 'Network' },
  { kind: 'mcp', title: 'MCP servers and tools' },
  { kind: 'files', title: 'Other files' },
  { kind: 'tools', title: 'Other tools' },
]
const SECRET_PATH = /\.env\b|secret|\.pem\b|\.key\b|\.p12\b|\.pfx\b|\.keystore|id_rsa|id_ed25519|\.npmrc|\.netrc|\.pypirc|credential|token|\.tfvars|\.tfstate|exports\//i
const CREDENTIAL_DIR = /~\/\.(ssh|aws|kube|gnupg|docker|azure|config\/gcloud|config\/gh)\b|\.vault-token|\.git-credentials/i
const DESTRUCTIVE = /\b(rm\s+-|rm\b.*-r|sudo\b|git\s+(push\s+(-f|--force)|reset\s+--hard|clean\s+-|branch\s+-D)|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|shutdown|reboot|kill\s+-9|drop\s+(table|database)|terraform\s+destroy|kubectl\s+delete)/i
const NETWORK_CMD = /^Bash\((curl|wget|nc|ncat|ssh|scp|sftp|rsync|ftp|telnet)\b/i

export function ruleKind(rule: string): RuleKind {
  const tool = /^([\w-]+)/.exec(rule)?.[1] ?? ''
  if (tool.startsWith('mcp__')) return 'mcp'
  if (tool === 'WebFetch' || tool === 'WebSearch' || NETWORK_CMD.test(rule)) return 'network'
  if (CREDENTIAL_DIR.test(rule)) return 'credentials'
  if (SECRET_PATH.test(rule)) return 'secrets'
  if (tool === 'Bash' && DESTRUCTIVE.test(rule)) return 'destructive'
  if (['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'].includes(tool)) return 'files'
  return 'tools'
}
export function groupRules(rules: readonly string[]) {
  return RULE_KINDS.map(k => ({ ...k, rules: rules.filter(r => ruleKind(r) === k.kind) })).filter(g => g.rules.length)
}

// ---- settings hooks -----------------------------------------------------------------------------
// One hook as the settings hold it: its event, its matcher (a tool name or pattern), what it runs
export type HookEntry = { event: string; matcher: string; command: string }
export type HookPurpose = 'block' | 'audit' | 'phone' | 'notify' | 'format' | 'memory' | 'context' | 'other'
export const HOOK_PURPOSES: { purpose: HookPurpose; title: string }[] = [
  { purpose: 'block', title: 'Guards that can block' },
  { purpose: 'audit', title: 'Audit and logs' },
  { purpose: 'phone', title: 'Phone dialogs (this mod)' },
  { purpose: 'notify', title: 'Notifications' },
  { purpose: 'format', title: 'Format and lint' },
  { purpose: 'memory', title: 'Memory' },
  { purpose: 'context', title: 'Context added' },
  { purpose: 'other', title: 'Other' },
]
export function hookPurpose(h: HookEntry): HookPurpose {
  const c = h.command
  if (/dialog-hook\.mjs|cc-mod-statusbar/.test(c)) return 'phone'
  if (/claude-mem|memory|worker-service|\/mem\b/i.test(c)) return 'memory'
  if (/audit|>>\s*\S+\.(jsonl|log)|\blogger\b|tee\s+-a/i.test(c)) return 'audit'
  if (/osascript|terminal-notifier|notify-send|\bsay\b|afplay|slack|ntfy|pushover|discord/i.test(c) || h.event === 'Notification') return 'notify'
  if (/prettier|eslint|biome|black\b|ruff|gofmt|rustfmt|swiftformat|clang-format|stylelint|--fix\b/i.test(c)) return 'format'
  if (/exit\s+2|"decision"\s*:\s*"(block|deny)"|permissionDecision|\bdeny\b|\bblock\b|guard|policy|sec-default/i.test(c)) return 'block'
  if (h.event === 'UserPromptSubmit' || h.event === 'SessionStart') return 'context'
  return 'other'
}
export function groupHooks(hooks: readonly HookEntry[]) {
  return HOOK_PURPOSES.map(p => ({ ...p, hooks: hooks.filter(h => hookPurpose(h) === p.purpose) })).filter(g => g.hooks.length)
}
// every hook the merged settings name: { PreToolUse: [{ matcher, hooks: [{ type, command }] }] }
export function hookEntries(settingsHooks: unknown): HookEntry[] {
  const out: HookEntry[] = []
  if (!settingsHooks || typeof settingsHooks !== 'object') return out
  for (const [event, groups] of Object.entries(settingsHooks as Record<string, unknown>)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      const matcher = typeof (g as any)?.matcher === 'string' ? (g as any).matcher : ''
      for (const hk of Array.isArray((g as any)?.hooks) ? (g as any).hooks : [])
        out.push({ event, matcher, command: String(hk?.command ?? hk?.url ?? hk?.prompt ?? hk?.type ?? '') })
    }
  }
  return out
}
