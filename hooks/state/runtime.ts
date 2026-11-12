// A command Claude left running in the background: its task id and command; how it ended, from
// the engine's task notification; the first error line its log showed; whether you looked at it.
export type BgTask = { id: string; command: string; at: number; status?: string; summary?: string; errorLine?: string; errorCount?: number; isScannedDone?: boolean; isSeen?: boolean; urls?: string[]; busyPort?: number }



export const ME = 'cc-mod-statusbar'

// What the mod keeps between events and draws, outside $.state: plain values its hooks set
// and read; one object, so every module reads and writes the same ones.
export const rt = {
  // when the usage endpoint last answered (features/usage.ts fetchUsage), for the usage menu
  usageFetchedAt: 0,
  // what Haiku proposes sending next after Claude's last answer (features/chips.ts), cleared when a
  // turn starts; and the round it answers, moved on by a turn, a chip sent or ✕
  answerChips: [] as string[],
  suggestRound: 0,
  // the main loop's running turn, as turn.start named it: what Stop on the phone ends
  turnId: '',
  // the tasks already completed when the running turn started: the phone leaves them out
  doneBefore: new Set<string>(),
  // The main loop's turn: when it began and ended, and the session's cost when it began.
  turnStartedAt: 0,
  turnEndedAt: 0,
  turnCostAt: null as number | null,
  isCountingCtx: false,
  // What the main loop ran this turn, one line a tool, for the summary.
  turnTools: [] as string[],
  turnPrompt: '',
  // The draft the prompt box held before Polish or Translate rewrote it, for "Put back".
  lastDraft: '',
  // The tool the main loop runs right now, as one short line; empty between tools.
  nowTool: '',
  // Set once WebFetch or WebSearch brought outside text in: secrets are then used for GET only.
  isTainted: false,
  // The mode the hint line showed last: a drawing may not write state, so the PromptHint
  // render keeps it here and the bar's next drawing reads it.
  hintMode: undefined as string | undefined,
  // The mode the bar drew last; a timer redraws the bar when the hint line shows another.
  drawnMode: undefined as string | undefined,
  // The hint line as last drawn: it reads "? for shortcuts" in the default mode and
  // "(shift+tab to cycle)" in the others.
  lastHint: '',
  // The mode as the permission checks give it now (probeMode), the bar's first source.
  probedMode: undefined as string | undefined,
  // The phone's half of Claude Code's own dialogs (remote/dialog-hook.mjs) runs in this session:
  // its SessionStart hook marked it. The hub then puts the dialogs on the phone, not the mod.
  isHooked: false,
  // The turn now running was the auto-continue's own "continue"
  isContinueTurn: false,
  continueTries: 0,
  // The subagents the "hi" schedule spawned: their notification of the end never reaches Claude
  // An open menu taller than its window under the pinned head: the first of its rows shown, its rows
  // as reckoned (lib/rows.ts) and the window's rows when it was drawn, for ui.scroll to move it
  menuOffset: 0,
  menuRows: 0,
  menuWindow: 0,
  // the row each Button of that menu starts on, for the focus ring to bring into the window
  menuKeyRows: new Map<string, number>(),
  // a menu drawn in its own pane (menuInPane), not in the band
  isMenuPaneOpen: false,
  // The guardrails' memory (events/guards.ts): the main loop's calls this turn, in order, for prove
  // done; whether this run of turns was asked to prove it once; what the person allowed for the
  // session (a folder outside the project, a host off the allowlist); the budget's toast and stop
  turnCalls: [] as { tool: string; command?: string; path?: string }[],
  isProveAsked: false,
  outsideAllowed: new Set<string>(),
  hostsAllowed: new Set<string>(),
  budgetWarned: false,
  budgetStopped: false,
  isBudgetTimer: false,
  // the shield menu's MCP access: the servers opened to list their tools
  mcpOpen: new Set<string>(),
  // the shield menu opened on its MCP access (from the mcp menu)
  guardSection: '' as '' | 'mcp',
  // The rule a first press armed; a second press within ARM_MS writes it.
  armedRule: '',
  armedAt: 0,
  isHot: false,
  // Every configured server's health, as `claude mcp list` checks it (about 12 s: it dials each).
  // The target is kept for a URL alone: a stdio server's command line may carry a key.
  isCheckingMcp: false,
  // The prompt's state as the band last drew it: a drawing may write module variables.
  isBusy: false,
  lingerUntil: 0,
  // What each agent ran, by its $.agent.list() id: when it began, its tools in order, its answer.
  agentLog: {} as Record<string, { startedAt: number; tools: string[]; answer?: string; endedAt?: number }>,
  // The commands Claude left running in the background, by their task id: their log is the
  // session's tasks/<id>.output.
  bgTasks: [] as BgTask[],
  // The tasks menu's row shown open (agent:<id> or bg:<id>), or none.
  openDetail: '',
  // The open log shows its error lines alone.
  isLogErrorsOnly: false,
  // The open log follows its command: the tasks menu redraws it every second, as tail -f.
  isLogFollow: false,
  // Each server's last health check, by port: the HTTP status (0: no answer) and when.
  serverHealth: {} as Record<number, { code: number; at: number }>,
  // Commits on the mod's own upstream that its folder lacks: the ↑ mod chip, from an hourly fetch.
  modBehind: 0,
  // The version this session loaded (see readModVersion), and whether ↑ mod has since pulled a
  // newer one into the folder, which /reload-plugins loads.
  modVersion: { version: '', commit: '', at: 0 },
  isModPulled: false,
}
