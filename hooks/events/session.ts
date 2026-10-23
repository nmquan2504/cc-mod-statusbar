import { HEALTH_EVERY, checkServers, scanBackground } from '../features/work'
import { atom, read } from 'claude-code'
import { resetArena, stepArena, stepLinger } from '../features/arena'
import { runAutomation } from '../features/automation'
import { readGuard } from '../features/guard'
import { readImages } from '../features/images'
import { readMcp } from '../features/mcp'
import { probeMode } from '../features/mode'
import { tickPrompts } from '../features/prompts'
import { isRemoteWaiting, pendingPairs, tickRemote } from '../features/remote'
import { refreshBar } from '../features/status'
import { UPDATE_EVERY, checkModUpdate } from '../features/update'
import { cache, vaultSessionStart } from '../features/vault'
import { readAgents, readServers, readWork } from '../features/work'
import { cfg, loadSettings } from '../state/config'
import { rt } from '../state/runtime'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const menu = atom({ plugin: 'cc-mod-statusbar', key: 'menu' } as const, null)

import type { On } from 'claude-code'

export function registerSession(on: On) {
  on('session.start', async ($, e, next) => {
    cache.clear()
    rt.isTainted = false
    $.ui.status(undefined) // the bar keeps no status line of its own
    await readImages($).catch(() => undefined) // the ▣ chip's count, kept across a reload
    // an earlier version opened its menus in a pane, which outlives a reload: close it if still up
    if ((await $.ui.panes().catch(() => [])).some((p: { id: string }) => p.id === 'qsb-menu'))
      await $.ui.close({ id: 'qsb-menu' }).catch(() => undefined)
    await loadSettings($)
    await refreshBar($)
    await readGuard($)
    await vaultSessionStart($)
    await readMcp($).catch(() => undefined)
    resetArena()
    $.clock.every(120, () => {
      if (rt.isBusy && cfg.arcade) stepArena()
      else if (rt.lingerUntil) stepLinger()
      else if (!isRemoteWaiting() && !pendingPairs().length) return // idle and cleared: nothing to draw (a waiting remote turns its spinner, a request to pair counts down)
      $.ui.invalidate('ui.render')
    })
    // shift+tab changes the mode between turns: only the hint line shows it then
    const root: string = await $.session.cwd().catch(() => '.')
    let ticks = 0
    $.clock.every(1000, () => {
      void probeMode($, root).then(mode => {
        if (mode === undefined || mode === rt.probedMode) return
        rt.probedMode = mode
        if (mode !== rt.drawnMode) $.ui.invalidate('ui.render')
      })
      // usage moves with every API response, a turn's end is too late for a long turn
      if (++ticks % 5 === 0) void refreshBar($).catch(() => undefined)
      // the shield's score follows the settings with its menu shut: a settings file edited by hand,
      // by Claude or by /permissions
      if (ticks % 5 === 0) void readGuard($).catch(() => undefined)
      // a running background command's log, read for an error line
      if (ticks % 5 === 0) void scanBackground($).catch(() => undefined)
      // each server, asked over HTTP whether it still answers
      if (ticks % HEALTH_EVERY === 0) void checkServers($).catch(() => undefined)
      // a permission prompt that has waited for the person: counted, and the phone told
      void tickPrompts($).catch(() => undefined)
      // what the automation has due: "continue" after a reset, "hi" on its schedule
      if (ticks % 15 === 0) void runAutomation($).catch(() => undefined)
      // the mod's own repository: new commits upstream, a minute in and then every hour
      if (ticks % UPDATE_EVERY === 60) void checkModUpdate($).catch(() => undefined)
      // Self remote: this session's snapshot to the hub, and what the phone sent back
      if (cfg.selfRemote && ticks % 2 === 0) void tickRemote($).catch(() => undefined)
      if (rt.isHot) $.ui.invalidate('ui.render') // the blink past 90%
      void read($, menu).then(async open => {
        if (open === 'tasks') await readWork($)
        // a followed log: its newest lines every second
        if (open === 'tasks' && rt.isLogFollow && rt.openDetail.startsWith('bg:')) $.ui.invalidate('ui.render')
        else if (ticks % 5 === 0) await readAgents($)
        // ps and lsof: every 5 seconds with the menu open, every 10 for Claude's badge
        if (ticks % (open === 'tasks' ? 5 : 10) === 0) await readServers($)
      }).catch(() => undefined)
    })
    return next(e)
  }).catch(($, e, next) => next(e)) // a status bar never holds up the session
}
