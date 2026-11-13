import { failedTasks } from '../features/work'
import { atom, read } from 'claude-code'
import type { MenuKind } from '../../types'
import { ARENA_GAP, ARENA_MIN, arena, arenaRuns, endRound, resetArena } from '../features/arena'
import { closeMenu, openMenu } from '../features/menu'
import { isRemoteWaiting, pendingPairs, remote, secondsToPair, spinnerFrame } from '../features/remote'
import { updateNow } from '../features/update'
import { TITLES, effortColor, effortIcon, modeStyle, modelStyle } from '../lib/catalog'
import { clockOf, level, meter, oneLine, pct, shortModel } from '../lib/format'
import { GAUGE_CELLS, TRACK, gaugeColors, hex, inGauge } from '../lib/graphics'
import { vnClock } from '../lib/schedule'
import { barOrder, cfg } from '../state/config'
import type { CfgKey } from '../state/config'
import { rt } from '../state/runtime'
import { drawMenu } from './menus/index'
import { guardScore as scoreGuards } from '../features/guardrails'
import { keyRows, rowsOf } from '../lib/rows'
import { desktopBar } from './desktopBar'
import { chipsNow, dismissChips, sendChip } from '../features/chips'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
const menu = atom({ plugin: 'cc-mod-statusbar', key: 'menu' } as const, null)
const guard = atom({ plugin: 'cc-mod-statusbar', key: 'guard' } as const, {
  deny: [], ask: 0, allow: 0, allowRules: [], sandbox: false, hooks: [], plugins: 0,
})
const agents = atom({ plugin: 'cc-mod-statusbar', key: 'agents' } as const, [])
const servers = atom({ plugin: 'cc-mod-statusbar', key: 'servers' } as const, [])
// The MCP servers: those connected, from the tool list; every configured one with its health,
// from the last `claude mcp list`; and each server's calls this session.
const mcpServers = atom({ plugin: 'cc-mod-statusbar', key: 'mcpServers' } as const, [])
const mcpCheck = atom({ plugin: 'cc-mod-statusbar', key: 'mcpCheck' } as const, null)
// The images pasted this session, for the images menu, and the prompt each came with.
const images = atom({ plugin: 'cc-mod-statusbar', key: 'images' } as const, [])
// The dangerous commands caught this session, for the ⚠ n chip beside the shield.
const dangers = atom({ plugin: 'cc-mod-statusbar', key: 'dangers' } as const, 0)
// A turn the rate limit stopped, waiting for its window to reset; and the "hi" schedule's last slots.
const autoContinue = atom({ plugin: 'cc-mod-statusbar', key: 'autoContinue' } as const, null)
// The full usage reading, for the usage menu the gauges open.
const usage = atom({ plugin: 'cc-mod-statusbar', key: 'usage' } as const, null)

// The bar's items a row too narrow for the compact bar gives up first, one at a time: the model, the
// mode, the folder, the usage and the shield stay
const DROP_ORDER: CfgKey[] = ['barImages', 'barMcp', 'barRemote', 'barEffort', 'barGit']

// The band above the prompt: the bar, and the menu open above it.
export async function drawBand($: any, e: any, next: any) {
  // Claude Code for VS Code draws its panel its own way (every button a bright native one): the bar
  // stays out of it. The hooks still run there: the guardrails, the vault, the automation.
  if (e.surface === 'vscode') return next(e)
  if (e.props.hasSurvey) return next(e)
  // the arcade plays while a turn runs; when the prompt goes idle Claude stays a while, then it clears
  if (e.props.isWorking !== rt.isBusy) {
    rt.isBusy = e.props.isWorking
    if (rt.isBusy) {
      rt.lingerUntil = 0
      resetArena()
    } else endRound()
  }
  const els = $.ui.resolve(e)
  const { Box, Button, Text } = els
  // Rasters paint on the terminal; elsewhere the ▰▱ text stands in.
  const Raster = e.surface === 'terminal' && 'Raster' in els ? els.Raster : undefined
  const open = await read($, menu)
  const b = await read($, bar)
  rt.drawnMode = rt.probedMode ?? rt.hintMode ?? b.mode
  const m = modeStyle(rt.drawnMode)
  const ms = modelStyle(b.model)
  const g = await read($, guard)
  // the guardrails on, of them all; red while a core one is off (features/guardrails.ts)
  const score = scoreGuards(g, rt.drawnMode)
  const checks = { length: score.of }
  const ok = score.ok
  const isAlert = score.isAlert

  // A square button: the label on a full cell of `bg` (no glyph caps, so it fills the row
  // at any line height); the one whose menu is open is drawn inverted.
  const pill = (key: MenuKind, label: string, bg: string, fg = 'inverseText') => (
    <Text backgroundColor={open === key ? fg : bg} color={open === key ? bg : fg} bold>{label}</Text>
  )
  // On the terminal the gauge is spaces on raw truecolor backgrounds: Text, so it fits in the
  // usage Button (a Button holds Text only, never a Raster).
  rt.isHot = Math.max(b.five ?? 0, b.week ?? 0) >= cfg.usageAlertHigh
  // past 90% the figure blinks once a second, red on its own color and back
  const isBlinkOn = (n: number | null) => n !== null && n >= cfg.usageAlertHigh && Math.floor(Date.now() / 1000) % 2 === 0
  const pctOf = (n: number | null) =>
    isBlinkOn(n)
      ? <Text backgroundColor="error" color="inverseText" bold>{` ${pct(n)}`}</Text>
      : <Text color={level(n)} bold>{` ${pct(n)}`}</Text>
  const meterOf = (key: string, label: string, n: number | null) =>
    !showGauge ? (
      <Text key={`meter-${key}`}>
        <Text dimColor>{label}</Text>
        {pctOf(n)}
      </Text>
    ) : Raster ? (
      <Text key={`meter-${key}`}>
        <Text dimColor>{label}</Text>
        {' '}
        {/* the figure inside the gauge, centred: each of its cells on the gauge's color there,
            dark on the fill, light on the track; past the alert the whole gauge blinks red */}
        {[...inGauge(n)].map((ch, i) => {
          const bg = gaugeColors(n, GAUGE_CELLS)[i]!
          const isBlink = isBlinkOn(n)
          return (
            <Text key={`gauge-${key}-${i}`} backgroundColor={isBlink ? 'error' : hex(bg)} color={isBlink || bg === TRACK ? '#e5e7eb' : '#111827'} bold>{ch}</Text>
          )
        })}
      </Text>
    ) : (
      <Text key={`meter-${key}`}>
        <Text dimColor>{`${label} `}</Text>
        <Text color={level(n)}>{meter(n, 4)}</Text>
        {pctOf(n)}
      </Text>
    )

  // The gap between the groups, in cells: every glyph on the bar is one cell wide.
  // the folder as /name: the slash and the name, no space between
  const folderMarkCells = 1
  // ⎇ branch, ✎ files changed, ⇡ commits to push, ⇣ commits to pull
  const gitMarks = !cfg.gitMarks ? '' : [b.dirty ? `✎${b.dirty}` : '', b.ahead ? `⇡${b.ahead}` : '', b.behind ? `⇣${b.behind}` : ''].filter(Boolean).join(' ')
  // ◈ 2/3, then ⚠n once a dangerous command was caught this session: one chip, one menu
  const dangerCount = await read($, dangers)
  // the ⚠n part: yellow text on the shield's own background (inverted with it while its menu is open)
  // ◈ alone while the core guardrails are on (project and home secrets denied, a mode that asks);
  // ◈ 7/16, red, while one of them is off: the guardrails on, of them all
  const guardScore = isAlert ? ` ◈ ${ok}/${checks.length} ` : ' ◈ '
  const guardDanger = dangerCount ? `⚠${dangerCount} ` : ''
  const guardLabel = !cfg.barGuard ? '' : guardScore + guardDanger
  // ⌁ n: the MCP servers connected; red when the last check found one that failed
  const liveMcp = (await read($, mcpServers)).filter(r => !r.needsAuth).length
  const mcpFailed = ((await read($, mcpCheck))?.rows ?? []).filter(r => r.status === 'failed').length
  const mcpLabel = !cfg.barMcp ? '' : ` ⌁ ${liveMcp}${mcpFailed ? ` ✘${mcpFailed}` : ''} `
  // ▣ n: the images pasted this session, shown from the first one; a press lists them
  // ⏵ 14:20: a "continue" waits for a rate-limit window to reset
  const waiting = await read($, autoContinue)
  const continueLabel = waiting ? ` ⏵ ${vnClock(waiting.at)} ` : ''
  // ✘ 2: the background commands that failed or logged an error; a press opens the newest one's log
  // and marks them all seen
  const brokenAll = failedTasks()
  const broken = brokenAll.at(-1)
  const brokenLabel = broken ? ` ✘ ${brokenAll.length} ` : ''
  const openBroken = async () => {
    for (const t of brokenAll) t.isSeen = true
    rt.openDetail = `bg:${broken!.id}`
    await openMenu($, 'tasks')
  }
  // ↑ mod: the mod's own repository has new commits upstream; a press pulls them and reloads
  const updateLabel = rt.modBehind ? ' ↑ mod ' : ''
  // ⇄: Self remote, with the setting on; ⇄ 2 while two phones watch, ⇄ ? while one asks to pair
  // the remote menu shut after showing its QR code: the next opening keeps it hidden (q shows it)
  if (open !== 'remote' && remote.isQrSeen) {
    remote.isQrSeen = false
    remote.isQrShown = false
  }
  const rs = remote.status
  // while the hub starts or the tunnel waits for its address, the chip turns a spinner: ⇄ ✻
  const pairs = pendingPairs()
  const remoteLabel = !cfg.selfRemote || !cfg.barRemote ? '' : pairs.length ? ` ⇄ ? ${secondsToPair(pairs[0]!)}s ` : isRemoteWaiting() ? ` ⇄ ${spinnerFrame()} ` : rs?.phones ? ` ⇄ ${rs.phones} ` : ' ⇄ '
  const remoteColor = pairs.length ? 'warning' : isRemoteWaiting() ? 'claude' : rs?.url ? 'success' : 'subtle'
  const imageCount = (await read($, images)).length
  const imagesLabel = cfg.barImages && imageCount ? ` ▣ ${imageCount} ` : ''
  // The items in the order Settings set: those before the arena make the left group, the rest the
  // right. The folder and the branch share one button while nothing shown stands between them.
  const order = barOrder()
  const split = order.indexOf('arcade')
  const shownOrder = order.filter(k => k === 'arcade' || cfg[k])
  const isGitJoined = cfg.barFolder && shownOrder.indexOf('barGit') === shownOrder.indexOf('barFolder') + 1
  // The bar's labels and the cells its two groups take, full or compact. Compact, on a terminal
  // too narrow for the full bar and the arena: the model as O5.5, the mode as its icon, the
  // effort as its first letter, a shorter folder and branch, and the figures without gauges.
  // Two levels past compact, for a terminal where even the compact bar overran the frame: tight cuts
  // the folder and the branch to 8 and drops the git marks; then the items least needed go one by
  // one (DROP_ORDER), each still a press away in its menu. `dropped` holds those gone.
  const dropped = new Set<string>()
  const layout = (isCompact: boolean, isTight = false) => {
    const name = shortModel(b.model)
    const cut = isTight ? 8 : isCompact ? 14 : 28
    // each part is '' when its switch is off
    const folderText = cfg.barFolder ? oneLine(b.folder, cut) : ''
    const branchText = cfg.barGit && !dropped.has('barGit') && b.branch ? `⎇ ${oneLine(b.branch, isTight ? 8 : isCompact ? 14 : 32)}` : ''
    const marksText = cfg.barGit && !dropped.has('barGit') && !isTight && gitMarks ? ` ${gitMarks}` : ''
    const modelLabel = !cfg.barModel ? '' : isCompact ? ` ● ${name.charAt(0)}${name.split(' ')[1] ?? ''} ` : ` ● ${name} `
    const modeLabel = !cfg.barMode ? '' : isCompact ? ` ${m.icon} ` : ` ${m.icon} ${m.label.split(' (')[0]} `
    const effortLabel = !cfg.barEffort || !b.effort ? '' : isCompact ? ` ${effortIcon(b.effort)} ${b.effort.charAt(0)} ` : ` ${effortIcon(b.effort)} ${b.effort} `
    const showGauge = cfg.usageGauge && !isCompact
    const meterWidth = (label: string, n: number | null) => label.length + (showGauge && Raster ? 1 + GAUGE_CELLS : (showGauge ? 1 + 4 : 0) + 1 + pct(n).length)
    // each item's cells, 0 when it draws nothing
    const width: Record<string, number> = {
      barModel: modelLabel.length,
      barEffort: effortLabel.length,
      barFolder: !cfg.barFolder ? 0 : folderMarkCells + folderText.length + (isGitJoined ? (branchText ? 1 + branchText.length : 0) + marksText.length : 0),
      barGit: isGitJoined || !branchText ? 0 : branchText.length + marksText.length,
      barUsage: cfg.barUsage ? meterWidth('5h', b.five) + 1 + meterWidth('wk', b.week) : 0,
      barRemote: remoteLabel.length,
      barImages: imagesLabel.length,
      barMcp: mcpLabel.length,
      barMode: modeLabel.length,
      // tight: ◈ alone, its red still saying a guardrail fails
      barGuard: !cfg.barGuard ? 0 : isTight ? (' ◈ ' + guardDanger).length : guardLabel.length,
    }
    // a gap before every item in the left group (+ and ⁄ open it), between the items in the right
    const cellsOf = (keys: string[]) => keys.filter(k => !dropped.has(k)).map(k => width[k] ?? 0).filter(Boolean).reduce((n, w) => n + 1 + w, 0)
    const left = 3 + 1 + 3 + cellsOf(order.slice(0, split))
    const rightCells = (brokenLabel ? 1 + brokenLabel.length : 0) + (continueLabel ? 1 + continueLabel.length : 0)
      + (updateLabel ? 1 + updateLabel.length : 0) + cellsOf(order.slice(split + 1))
    const right = Math.max(0, rightCells - 1)
    return { folderText, branchText, marksText, modelLabel, modeLabel, effortLabel, showGauge, left, right }
  }
  // the turn's clock and what it has cost so far, frozen once it ends
  const u = await read($, usage)
  const elapsed = rt.turnStartedAt ? (rt.isBusy ? Date.now() : rt.turnEndedAt || Date.now()) - rt.turnStartedAt : 0
  const spent = rt.turnCostAt !== null && u?.costUsd != null ? u.costUsd - rt.turnCostAt : null
  // shown at the head of the right group, before the gauges, while a turn runs and while Claude lingers
  const isTurnShown = rt.turnStartedAt > 0 && (rt.isBusy || rt.lingerUntil > 0)
  const turnText = isTurnShown ? `◷ ${clockOf(elapsed)}${spent !== null ? ` $${spent.toFixed(2)}` : ''}` : ''
  // the kills, and the monsters that got through to Claude: 12 ✝ · 2 ✗
  const killsText = `${arena.kills} ✝ ${arena.hits ? `· ${arena.hits} ✗ ` : ''}`
  // inside the frame (border and padding take 4), less the arena's margins and one cell of slack
  // past cfg.ctxChipAt% of the context window a chip shows it, and opens the usage menu with /compact
  const ctx = u?.ctxPercent ?? null
  const ctxLabel = cfg.ctxChip && ctx !== null && ctx >= cfg.ctxChipAt ? ` ctx ${Math.round(ctx)}% ` : ''
  // Claude's badge: the agents and the servers running for it, so they show with the menu shut
  const running = (await read($, agents)).filter(a => ['pending', 'running', 'waiting'].includes(a.status)).length
    + (await read($, servers)).length
  const badge = running ? String(running) : ''
  const full = layout(false)
  // the arena wants ARENA_MIN cells besides its margins, the kill count, the clock, the ctx chip and Claude's badge
  const extras = killsText.length + (ctxLabel ? ctxLabel.length + 1 : 0) + (turnText ? turnText.length + 1 : 0) + badge.length
  const isCompact = e.props.bodyColumns - 4 - full.left - full.right - 2 * ARENA_GAP - 1 - extras < ARENA_MIN
  // With no room to play, Claude stands at the head of the right group with the turn's clock: what
  // is left of the row must hold both groups, or the bar runs past the frame
  const restCells = 1 + 2 + badge.length + 1 + (turnText ? turnText.length + 1 : 0) + (ctxLabel ? ctxLabel.length : 0)
  const fits = (l: { left: number; right: number }) => e.props.bodyColumns - 4 - l.left - l.right - restCells >= 0
  let chosen = isCompact ? layout(true) : full
  let isTightNow = false
  if (isCompact && !fits(chosen)) {
    isTightNow = true
    chosen = layout(true, true)
    for (const key of DROP_ORDER) {
      if (fits(chosen)) break
      if (!cfg[key]) continue
      dropped.add(key)
      chosen = layout(true, true)
    }
  }
  // the last resort, a row narrower still: the left group gives up cells at its end rather than overrun
  const isSqueezed = isCompact && !fits(chosen)
  const { folderText, branchText, marksText, modelLabel, modeLabel, effortLabel, showGauge, left, right } = chosen
  arena.width = e.props.bodyColumns - 4 - left - right - 2 * ARENA_GAP - 1 - extras



  // the context, as the gauges' labels are: ctx dim, its figure in amber, red past ctxToastAt
  const ctxText = (
    <Text key="ctx-text">
      <Text dimColor>ctx</Text>
      <Text color={ctx !== null && ctx >= cfg.ctxToastAt ? 'error' : 'warning'} bold>{` ${pct(ctx)}`}</Text>
    </Text>
  )
  const isPlaying = rt.isBusy || rt.lingerUntil > 0
  const isHurt = isPlaying && arena.tick < arena.hurtUntil
  const isTasksOpen = open === 'tasks'
  // null, never '': an empty string is still a child, and the row's gap is laid around it
  const turnClock = turnText ? <Text key="turn" color={rt.isBusy ? 'claude' : 'inactive'}>{turnText}</Text> : null
  const claudeButton = (
    <Button key="claude" plain hover={{ scope: 'qsb-claude', bold: true }} onPress={() => openMenu($, 'tasks')}>
      <Text color={isTasksOpen ? 'inverseText' : isHurt ? 'error' : isPlaying ? 'claude' : 'inactive'} backgroundColor={isTasksOpen ? 'claude' : undefined} bold={isPlaying || isTasksOpen}>¬✻</Text>
      {badge ? <Text color="suggestion" bold>{badge}</Text> : null}
    </Button>
  )

  // One item of the bar, by its Settings key; null when it draws nothing (never '').
  const itemOf = (key: CfgKey) => {
    switch (key) {
      case 'barRemote':
        return remoteLabel ? (
          <Button key="remote" plain hover={{ scope: 'qsb-remote', bold: true }} onPress={() => openMenu($, 'remote')}>
            {pill('remote', remoteLabel, remoteColor)}
          </Button>
        ) : null
      case 'barModel':
        return modelLabel ? (
          <Button key="model" plain hover={{ scope: 'qsb-model', bold: true }} onPress={() => openMenu($, 'model')}>
            {pill('model', modelLabel, ms.color)}
          </Button>
        ) : null
      case 'barEffort':
        return effortLabel ? (
          <Button key="effort" plain hover={{ scope: 'qsb-effort', bold: true }} onPress={() => openMenu($, 'effort')}>
            {pill('effort', effortLabel, effortColor(b.effort))}
          </Button>
        ) : null
      // /folder, with ⎇ branch beside it while the two stand together; both open the git menu
      case 'barFolder':
        return cfg.barFolder ? (
          <Button key={isGitJoined ? 'git' : 'folder'} plain hover={{ scope: 'qsb-git', bold: true }} onPress={() => openMenu($, 'git')}>
            <Text color="suggestion">/</Text>
            <Text bold>{folderText}</Text>
            {isGitJoined && branchText ? <Text color="suggestion">{` ${branchText}`}</Text> : null}
            {isGitJoined && marksText ? <Text color="warning">{marksText}</Text> : null}
          </Button>
        ) : null
      case 'barGit':
        return !isGitJoined && branchText ? (
          <Button key="git" plain hover={{ scope: 'qsb-git', bold: true }} onPress={() => openMenu($, 'git')}>
            <Text color="suggestion">{branchText}</Text>
            {marksText ? <Text color="warning">{marksText}</Text> : null}
          </Button>
        ) : null
      case 'barUsage':
        return cfg.barUsage ? (
          <Button key="usage" plain hover={{ scope: 'qsb-usage', bold: true }} onPress={() => openMenu($, 'usage')}>
            <Text>
              {ctxLabel ? ctxText : null}
              {ctxLabel ? ' ' : null}
              {meterOf('5h', '5h', b.five)}
              {' '}
              {meterOf('wk', 'wk', b.week)}
            </Text>
          </Button>
        ) : null
      case 'barImages':
        return imagesLabel ? (
          <Button key="images" plain hover={{ scope: 'qsb-images', bold: true }} onPress={() => openMenu($, 'images')}>
            {pill('images', imagesLabel, 'subtle')}
          </Button>
        ) : null
      case 'barMcp':
        return mcpLabel ? (
          <Button key="mcp" plain hover={{ scope: 'qsb-mcp', bold: true }} onPress={() => openMenu($, 'mcp')}>
            {pill('mcp', mcpLabel, mcpFailed ? 'error' : 'subtle')}
          </Button>
        ) : null
      case 'barMode':
        return modeLabel ? (
          <Button key="mode" plain hover={{ scope: 'qsb-mode', bold: true }} onPress={() => openMenu($, 'mode')}>
            {pill('mode', modeLabel, m.color)}
          </Button>
        ) : null
      case 'barGuard':
        return guardLabel ? (
          <Button key="guard" plain hover={{ scope: 'qsb-guard', bold: true }} onPress={() => openMenu($, 'guard')}>
            {pill('guard', isTightNow ? ' ◈ ' : guardScore, isAlert ? 'error' : 'success')}
            {guardDanger ? <Text backgroundColor={open === 'guard' ? 'inverseText' : isAlert ? 'error' : 'success'} color="warning" bold>{guardDanger}</Text> : null}
          </Button>
        ) : null
      default:
        return null
    }
  }

  const chips = chipsNow()
  // A surface that draws native buttons gets a bar of its own: words, not the terminal's glyphs.
  if (e.surface !== 'terminal') {
    return desktopBar($, els, {
      open,
      menuTree: open !== null && !rt.isMenuPaneOpen ? await drawMenu($, els, open, false) : null,
      chips,
      model: b.model,
      modelColor: ms.color,
      effort: b.effort,
      effortColor: effortColor(b.effort),
      mode: m.label.split(' (')[0]!,
      modeColor: m.color,
      folder: b.folder,
      branch: cfg.barGit ? b.branch : null,
      gitMarks: cfg.barGit ? gitMarks : '',
      isGitJoined,
      five: b.five,
      week: b.week,
      ctx,
      isCtxShown: !!ctxLabel,
      guardOk: ok,
      guardOf: checks.length,
      isGuardAlert: isAlert,
      dangers: dangerCount,
      mcpLive: liveMcp,
      mcpFailed,
      images: imageCount,
      remoteText: pairs.length ? `⇄ ? ${secondsToPair(pairs[0]!)}s` : isRemoteWaiting() ? `⇄ ${spinnerFrame()}` : rs?.phones ? `⇄ ${rs.phones}` : '⇄',
      remoteColor,
      broken: broken ? { count: brokenAll.length, press: openBroken } : null,
      continueAt: waiting ? vnClock(waiting.at) : '',
      isModBehind: !!rt.modBehind,
      turnText: isTurnShown ? turnText.replace(/^◷ /, '') : '',
      isBusy: rt.isBusy,
      running,
      order,
      split,
    })
  }
  // An open menu taller than the band leaves the head (its title and ✕) and the bar in view and
  // scrolls in the rows between them: the band's two border rows, the head and the gap under the
  // menu, and the bar's row are fixed. The window holds 3 rows at least.
  // with the menu in its own pane the band keeps the bar alone (the open menu's chip still marked)
  const isInBand = open !== null && !rt.isMenuPaneOpen
  const menuTree = isInBand ? await drawMenu($, els, open, e.surface === 'terminal') : null
  const menuWindow = { isClipped: false, rows: 0, from: 0, to: 0 }
  if (menuTree !== null && e.surface === 'terminal' && cfg.pinMenuHead) {
    const rows = rowsOf(menuTree, Math.max(20, e.props.bodyColumns - 4))
    // the band's rows less the engine's "n more" row (the tree is taller than the band, below), its
    // two borders, the head, the gap under the menu and the bar
    const windowRows = Math.max(3, (Number(e.props.maxRows) || 24) - 6)
    rt.menuRows = rows
    rt.menuWindow = windowRows
    rt.menuKeyRows = rows > windowRows ? keyRows(menuTree, Math.max(20, e.props.bodyColumns - 4)) : new Map()
    if (rows > windowRows) {
      rt.menuOffset = Math.min(Math.max(0, rt.menuOffset), rows - windowRows)
      Object.assign(menuWindow, { isClipped: true, rows: windowRows, from: rt.menuOffset + 1, to: rt.menuOffset + windowRows })
    } else rt.menuOffset = 0
  } else rt.menuRows = rt.menuWindow = 0
  const drawn = (
    <Box flexDirection="column" width={e.props.bodyColumns} borderStyle="round" borderColor={open ? 'claude' : 'subtle'} paddingX={1}>
      {/* the menu opens upward: the bar stays next to the prompt */}
      {isInBand && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text color="claude" bold>{TITLES[open as MenuKind]}</Text>
              {menuWindow.isClipped ? <Text dimColor>{`   ↑↓ ${menuWindow.from}–${menuWindow.to} of ${rt.menuRows}`}</Text> : null}
            </Text>
            {/* a wide square target, drawn as the bar's chips are */}
            <Button key="close-menu" plain role="dismiss" hover={{ scope: 'qsb-close', bold: true }} onPress={() => closeMenu($)}>
              <Text backgroundColor="subtle" color="inverseText" bold>{'  ✕  '}</Text>
            </Button>
          </Box>
          {menuWindow.isClipped
            // the head above and the bar below stay put: the menu moves in a window between them
            ? (
              <Box flexDirection="column" height={menuWindow.rows} overflow="hidden">
                <Box flexDirection="column" flexShrink={0} marginTop={-rt.menuOffset}>{menuTree}</Box>
              </Box>
            )
            : menuTree}
        </Box>
      )}
      {/* what Claude's last answer suggests sending next: a press sends it */}
      {open === null && chips.length ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>↳</Text>
          {chips.map((c, i) => (
            <Button key={`chip:${i}`} plain hover={{ scope: 'qsb-chip', bold: true }} onPress={() => sendChip($, c)}>
              <Text color="suggestion">{`‹ ${oneLine(c, 40)} ›`}</Text>
            </Button>
          ))}
          <Button key="chips-dismiss" plain role="dismiss" hover={{ scope: 'qsb-chip', bold: true }} onPress={() => dismissChips($)}>
            <Text dimColor>{' ✕ '}</Text>
          </Button>
        </Box>
      ) : null}
      <Box flexDirection="row" justifyContent="space-between">
        {/* the left group keeps its width: the arena takes the spare cells, so the gaps on either
            side of it stay two cells (branch to kills, Claude to the clock). Neither group
            shrinks: when the row runs short, the arena gives up cells and clips, never the folder */}
        <Box flexDirection="row" gap={1} flexShrink={isSqueezed ? 1 : 0} minWidth={0} overflow="hidden">
          <Button key="add" plain hover={{ scope: 'qsb-add', bold: true }} onPress={() => openMenu($, 'add')}>
            {pill('add', ' + ', 'claude')}
          </Button>
          <Button key="commands" plain hover={{ scope: 'qsb-commands', bold: true }} onPress={() => openMenu($, 'commands')}>
            {pill('commands', ' ⁄ ', 'claude')}
          </Button>
          {order.slice(0, split).filter(k => !dropped.has(k)).map(itemOf)}
        </Box>
        {/* the arcade plays in the gap between the two groups; idle, the field is empty and
            Claude waits at its right end, still a button */}
        {cfg.arcade && arena.width >= ARENA_MIN ? (
          <Box key="arena" flexDirection="row" marginLeft={ARENA_GAP} marginRight={ARENA_GAP} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text dimColor>{isPlaying ? killsText : ' '.repeat(killsText.length)}</Text>
            {/* any spare cell goes here, where the monsters walk in: never into the gaps */}
            <Box flexGrow={1} />
            <Text>{arenaRuns().map(([text, color], i) => <Text key={`run-${i}`} color={color} bold={color !== 'text'}>{text}</Text>)}</Text>
            {claudeButton}
          </Box>
        ) : null}
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {/* too narrow to play: Claude stands at the head of the right group */}
          {!cfg.arcade || arena.width < ARENA_MIN ? claudeButton : null}
          {/* the turn's clock and cost: ◷ 0:42 $0.24 */}
          {turnClock}
          {/* the context chip rides in the usage button, which opens the same menu; alone only with the gauges hidden */}
          {ctxLabel && !cfg.barUsage ? (
            <Button key="usage" plain hover={{ scope: 'qsb-usage', bold: true }} onPress={() => openMenu($, 'usage')}>
              {ctxText}
            </Button>
          ) : null}
          {brokenLabel ? (
            <Button key="bgerr" plain hover={{ scope: 'qsb-bgerr', bold: true }} onPress={openBroken}>
              <Text backgroundColor="error" color="inverseText" bold>{brokenLabel}</Text>
            </Button>
          ) : null}
          {continueLabel ? (
            <Button key="continue" plain hover={{ scope: 'qsb-usage', bold: true }} onPress={() => openMenu($, 'usage')}>
              {pill('usage', continueLabel, 'claude')}
            </Button>
          ) : null}
          {updateLabel ? (
            <Button key="update" plain hover={{ scope: 'qsb-update', bold: true }} onPress={() => updateNow($)}>
              <Text backgroundColor="suggestion" color="inverseText" bold>{updateLabel}</Text>
            </Button>
          ) : null}
          {order.slice(split + 1).filter(k => !dropped.has(k)).map(itemOf)}
        </Box>
      </Box>
    </Box>
  )
  // A clipped menu: two blank rows under the band make the tree taller than the band, so the engine
  // takes it as one that scrolls and hands the wheel to ui.scroll (events/ui.ts), which moves the
  // menu in its window and keeps the band's own window at its top: the head and the bar stay in view
  // and the two rows stay below it. A tree that fits gets no ui.scroll for the wheel.
  return menuWindow.isClipped
    ? <Box flexDirection="column">{drawn}<Box key="wheel-room" height={2} /></Box>
    : drawn
}

// The open menu in its own pane (menuInPane): the same drawing as in the band, under the pane's own
// title; the pane closed by the person (Escape, its mark, ctrl+x x) closes the menu.
export async function drawMenuPane($: any, e: any, next: any) {
  const open = await read($, menu)
  if (open === null) return next(e)
  const els = $.ui.resolve(e)
  const { Box } = els
  return <Box flexDirection="column" paddingX={1}>{await drawMenu($, els, open, e.surface === 'terminal')}</Box>
}
