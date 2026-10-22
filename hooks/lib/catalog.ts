import type { MenuKind } from '../../types'

import { shortModel } from './format'

export const TITLES: Record<MenuKind, string> = {
  add: '+ Quick actions',
  files: '▸ Browse files',
  web: '◎ Add a web page',
  commands: '⁄ Slash commands & skills',
  model: '● Model',
  mode: '› Permission mode',
  guard: '◈ Guardrails in force',
  tasks: '✻ What Claude is working on',
  mcp: '⌁ MCP servers',
  usage: '▰ Usage',
  git: '⎇ Changes',
  effort: '◔ Effort',
  settings: '⊞ Settings',
  images: '▣ Pasted images',
  remote: '⇄ Self remote',
}

// What /effort takes, lowest first, with what each buys.
// Each wears a theme color, cool to hot, as the models wear theirs, and a circle that fills
// as the thinking grows (one cell each, as every glyph on the bar).
export const EFFORTS = [
  { level: 'low', icon: '○', color: 'success', note: 'fastest, least thinking' },
  { level: 'medium', icon: '◔', color: 'suggestion', note: 'balanced' },
  { level: 'high', icon: '◑', color: 'warning', note: 'thinks harder' },
  { level: 'xhigh', icon: '◕', color: 'claude', note: 'thinks much harder' },
  { level: 'max', icon: '●', color: 'error', note: 'the most thinking, the slowest' },
]

export const effortColor = (level: string | null) => EFFORTS.find(f => f.level === level)?.color ?? 'subtle'

export const effortIcon = (level: string | null) => EFFORTS.find(f => f.level === level)?.icon ?? '◔'

// What /model takes, in the order the menu lists them, with the theme color each family wears.
export const MODELS = [
  { alias: 'opus', label: 'Opus 5.5', color: 'claude', note: 'most capable' },
  { alias: 'sonnet', label: 'Sonnet 5.5', color: 'suggestion', note: 'balanced' },
  { alias: 'haiku', label: 'Haiku 5.5', color: 'success', note: 'fastest' },
  { alias: 'fable', label: 'Fable 5.1', color: 'planMode', note: '' },
]

// The permission modes: `id` as a settings hook's `permission_mode` spells it, `re` as the hint
// under the prompt names it, `icon` and `color` as Claude Code draws it.
export const MODES = [
  { mode: 'manual', id: 'default', label: 'manual (default)', re: /manual mode/i, icon: '‖', color: 'text', note: 'asks before edits and commands' },
  { mode: 'acceptEdits', id: 'acceptEdits', label: 'accept edits', re: /accept edits/i, icon: '»', color: 'autoAccept', note: 'edits files, asks for commands' },
  { mode: 'plan', id: 'plan', label: 'plan', re: /plan mode/i, icon: '‖', color: 'planMode', note: 'reads and plans only' },
  { mode: 'auto', id: 'auto', label: 'auto', re: /auto mode/i, icon: '›', color: 'warning', note: 'a classifier reviews risky steps' },
  { mode: 'bypass', id: 'bypassPermissions', label: 'bypass permissions', re: /bypass permissions/i, icon: '!', color: 'error', note: 'no prompts' },
  { mode: 'dontAsk', id: 'dontAsk', label: "don't ask", re: /don.?t ask/i, icon: '⊘', color: 'inactive', note: 'only pre-approved tools' },
]

export const SKIP_DIRS = new Set(['.git', 'node_modules', '.baseline'])

// Paths the browser shows locked: the project's secrets, never handed to the prompt from here.
export const SENSITIVE = /(^|\/)(\.env(\..*)?|secrets|exports|id_(rsa|ed25519)[^/]*|[^/]*\.(pem|key|p12))(\/|$)/i

export const modelStyle = (id: string) => MODELS.find(m => m.label === shortModel(id)) ?? { color: 'text', note: '' }

export const modeStyle = (mode: string) => MODES.find(m => m.mode === mode) ?? MODES[0]!

// The order shift+tab walks the modes in (bypass joins only when the session allows it).
export const CYCLE = ['manual', 'acceptEdits', 'plan', 'auto']

// How many shift+tab presses lead from one mode to another; 0 when either is off the cycle.
export const shiftTabs = (from: string, to: string) => {
  const [a, b] = [CYCLE.indexOf(from), CYCLE.indexOf(to)]
  return a < 0 || b < 0 ? 0 : (b - a + CYCLE.length) % CYCLE.length
}
