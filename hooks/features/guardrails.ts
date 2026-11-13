import type { GuardInfo } from '../../types'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'
import type { CfgKey } from '../state/config'

// The guardrails the shield menu lists. Each is on (a green ✓) or off (a red ✗), and a press on
// its row switches it. Two kinds:
//   setting: read from Claude Code's own settings, as they stand: a set of deny rules is on while
//     every rule of it is in the merged settings, the audit hook while it is there, the mode while it
//     is not bypass, the sandbox while it is enabled. A press writes the rules or the hook into the
//     scope chip's file (or takes them out of every file that has them), or opens the mode menu or
//     /sandbox.
//   guard: a check this mod makes on every tool call or turn, on while its switch is on.
export type DenySetId = 'denyProject' | 'denyHome' | 'denyLogins' | 'denyClaude'
export type GuardId = DenySetId | 'hooks' | 'mode' | 'sandbox' | 'danger' | 'vault' | 'redact' | 'proveDone' | 'taskList' | 'git' | 'outside' | 'egress' | 'budget' | 'deps'
// core: off, it turns the bar's ◈ red (secrets open to Claude, or no prompts at all)
export type GuardRow = { id: GuardId; key?: CfgKey; kind: 'setting' | 'guard'; title: string; what: string; isCore?: boolean }

// Each deny set: the paths it shuts to Read (Read, Grep, Glob) and Edit (Edit, Write, NotebookEdit).
// A Bash command such as cat still reaches them: the sandbox is what walls Bash off.
const readWrite = (paths: string[]) => paths.flatMap(p => [`Read(${p})`, `Edit(${p})`])
export const DENY_SETS: Record<DenySetId, string[]> = {
  denyProject: readWrite(['./.env', './.env.*', './secrets/**', './exports/**', './**/*.pem', './**/*.key']),
  denyHome: readWrite(['~/.ssh/**', '~/.aws/**']),
  denyLogins: readWrite(['~/.config/gcloud/**', '~/.azure/**', '~/.kube/**', '~/.docker/config.json', '~/.npmrc', '~/.pypirc', '~/.netrc', '~/.git-credentials', '~/.gnupg/**']),
  // Claude cannot loosen its own rules or hooks; you still can, here or in /permissions
  denyClaude: ['Edit(./.claude/settings.json)', 'Edit(./.claude/settings.local.json)', 'Edit(~/.claude/settings.json)'],
}
export const isDenySet = (id: GuardId): id is DenySetId => id in DENY_SETS

export const GUARDRAILS: GuardRow[] = [
  { id: 'denyProject', kind: 'setting', isCore: true, title: 'Deny project secrets and keys', what: '.env, .env.*, secrets/, exports/, *.pem, *.key: no Read, no Edit' },
  { id: 'denyHome', kind: 'setting', isCore: true, title: 'Deny home secrets and keys', what: '~/.ssh, ~/.aws: no Read, no Edit' },
  { id: 'denyLogins', kind: 'setting', title: 'Deny cloud and registry logins', what: 'gcloud, Azure, kube, Docker, .npmrc, .pypirc, .netrc, .git-credentials, .gnupg' },
  { id: 'denyClaude', kind: 'setting', title: 'Deny edits to Claude settings', what: "Claude cannot change its own rules and hooks in the settings files" },
  { id: 'hooks', kind: 'setting', title: 'Audit hook', what: 'each Bash call appended to .claude/audit.jsonl; it records, blocks nothing' },
  { id: 'mode', kind: 'setting', isCore: true, title: 'A mode that asks', what: 'not bypass permissions' },
  { id: 'sandbox', kind: 'setting', title: 'Sandbox', what: 'Bash runs walled off from your files and network' },
  { id: 'danger', key: 'dangerConfirm', kind: 'guard', title: 'Dangerous commands', what: 'rm -rf, push --force, reset --hard, curl | sh ask you, in any mode' },
  { id: 'vault', key: 'guardVault', kind: 'guard', title: 'Secret vault', what: "Bash never reads the vault; its values are masked in what Bash prints" },
  { id: 'redact', key: 'guardRedact', kind: 'guard', title: 'Redact PII and secrets', what: 'emails, phone numbers, ID and card numbers, keys masked in what tools give Claude' },
  { id: 'proveDone', key: 'guardProveDone', kind: 'guard', title: 'Prove done', what: 'files changed and nothing run to check them: Claude is asked once to show it works' },
  { id: 'taskList', key: 'guardTaskList', kind: 'guard', title: 'Task list first', what: 'an edit or a 3rd command with no task list is stopped once; the list kept current; the band shows the task in progress' },
  { id: 'git', key: 'guardGit', kind: 'guard', title: 'Protect git', what: 'no push to main or master, no force push; reset --hard of a pushed branch asks' },
  { id: 'outside', key: 'guardOutside', kind: 'guard', title: 'Stay in the project', what: 'Edit or Write outside the project and its added folders asks you' },
  { id: 'egress', key: 'guardEgress', kind: 'guard', title: 'Network allowlist', what: 'a host off the list asks you before WebFetch or a command reaches it' },
  { id: 'budget', key: 'guardBudget', kind: 'guard', title: 'Turn budget', what: 'a toast at the cost or time set in Settings, the turn stopped at twice it' },
  { id: 'deps', key: 'guardDeps', kind: 'guard', title: 'New packages', what: 'npm, pnpm, yarn, pip, uv, cargo or go installing a package asks you' },
]

export const isOn = (id: GuardId) => {
  const key = GUARDRAILS.find(g => g.id === id)?.key
  return key ? Boolean(cfg[key]) : false
}

// The audit hook in the settings: a hook command that writes audit.jsonl
export const hasAuditHook = (g: GuardInfo) => (g.hookList ?? []).some(h => h.command.includes('audit.jsonl'))

// One guardrail as it stands: off (a red ✗); on (a green ✓); on but lacking what it needs (a yellow !).
export type GuardState = 'off' | 'pass' | 'warn'
export function guardState(row: GuardRow, g: GuardInfo, mode: string): { state: GuardState; note: string } {
  if (isDenySet(row.id)) {
    const rules = DENY_SETS[row.id]
    const have = rules.filter(r => g.deny.includes(r)).length
    return have === rules.length
      ? { state: 'pass', note: `${rules.length} deny rules in force` }
      : { state: 'off', note: have ? `${have} of ${rules.length} rules: a press adds the rest` : row.what }
  }
  switch (row.id) {
    case 'hooks': return hasAuditHook(g) ? { state: 'pass', note: 'Bash calls go to .claude/audit.jsonl' } : { state: 'off', note: row.what }
    case 'mode': return mode === 'bypass' ? { state: 'off', note: 'bypass permissions: no prompts at all; a press opens the mode menu' } : { state: 'pass', note: mode }
    case 'sandbox': return g.sandbox ? { state: 'pass', note: 'on; a press opens /sandbox' } : { state: 'off', note: 'off: a press opens /sandbox to set it up' }
  }
  if (!row.key || !cfg[row.key]) return { state: 'off', note: row.what }
  switch (row.id) {
    case 'egress': {
      const hosts = egressHosts()
      return hosts.length ? { state: 'pass', note: `${hosts.length} hosts allowed` } : { state: 'warn', note: 'no host allowed yet: every one asks' }
    }
    case 'budget': return { state: 'pass', note: `$${cfg.budgetUsd} or ${cfg.budgetMinutes} min a turn` }
    // with no task tool in the session there is no list to ask for: it stands down
    case 'taskList': return rt.taskTools && !rt.taskTools.length ? { state: 'warn', note: 'no task tool in this session: nothing to ask for' } : { state: 'pass', note: row.what }
    default: return { state: 'pass', note: row.what }
  }
}

// The ◈ score: the guardrails on, of them all; red while a core one is off
export function guardScore(g: GuardInfo, mode: string) {
  const states = GUARDRAILS.map(r => ({ row: r, ...guardState(r, g, mode) }))
  const ok = states.filter(s => s.state === 'pass').length
  return { ok, of: states.length, isAlert: states.some(s => s.row.isCore && s.state === 'off') }
}

// ---- the network allowlist -------------------------------------------------------------------
export const egressHosts = () => cfg.egressHosts.split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
// a host is allowed when it is on the list or under a name on it (api.github.com under github.com)
export const isHostAllowed = (host: string) => egressHosts().some(h => host === h || host.endsWith(`.${h}`))
