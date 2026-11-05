import { closeMenu, openMenu } from '../features/menu'
import { updateNow } from '../features/update'
import { dismissChips, sendChip } from '../features/chips'
import { TITLES } from '../lib/catalog'
import { meter, oneLine, pct, shortModel } from '../lib/format'
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
  mode: string
  modeColor: string
  folder: string
  branch: string | null
  gitMarks: string
  isGitJoined: boolean
  five: number | null
  week: number | null
  ctx: number | null
  isCtxShown: boolean
  guardOk: number
  guardOf: number
  isGuardAlert: boolean
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
  order: CfgKey[]
  split: number
}

// The bar for a surface that draws native buttons (Claude Code Desktop). Every item is a plain
// button, drawn as text with no chrome: a character for its icon and a few words, none of the
// terminal's filled pills; no frame of its own (the host draws one) and no arcade. The desktop
// draws a button's text in one color, so a state shows in its character (✓, !, ✘).
export function desktopBar($: any, els: any, d: BarData) {
  const { Box, Button, Text } = els
  const go = (kind: MenuKind) => () => openMenu($, kind)
  const meterText = (label: string, n: number | null) => `${label} ${cfg.usageGauge ? `${meter(n, 4)} ` : ''}${pct(n)}`

  // The model, the effort and the mode stay off unless Settings asks for them: Desktop shows its own.
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
      case 'barMode':
        return cfg.barMode && cfg.desktopSessionItems ? (
          <Button key="mode" plain onPress={go('mode')}>{`⏵ ${d.mode}`}</Button>
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
          <Button key="usage" plain onPress={go('usage')}>
            {d.isCtxShown ? `ctx ${pct(d.ctx)}${d.ctx !== null && d.ctx >= cfg.ctxToastAt ? ' !' : ''}   ` : ''}
            {`${meterText('5h', d.five)}   ${meterText('wk', d.week)}`}
          </Button>
        ) : null
      case 'barRemote':
        return cfg.selfRemote && cfg.barRemote ? (
          <Button key="remote" plain onPress={go('remote')}>{d.remoteText}</Button>
        ) : null
      case 'barMcp':
        return cfg.barMcp ? (
          <Button key="mcp" plain onPress={go('mcp')}>{`⌁ ${d.mcpLive}${d.mcpFailed ? ` ✘ ${d.mcpFailed}` : ''}`}</Button>
        ) : null
      case 'barImages':
        return cfg.barImages && d.images ? (
          <Button key="images" plain onPress={go('images')}>{`▣ ${d.images}`}</Button>
        ) : null
      case 'barGuard':
        return cfg.barGuard ? (
          <Button key="guard" plain onPress={go('guard')}>
            {d.isGuardAlert ? `◈ ! ${d.guardOk}/${d.guardOf}` : d.guardOk < d.guardOf ? `◈ ${d.guardOk}/${d.guardOf}` : '◈ ✓'}
            {d.dangers ? `  ⚠ ${d.dangers}` : ''}
          </Button>
        ) : null
      default:
        return null
    }
  }

  const tasks = (
    <Button key="claude" plain onPress={go('tasks')}>
      {d.turnText ? `◷ ${d.turnText}` : '☰ Tasks'}
      {d.running ? ` · ${d.running}` : ''}
    </Button>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {d.open !== null ? (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text color="claude" bold>{TITLES[d.open]}</Text>
            <Button key="close-menu" role="dismiss" label="Close" onPress={() => closeMenu($)} />
          </Box>
          {d.menuTree as any}
        </Box>
      ) : null}
      {d.open === null && d.chips.length ? (
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {d.chips.map((c, i) => (
            <Button key={`chip:${i}`} onPress={() => sendChip($, c)}>{oneLine(c, 60)}</Button>
          ))}
          <Button key="chips-dismiss" role="dismiss" label="Dismiss suggestions" onPress={() => dismissChips($)} />
        </Box>
      ) : null}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          <Button key="add" plain onPress={go('add')}>+</Button>
          <Button key="commands" plain onPress={go('commands')}>/</Button>
          {d.order.slice(0, d.split).map(itemOf)}
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          {tasks}
          {d.broken ? (
            <Button key="bgerr" plain onPress={d.broken.press}>{`✘ ${d.broken.count}`}</Button>
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
