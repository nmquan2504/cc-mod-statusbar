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
  checkAlerts($, u.rateLimits ?? [])
  const fill = u.context?.percent
  if (typeof fill === 'number') {
    const was = alerted.context ?? 0
    alerted.context = fill >= cfg.ctxToastAt ? cfg.ctxToastAt : 0
    if (alerted.context > was) $.ui.toast(`statusbar: context at ${Math.round(fill)}%; /compact frees room (the ctx chip opens it)`)
  }
  const info: UsageInfo = {
    rateLimits: (u.rateLimits ?? []).map((r: any) => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
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
