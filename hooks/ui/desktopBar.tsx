import { closeMenu, openMenu } from '../features/menu'
import { updateNow } from '../features/update'
import { dismissChips, sendChip } from '../features/chips'
import { TITLES } from '../lib/catalog'
import { level, meter, oneLine, pct, shortModel } from '../lib/format'
import { cfg } from '../state/config'
import type { CfgKey } from '../state/config'
import type { MenuKind } from '../../types'

// What the bar shows, worked out once by drawBand for every surface.
export type BarData = {
  open: MenuKind | null
  menuTree: unknown
  chips: string[]
  model: string
  modelColor: string
  effort: string | null
  effortColor: string
  folder: string
  branch: string | null
  gitMarks: string
  isGitJoined: boolean
  five: number | null
  week: number | null
  ctx: number | null
  isCtxShown: boolean
  isGuardAlert: boolean
  guardCoreOff: number
  dangers: number
  mcpLive: number
  mcpFailed: number
  images: number
  remoteText: string
  remoteColor: string
  broken: { count: number; press: () => Promise<void> } | null
  continueAt: string
  isModBehind: boolean
  turnText: string
  isBusy: boolean
  running: number
  // Claude's task list for this run of work: how many are done of how many; null with none
  tasks: { done: number; of: number } | null
  order: CfgKey[]
  split: number
}

// The bar for a surface that draws native buttons (Claude Code Desktop). Every item is a plain
// button, drawn as text with no chrome: a character for its icon and a few words, none of the
// terminal's filled pills; no frame of its own (the host draws one) and no arcade. The desktop
// draws a button's text in one color, so a chip whose state has a color is its icon as a Button
// with the figure beside it as colored Text: a press on the icon opens the menu.
export function desktopBar($: any, els: any, d: BarData) {
  const { Box, Button, Text } = els
  const go = (kind: MenuKind) => () => openMenu($, kind)
  const meterText = (n: number | null) => ` ${cfg.usageGauge ? `${meter(n, 4)} ` : ''}${pct(n)}`
  // a Button for the icon, then the figures as Text, each in its color (none: the text's own)
  const chip = (key: string, onPress: () => unknown, label: string, parts: [string, string?][]) => (
    <Box key={`chipbox:${key}`} flexDirection="row" alignItems="center">
      <Button key={key} plain onPress={onPress}>{label}</Button>
      {parts.filter(([t]) => t).map(([t, color], i) => <Text key={`${key}:${i}`} color={color} bold={Boolean(color)}>{t}</Text>)}
    </Box>
  )

  // The model and the effort stay off unless Settings asks for them: Desktop shows its own.
  const itemOf = (key: CfgKey) => {
    switch (key) {
      case 'barModel':
        return cfg.barModel && cfg.desktopSessionItems ? (
          <Button key="model" plain onPress={go('model')}>{`✦ ${shortModel(d.model)}`}</Button>
        ) : null
      case 'barEffort':
        return cfg.barEffort && cfg.desktopSessionItems && d.effort ? (
          <Button key="effort" plain onPress={go('effort')}>{`◔ ${d.effort}`}</Button>
        ) : null
      case 'barFolder':
        return cfg.barFolder ? (
          <Button key={d.isGitJoined ? 'git' : 'folder'} plain onPress={go('git')}>
            {`▤ ${oneLine(d.folder, 32)}`}
            {d.isGitJoined && d.branch ? `  ⎇ ${oneLine(d.branch, 32)}` : ''}
            {d.isGitJoined && d.branch && d.gitMarks ? ` ${d.gitMarks}` : ''}
          </Button>
        ) : null
      case 'barGit':
        return !d.isGitJoined && cfg.barGit && d.branch ? (
          <Button key="git" plain onPress={go('git')}>{`⎇ ${oneLine(d.branch, 32)}${d.gitMarks ? ` ${d.gitMarks}` : ''}`}</Button>
        ) : null
      case 'barUsage':
        return cfg.barUsage ? (
          <Box key="usagebox" flexDirection="row" alignItems="center" gap={2}>
            {d.isCtxShown ? chip('ctx', go('usage'), 'ctx', [[` ${pct(d.ctx)}`, d.ctx !== null && d.ctx >= cfg.ctxToastAt ? 'error' : 'warning']]) : null}
            {chip('usage', go('usage'), '5h', [[meterText(d.five), level(d.five)]])}
            {chip('usage:wk', go('usage'), 'wk', [[meterText(d.week), level(d.week)]])}
          </Box>
        ) : null
      case 'barRemote':
        return cfg.selfRemote && cfg.barRemote ? (
          chip('remote', go('remote'), '⇄', [[d.remoteText.replace(/^⇄/, ''), d.remoteColor]])
        ) : null
      case 'barMcp':
        return cfg.barMcp ? (
          chip('mcp', go('mcp'), '⌁', [[` ${d.mcpLive}`], [d.mcpFailed ? ` ✘ ${d.mcpFailed}` : '', 'error']])
        ) : null
      case 'barImages':
        return cfg.barImages && d.images ? (
          <Button key="images" plain onPress={go('images')}>{`▣ ${d.images}`}</Button>
        ) : null
      case 'barGuard':
        return cfg.barGuard ? (
          chip('guard', go('guard'), '◈', [
            d.isGuardAlert ? [` ${d.guardCoreOff}`, 'error'] : [' ✓', 'success'],
            [d.dangers ? `  ⚠ ${d.dangers}` : '', 'warning'],
          ])
        ) : null
      default:
        return null
    }
  }

  // ☰ 2/5: Claude's tasks done of all, in Claude's color while a turn runs
  const tasks = chip('claude', go('tasks'), '☰', [
    [d.tasks ? ` ${d.tasks.done}/${d.tasks.of}` : ' 0', d.isBusy ? 'claude' : undefined],
    [d.running ? ` · ${d.running} running` : '', 'suggestion'],
    [d.turnText ? `  ◷ ${d.turnText}` : '', 'claude'],
  ])

  return (
    <Box flexDirection="column" gap={1}>
      {/* the menu's title and ✕ on top, the menu under them, then the bar */}
      {d.open !== null ? (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text color="claude" bold>{TITLES[d.open]}</Text>
            <Button key="close-menu" plain onPress={() => closeMenu($)}>✕</Button>
          </Box>
          {d.menuTree as any}
        </Box>
      ) : null}
      {d.open === null && d.chips.length ? (
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {d.chips.map((c, i) => (
            <Button key={`chip:${i}`} onPress={() => sendChip($, c)}>{oneLine(c, 60)}</Button>
          ))}
          {/* the ✕ alone, as on the terminal: a label or role="dismiss" makes the desktop draw words */}
          <Button key="chips-dismiss" plain onPress={() => dismissChips($)}>✕</Button>
        </Box>
      ) : null}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          <Button key="add" plain onPress={go('add')}>✻</Button>
          {d.order.slice(0, d.split).map(itemOf)}
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          {tasks}
          {d.broken ? (
            chip('bgerr', d.broken.press, '✘', [[` ${d.broken.count}`, 'error']])
          ) : null}
          {d.continueAt ? (
            <Button key="continue" plain onPress={go('usage')}>{`⏵ ${d.continueAt}`}</Button>
          ) : null}
          {d.isModBehind ? (
            <Button key="update" variant="primary" onPress={() => updateNow($)}>↑ Update mod</Button>
          ) : null}
          {d.order.slice(d.split + 1).map(itemOf)}
        </Box>
      </Box>
    </Box>
  )
}
