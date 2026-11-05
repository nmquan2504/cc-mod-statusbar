import { atom, update } from 'claude-code'
import type { UsageInfo, CtxInfo } from '../../types'
import { WINDOW_NAMES, span } from '../lib/format'
import { cfg } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The full usage reading, for the usage menu the gauges open.
const usage = atom({ plugin: 'cc-mod-statusbar', key: 'usage' } as const, null)
// What the context window holds, as /context breaks it down, for the usage menu.
const ctxBreakdown = atom({ plugin: 'cc-mod-statusbar', key: 'ctxBreakdown' } as const, null)

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// The account's usage as /usage reads it: asked of Anthropic with the session's own credential (the
// engine sets it; the mod never sees it). It is no model request, so it costs nothing and starts no
// window. The 5-hour and weekly windows, each a utilization (0 to 100) and when it resets.
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const WINDOWS = ['five_hour', 'seven_day'] as const

// What the endpoint last answered, laid over the session's own figures (the last response's headers)
// while those stay as they were when it was asked: a newer response that moved them wins.
let fresh: { base: string; limits: Limit[] } | null = null
const keyOf = (limits: readonly Limit[]) => JSON.stringify(limits.map(r => [r.kind, Math.round(r.percentUsed)]))
export function liveLimits(limits: readonly Limit[]): Limit[] {
  if (fresh && keyOf(limits) === fresh.base) {
    const over = fresh.limits
    return [...over, ...limits.filter(r => !over.some(o => o.kind === r.kind))]
  }
  fresh = null
  return [...limits]
}

// Asks the endpoint now; true when it answered with a window. False off a subscription (an API key,
// a cloud provider: no windows to read), offline, or when the answer has no window.
export async function fetchUsage($: any): Promise<boolean> {
  const auth = await $.session.authorize().catch(() => null)
  if (auth?.kind !== 'bearer') return false
  const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } }).catch(() => undefined)
  if (!r?.ok) return false
  let body: any
  try {
    body = JSON.parse(r.text)
  } catch {
    return false
  }
  const limits: Limit[] = []
  for (const kind of WINDOWS) {
    const w = body?.[kind]
    if (typeof w?.utilization === 'number') limits.push({ kind, percentUsed: w.utilization, ...(typeof w.resets_at === 'string' ? { resetsAt: w.resets_at } : {}) })
  }
  if (!limits.length) return false
  const session = await $.session.usage().catch(() => undefined)
  fresh = { base: keyOf(session?.rateLimits ?? []), limits }
  rt.usageFetchedAt = Date.now()
  return true
}

// What $.session.usage() or session.measure carried, kept for the usage menu.
// Usage alerts: a toast once when a window first passes 80% and again at 90%; past 90% the
// bar's figure blinks. A window that resets drops back, so the next climb warns again.
// (cfg.usageAlertLow and cfg.usageAlertHigh.) The context window: a chip on the bar from
// cfg.ctxChipAt%, a toast once at cfg.ctxToastAt%.
export const alerted: Record<string, number> = {}

export function checkAlerts($: any, limits: { kind: string; percentUsed: number; resetsAt?: string }[]) {
  for (const r of limits) {
    const step = r.percentUsed >= cfg.usageAlertHigh ? cfg.usageAlertHigh : r.percentUsed >= cfg.usageAlertLow ? cfg.usageAlertLow : 0
    const was = alerted[r.kind] ?? 0
    alerted[r.kind] = step
    if (step <= was) continue
    const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
    const when = Number.isNaN(at) ? '' : `, resets in ${span(at - Date.now())}`
    $.ui.toast(`statusbar: ${WINDOW_NAMES[r.kind] ?? r.kind} limit at ${Math.round(r.percentUsed)}%${when}`)
  }
}

export async function keepUsage($: any, u: any, startedAt?: number) {
  if (!u) return
  const limits = liveLimits(u.rateLimits ?? [])
  checkAlerts($, limits)
  const fill = u.context?.percent
  if (typeof fill === 'number') {
    const was = alerted.context ?? 0
    alerted.context = fill >= cfg.ctxToastAt ? cfg.ctxToastAt : 0
    if (alerted.context > was) $.ui.toast(`statusbar: context at ${Math.round(fill)}%; /compact frees room (the ctx chip opens it)`)
  }
  const info: UsageInfo = {
    rateLimits: limits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    tokens: u.context?.tokens ?? null,
    window: u.context?.window ?? 0,
    ctxPercent: u.context?.percent ?? null,
    costUsd: u.cost?.usd ?? null,
    startedAt: startedAt ?? u.startedAt ?? 0,
  }
  await update($, usage, () => info)
}

// The context window by category. 'summary' estimates here and sends nothing; 'full' counts
// exactly, one token-count request per tool and memory file, as /context does.
export async function readBreakdown($: any, detail: 'summary' | 'full') {
  if (detail === 'full') {
    rt.isCountingCtx = true
    $.ui.invalidate('ui.render')
  }
  try {
    const u = await $.session.usage({ breakdown: detail, columns: 80 }).catch(() => undefined)
    const b = u?.context?.breakdown
    if (!b) return
    const servers = new Map<string, { tools: number; tokens: number; loaded: number }>()
    for (const t of b.mcpTools ?? []) {
      const was = servers.get(t.serverName) ?? { tools: 0, tokens: 0, loaded: 0 }
      servers.set(t.serverName, { tools: was.tools + 1, tokens: was.tokens + t.tokens, loaded: was.loaded + (t.isLoaded ? 1 : 0) })
    }
    const info: CtxInfo = {
      at: Date.now(),
      detail,
      model: b.model,
      total: b.totalTokens,
      max: b.rawMaxTokens,
      percent: b.percentage,
      autoCompactAt: b.isAutoCompactEnabled ? b.autoCompactThreshold ?? null : null,
      categories: b.categories.map((c: any) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
      grid: (b.gridRows ?? []).map((row: any[]) => row.map(q => ({ name: q.categoryName, color: q.color, isFilled: q.isFilled, fullness: q.squareFullness }))),
      memory: (b.memoryFiles ?? []).map((f: any) => ({ path: f.path, type: f.type, tokens: f.tokens })),
      mcp: [...servers].map(([server, v]) => ({ server, ...v })).sort((p, q) => q.tokens - p.tokens),
      agents: (b.agents ?? []).map((a: any) => ({ name: a.agentType, source: a.source, tokens: a.tokens })),
      skills: b.skills ? { shown: b.skills.includedSkills, total: b.skills.totalSkills, tokens: b.skills.tokens } : null,
      commands: b.slashCommands ? { shown: b.slashCommands.includedCommands, total: b.slashCommands.totalCommands, tokens: b.slashCommands.tokens } : null,
    }
    await update($, ctxBreakdown, () => info)
  } finally {
    rt.isCountingCtx = false
    $.ui.invalidate('ui.render')
  }
}
