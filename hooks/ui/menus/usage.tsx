import { atom, read } from 'claude-code'
import { closeMenu } from '../../features/menu'
import { readBreakdown } from '../../features/usage'

import { WINDOW_NAMES, hhmm, kTok, level, meter, oneLine, pct, span, thousands } from '../../lib/format'
import { gauge } from '../../lib/graphics'
import { cfg } from '../../state/config'
import { rt } from '../../state/runtime'
import { drawAutomation } from './automation'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The full usage reading, for the usage menu the gauges open.
const usage = atom({ plugin: 'cc-mod-statusbar', key: 'usage' } as const, null)
// What the context window holds, as /context breaks it down, for the usage menu.
const ctxBreakdown = atom({ plugin: 'cc-mod-statusbar', key: 'ctxBreakdown' } as const, null)

// The usage menu.
export async function drawUsageMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const u = await read($, usage)
  const ctx = await read($, ctxBreakdown)
  const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
  const cwd: string = await $.session.cwd().catch(() => '')
  const rel = (path: string) => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)
  const { Raster } = els
  const now = Date.now()
  const gaugeOf = (key: string, n: number | null) =>
    isTerminal && Raster
      ? <Raster key={`ug-${key}`} columns={20} rows={1} cells={gauge(n, 20)} />
      : <Text color={level(n)}>{meter(n, 20)}</Text>
  const automation = await drawAutomation($, els)
  if (!u) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No reading yet: the figures come with the first API response.</Text>
        {automation}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text color="claude" bold>◆ Rate limits</Text>
      {u.rateLimits.length === 0 && <Text dimColor>  none reported: off a subscription, or no API response yet</Text>}
      {u.rateLimits.map(r => {
        const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
        const when = Number.isNaN(at)
          ? ''
          : `resets in ${span(at - now)} (${new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`
        return (
          <Box key={`rl-${r.kind}`} flexDirection="row" gap={1}>
            <Text>{`  ${(WINDOW_NAMES[r.kind] ?? r.kind).padEnd(11)}`}</Text>
            {gaugeOf(r.kind, r.percentUsed)}
            <Text color={level(r.percentUsed)} bold>{pct(r.percentUsed).padStart(4)}</Text>
            <Text dimColor>{`  ${when}`}</Text>
          </Box>
        )
      })}
      {automation}
      <Text color="subtle" bold>{'\n'}◇ This session</Text>
      <Box flexDirection="row" gap={1}>
        <Text>{'  context    '}</Text>
        {gaugeOf('ctx', u.ctxPercent)}
        <Text color={level(u.ctxPercent)} bold>{pct(u.ctxPercent).padStart(4)}</Text>
        <Text dimColor>{u.tokens === null ? '  no response yet' : `  ${thousands(u.tokens)} of ${thousands(u.window)} tokens`}</Text>
      </Box>
      <Text>
        <Text>{'  cost       '}</Text>
        <Text bold>{u.costUsd === null ? '–' : `$${u.costUsd.toFixed(2)}`}</Text>
        <Text dimColor>  as /cost totals it</Text>
      </Text>
      <Text>
        <Text>{'  running    '}</Text>
        <Text bold>{u.startedAt ? span(now - u.startedAt) : '–'}</Text>
      </Text>
      {ctx ? (
        <Box key="ctx-detail" flexDirection="column">
          <Text>
            {'\n'}<Text color="subtle" bold>◇ Context window</Text>
            <Text dimColor>{`  ${kTok(ctx.total)} of ${kTok(ctx.max)} tokens (${Math.round(ctx.percent)}%)`
              + `${ctx.autoCompactAt ? `, compacts at ${kTok(ctx.autoCompactAt)}` : ', auto-compact off'}`
              + ` · ${ctx.detail === 'full' ? 'counted' : 'estimated'} ${hhmm(ctx.at)}`}</Text>
          </Text>
          {/* the heat map /context draws: a square of two cells per 1% (0.5% past a million),
              in its category's color; filled at 70% and over, ░ under it, ⋅ for free space */}
          <Box key="ctx-map" flexDirection="row" gap={3} marginLeft={2}>
            <Box flexDirection="column">
              {ctx.grid.map((row, y) => (
                <Text key={`grid-${y}`}>
                  {row.map((q, x) => {
                    const isFree = q.name === 'Free space'
                    const isFull = q.isFilled && q.fullness >= 0.7
                    return isFull
                      ? <Text key={`sq-${x}`} backgroundColor={q.color}>{'  '}</Text>
                      : <Text key={`sq-${x}`} color={isFree ? 'inactive' : q.color}>{isFree || !q.isFilled ? '⋅ ' : '░░'}</Text>
                  })}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column">
              {ctx.categories.filter(c => c.kind !== 'deferred').map(c => {
                const share = ctx.max ? (c.tokens / ctx.max) * 100 : 0
                return (
                  <Text key={`cat:${c.name}`}>
                    {c.kind === 'free' ? <Text color="inactive">{'⋅ '}</Text> : <Text backgroundColor={c.color}>{'  '}</Text>}
                    {` ${oneLine(c.name, 22).padEnd(22)}`}
                    <Text bold>{kTok(c.tokens).padStart(5)}</Text>
                    <Text dimColor>{` ${share.toFixed(1).padStart(5)}%`}</Text>
                  </Text>
                )
              })}
            </Box>
          </Box>
          {ctx.categories.filter(c => c.kind === 'deferred').map(c => (
            <Text key={`cat:${c.name}`} dimColor>{`  ${oneLine(c.name, 22).padEnd(22)} ${kTok(c.tokens)} loaded on demand, outside the window`}</Text>
          ))}
          {ctx.memory.length ? <Text bold>{'  Memory files'}</Text> : null}
          {ctx.memory.slice(0, 8).map(f => (
            <Text key={`mem:${f.path}`}>
              {'    '}<Text>{oneLine(rel(f.path), 70)}</Text><Text dimColor>{`  ${f.type} · ${kTok(f.tokens)}`}</Text>
            </Text>
          ))}
          {ctx.mcp.length ? <Text bold>{'  MCP tools by server'}</Text> : null}
          {ctx.mcp.slice(0, 8).map(m => (
            <Text key={`ctxmcp:${m.server}`}>
              {'    '}<Text>{oneLine(m.server, 40).padEnd(30)}</Text>
              <Text dimColor>{`${String(m.tools).padStart(3)} tools · ${m.loaded} loaded · ${kTok(m.tokens)}`}</Text>
            </Text>
          ))}
          {ctx.mcp.length > 8 ? <Text dimColor>{`    and ${ctx.mcp.length - 8} more servers`}</Text> : null}
          {ctx.agents.length ? (
            <Text>
              <Text bold>{'  Agents'}</Text>
              <Text dimColor>{`  ${ctx.agents.length}, ${kTok(ctx.agents.reduce((n, a) => n + a.tokens, 0))}: ${oneLine(ctx.agents.map(a => a.name).join(', '), 80)}`}</Text>
            </Text>
          ) : null}
          {ctx.skills ? (
            <Text>
              <Text bold>{'  Skills'}</Text>
              <Text dimColor>{`  ${ctx.skills.shown} of ${ctx.skills.total} listed, ${kTok(ctx.skills.tokens)}`}</Text>
            </Text>
          ) : null}
          {ctx.commands ? (
            <Text>
              <Text bold>{'  Slash commands'}</Text>
              <Text dimColor>{`  ${ctx.commands.shown} of ${ctx.commands.total} listed, ${kTok(ctx.commands.tokens)}`}</Text>
            </Text>
          ) : null}
          {/* the actions, a line below the breakdown */}
          <Box key="row:ctx-count" marginTop={1}>
            <Button key="ctx:count" plain hotkey="x" onPress={() => readBreakdown($, 'full')}>
              <Text color="claude">{rt.isCountingCtx ? '… counting every tool and memory file' : '→ Count it exactly (sends token-count requests, as /context does)'}</Text>
            </Button>
          </Box>
        </Box>
      ) : null}
      <Button key="compact" plain hotkey="c" onPress={async () => {
        await closeMenu($)
        await $.command.run({ command: 'compact' })
      }}>
        <Text color="claude">→ Compact the conversation now (/compact)</Text>
        {u.ctxPercent !== null && u.ctxPercent >= cfg.ctxChipAt ? <Text color="warning">{`  context at ${Math.round(u.ctxPercent)}%`}</Text> : ''}
      </Button>
    </Box>
  )
}
