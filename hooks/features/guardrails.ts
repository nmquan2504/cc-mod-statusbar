import type { GuardInfo } from '../../types'
import { cfg } from '../state/config'
import type { CfgKey } from '../state/config'

// The guardrails the shield menu lists, each with its switch. Two kinds:
//   setting: a check on Claude Code's own settings, which passes or fails (deny rules, hooks, the
//     mode, the sandbox); its fix writes the settings.
//   guard: a check this mod makes on every tool call or turn; switched on, it is in force, so it
//     passes, unless it lacks what it needs (an empty allowlist).
// One switched off is left out of the ◈ score and, for a guard, not enforced.
export type GuardId = 'deny' | 'hooks' | 'mode' | 'sandbox' | 'danger' | 'vault' | 'redact' | 'proveDone' | 'git' | 'outside' | 'egress' | 'budget' | 'deps'
export type GuardRow = { id: GuardId; key: CfgKey; kind: 'setting' | 'guard'; title: string; what: string }
export const GUARDRAILS: GuardRow[] = [
  { id: 'deny', key: 'guardDeny', kind: 'setting', title: 'Deny rules', what: 'settings deny reading .env, secrets and keys' },
  { id: 'hooks', key: 'guardHooks', kind: 'setting', title: 'Settings hooks', what: 'a hook in the settings sees the tool calls' },
  { id: 'mode', key: 'guardMode', kind: 'setting', title: 'A mode that asks', what: 'not bypass permissions' },
  { id: 'sandbox', key: 'guardSandbox', kind: 'setting', title: 'Sandbox', what: 'Bash runs walled off from your files and network' },
  { id: 'danger', key: 'dangerConfirm', kind: 'guard', title: 'Dangerous commands', what: 'rm -rf, push --force, reset --hard, curl | sh ask you, in any mode' },
  { id: 'vault', key: 'guardVault', kind: 'guard', title: 'Secret vault', what: "Bash never reads the vault; its values are masked in what Bash prints" },
  { id: 'redact', key: 'guardRedact', kind: 'guard', title: 'Redact PII and secrets', what: 'emails, phone numbers, ID and card numbers, keys masked in what tools give Claude' },
  { id: 'proveDone', key: 'guardProveDone', kind: 'guard', title: 'Prove done', what: 'files changed and nothing run to check them: Claude is asked once to show it works' },
  { id: 'git', key: 'guardGit', kind: 'guard', title: 'Protect git', what: 'no push to main or master, no force push; reset --hard of a pushed branch asks' },
  { id: 'outside', key: 'guardOutside', kind: 'guard', title: 'Stay in the project', what: 'Edit or Write outside the project and its added folders asks you' },
  { id: 'egress', key: 'guardEgress', kind: 'guard', title: 'Network allowlist', what: 'a host off the list asks you before WebFetch or a command reaches it' },
  { id: 'budget', key: 'guardBudget', kind: 'guard', title: 'Turn budget', what: 'a toast at the cost or time set in Settings, the turn stopped at twice it' },
  { id: 'deps', key: 'guardDeps', kind: 'guard', title: 'New packages', what: 'npm, pnpm, yarn, pip, uv, cargo or go installing a package asks you' },
]

export const isOn = (id: GuardId) => Boolean(cfg[GUARDRAILS.find(g => g.id === id)!.key])

// One guardrail as it stands: off; on and passing; on and failing (red); on and lacking (yellow).
export type GuardState = 'off' | 'pass' | 'fail' | 'warn'
export function guardState(row: GuardRow, g: GuardInfo, mode: string): { state: GuardState; note: string } {
  if (!cfg[row.key]) return { state: 'off', note: 'off: not counted' }
  switch (row.id) {
    case 'deny': return g.deny.length ? { state: 'pass', note: `${g.deny.length} rules` } : { state: 'fail', note: 'none: Claude may read any file' }
    case 'hooks': return g.hooks.length ? { state: 'pass', note: `on ${g.hooks.join(', ')}` } : { state: 'fail', note: 'no settings hooks' }
    case 'mode': return mode === 'bypass' ? { state: 'fail', note: 'bypass permissions: no prompts at all' } : { state: 'pass', note: mode }
    case 'sandbox': return g.sandbox ? { state: 'pass', note: 'on' } : { state: 'fail', note: 'off: /sandbox sets it up' }
    case 'egress': {
      const hosts = egressHosts()
      return hosts.length ? { state: 'pass', note: `${hosts.length} hosts allowed` } : { state: 'warn', note: 'no host allowed yet: every one asks' }
    }
    case 'budget': return { state: 'pass', note: `$${cfg.budgetUsd} or ${cfg.budgetMinutes} min a turn` }
    default: return { state: 'pass', note: 'in force' }
  }
}

// The ◈ score: the guardrails switched on that pass, of those switched on
export function guardScore(g: GuardInfo, mode: string) {
  const on = GUARDRAILS.map(r => guardState(r, g, mode)).filter(s => s.state !== 'off')
  const ok = on.filter(s => s.state === 'pass').length
  return { ok, of: on.length, isAlert: on.some(s => s.state === 'fail') }
}

// ---- the network allowlist -------------------------------------------------------------------
export const egressHosts = () => cfg.egressHosts.split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
// a host is allowed when it is on the list or under a name on it (api.github.com under github.com)
export const isHostAllowed = (host: string) => egressHosts().some(h => host === h || host.endsWith(`.${h}`))
