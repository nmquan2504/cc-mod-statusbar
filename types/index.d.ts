// The bar's readings: the model, the folder and its git branch (null outside a repository),
// the rate-limit windows (percent used), the permission mode.
export type BarState = {
  model: string
  // the effort the main loop's requests go out with, null until known
  effort: string | null
  folder: string
  branch: string | null
  // files git reports changed, commits to push, commits to pull
  dirty: number
  ahead: number
  behind: number
  five: number | null
  week: number | null
  mode: string
}

// The guardrails the merged settings put in force, as the shield menu shows them.
export type GuardInfo = {
  deny: string[]
  ask: number
  allow: number
  allowRules: string[]
  sandbox: boolean
  hooks: string[]
  plugins: number
}

// Which menu is open above the bar.
export type MenuKind = 'add' | 'files' | 'web' | 'commands' | 'model' | 'mode' | 'guard' | 'tasks' | 'usage' | 'mcp' | 'git' | 'settings' | 'effort' | 'images' | 'remote' | 'ask'

export type CommandRow = { name: string; description: string; group: string }
export type FileRow = { name: string; isDir: boolean }
// The usage reading the usage menu draws: every rate-limit window, the context window, the cost.
export type UsageInfo = {
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  tokens: number | null
  window: number
  ctxPercent: number | null
  costUsd: number | null
  startedAt: number
}

// One thing a guardrail did: when, what, and whether it blocked or masked something.
export type AuditRow = { at: number; line: string; isBlock: boolean }

// A file the main loop wrote this turn, with the lines its calls added and removed.
export type EditRow = { path: string; added: number; removed: number }

// One changed file as git status reports it: its path and its two-letter code (?? untracked).
export type ChangeRow = { path: string; code: string }

// The context window as /context breaks it down: categories, and the files, servers, agents,
// skills and commands in it, with their tokens.
export type CtxInfo = {
  at: number
  detail: 'summary' | 'full'
  model: string
  total: number
  max: number
  percent: number
  autoCompactAt: number | null
  categories: { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  // the grid /context draws, row by row: each square's category, color and how full it is
  grid: { name: string; color: string; isFilled: boolean; fullness: number }[][]
  memory: { path: string; type: string; tokens: number }[]
  mcp: { server: string; tools: number; tokens: number; loaded: number }[]
  agents: { name: string; source: string; tokens: number }[]
  skills: { shown: number; total: number; tokens: number } | null
  commands: { shown: number; total: number; tokens: number } | null
}

// One of Claude's tasks: status pending, in_progress or completed.
export type TaskRow = { id: string; subject: string; status: string }
// One agent running for the session, as $.agent.list() has it.
export type AgentRow = { id: string; description: string; type: string; status: string }
// A TCP port in LISTEN held by a process under this Claude Code process.
export type ServerRow = { pid: number; port: number; command: string }
// An MCP server connected now: its tool-name key (claude_ai_Gmail), the name /mcp shows, its
// tool count, and whether it shows only its sign-in tools.
export type McpRow = { key: string; name: string; tools: number; needsAuth: boolean }
// One line of `claude mcp list`: status connected, auth (needs sign-in) or failed.
export type McpCheckRow = { name: string; status: 'connected' | 'auth' | 'failed'; target: string; detail: string }
// An image pasted this session: its [Image #n], the file the engine saved it to, when, how big.
export type ImageRow = { n: number; path: string; at: number; bytes: number }
// A turn stopped on a rate limit, waiting to be continued: when "continue" goes in (the
// window's reset and a minute), which window, and how many times it was sent for this stop.
export type AutoContinue = { at: number; window: string; tries: number }
// One slot of the "hi" schedule: when it was due, and what came of it.
export type HiRow = { slot: number; status: 'sent' | 'busy' | 'missed' | 'failed' }
// A host the session reached out to: how often, how often blocked, through which tools.
export type EgressRow = { host: string; count: number; blocked: number; via: string[]; lastAt: number }

declare module 'claude-code' {
  interface PluginState {
    'cc-mod-statusbar': {
      bar: BarState
      guard: GuardInfo
      menu: MenuKind | null
      commands: CommandRow[]
      dir: string
      files: FileRow[]
      vault: string[]
      tasks: TaskRow[]
      agents: AgentRow[]
      servers: ServerRow[]
      egress: EgressRow[]
      mcpServers: McpRow[]
      mcpCheck: { at: number; rows: McpCheckRow[] } | null
      mcpCalls: { key: string; calls: number; errors: number }[]
      ctxBreakdown: CtxInfo | null
      lastTurn: { at: number; took: number; cost: number | null; prompt: string; did: string; result: string } | null
      usage: UsageInfo | null
      changes: ChangeRow[]
      audit: AuditRow[]
      dangers: number
      autoContinue: AutoContinue | null
      hiLog: HiRow[]
      edited: EditRow[]
      collapsed: string[]
      filter: string
      images: ImageRow[]
    }
  }
}
