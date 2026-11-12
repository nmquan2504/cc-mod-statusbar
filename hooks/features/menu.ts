import { atom, read, update } from 'claude-code'
import type { MenuKind, CommandRow, FileRow } from '../../types'
import { COLLAPSED_KEY, TOP_GROUP, USE_KEY, groupOf } from './commands'
import { readGuard } from './guard'
import { readImages } from './images'
import { readMcp } from './mcp'
import { readRemote } from './remote'
import { refreshBar } from './status'
import { fetchUsage, readBreakdown } from './usage'
import { readVault } from './vault'
import { rt } from '../state/runtime'
import { readServers, readWork } from './work'
import { SKIP_DIRS, TITLES } from '../lib/catalog'
import { cfg } from '../state/config'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const menu = atom({ plugin: 'cc-mod-statusbar', key: 'menu' } as const, null)
const commands = atom({ plugin: 'cc-mod-statusbar', key: 'commands' } as const, [])
const dir = atom({ plugin: 'cc-mod-statusbar', key: 'dir' } as const, '')
const files = atom({ plugin: 'cc-mod-statusbar', key: 'files' } as const, [])
const collapsed = atom({ plugin: 'cc-mod-statusbar', key: 'collapsed' } as const, [])
// What is typed in the commands menu's search field.
const filter = atom({ plugin: 'cc-mod-statusbar', key: 'filter' } as const, '')

// The pane a menu opens in with menuInPane on: one for every menu, retitled as another opens
export const MENU_PANE = 'qsb-menu'

export async function closeMenu($: any) {
  rt.menuOffset = 0
  rt.guardSection = ''
  await update($, menu, () => null)
  if (rt.isMenuPaneOpen) {
    rt.isMenuPaneOpen = false
    await $.ui.close({ id: MENU_PANE }).catch(() => undefined)
  }
}

export async function listDir($: any, path: string) {
  const entries = await $.fs.list(path || '.').catch(() => [])
  const rows: FileRow[] = entries
    .filter((f: { name: string }) => !SKIP_DIRS.has(f.name))
    .map((f: { name: string; kind: string }) => ({ name: f.name, isDir: f.kind === 'dir' }))
    .sort((a: FileRow, b: FileRow) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  await update($, dir, () => path)
  await update($, files, () => rows)
}

export async function openMenu($: any, kind: MenuKind) {
  if (kind === 'commands') {
    const list = await $.command.list()
    const rows: CommandRow[] = list
      .map((c: { name: string; description: string; source: string; plugin?: string }) => ({
        name: c.name,
        description: c.description,
        group: groupOf(c),
      }))
      .sort((a: CommandRow, b: CommandRow) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
    // the cfg.topCommands (5 to 10) you type most, the most recent first among equals, on top of the list
    const counts = ((await $.store.get(USE_KEY).catch(() => undefined)) ?? {}) as Record<string, { n: number; last: number }>
    const top = Object.entries(counts)
      .filter(([name]) => rows.some(r => r.name === name))
      .sort(([, a], [, b]) => b.n - a.n || b.last - a.last)
      .slice(0, cfg.topCommands)
      .map(([name, c]) => ({
        name,
        description: `${c.n}× · ${rows.find(r => r.name === name)?.description ?? ''}`,
        group: TOP_GROUP,
      }))
    await update($, commands, () => [...top, ...rows])
    await update($, filter, () => '')
    const kept = await $.store.get(COLLAPSED_KEY).catch(() => undefined)
    if (Array.isArray(kept)) await update($, collapsed, () => kept.filter((g: unknown) => typeof g === 'string'))
  }
  if (kind === 'files') await listDir($, await read($, dir))
  if (kind === 'model' || kind === 'effort') await refreshBar($)
  if (kind === 'mcp') await readMcp($)
  if (kind === 'images') await readImages($)
  if (kind === 'remote') await readRemote($)
  if (kind === 'tasks') {
    await readWork($)
    await readServers($)
  }
  if (kind === 'usage' || kind === 'git') await refreshBar($)
  if (kind === 'usage') await readBreakdown($, 'summary')
  if (kind === 'guard') {
    await readGuard($)
    await readVault($)
    await readMcp($)
  }
  // the same button again closes it, as a dropdown does; another opens at its top
  rt.menuOffset = 0
  // the shield opens on its MCP access only from the mcp menu's link
  if (kind !== 'guard') rt.guardSection = ''
  await update($, menu, now => (now === kind ? null : kind))
  // the usage opened: asked of Anthropic at once, the bar and the menu redrawn when it answers
  if (kind === 'usage' && (await read($, menu)) === 'usage') void fetchUsage($).then(ok => (ok ? refreshBar($) : undefined)).catch(() => undefined)
  const now = await read($, menu)
  // in a pane of its own: opened (or retitled) with the menu, closed with it; Escape there closes both.
  // Seated above the prompt (no dock), paneRows (8): a taller pane squeezed the band to its bar's row
  // alone. Docked, paneColumns wide when set
  if (cfg.menuInPane && now !== null) {
    const r = await $.ui.open({ id: MENU_PANE, title: TITLES[now], focus: true, closeOnEscape: true, rows: cfg.paneRows, ...(cfg.paneColumns >= 24 ? { columns: cfg.paneColumns } : {}) }).catch(() => undefined)
    rt.isMenuPaneOpen = Boolean(r?.isPlaced)
    if (rt.isMenuPaneOpen) return
  } else if (now === null && rt.isMenuPaneOpen) {
    rt.isMenuPaneOpen = false
    await $.ui.close({ id: MENU_PANE }).catch(() => undefined)
  }
  // the band shows its end, by the prompt: the menu scrolls inside its own window above the bar
  if (now !== null) await $.ui.scroll({ to: { key: 'add' }, block: 'end' }).catch(() => undefined)
}

// Insert text at the cursor, then go back to the prompt.
export async function insertText($: any, text: string) {
  await $.prompt.fill({ text, mode: 'insert' })
  await closeMenu($)
}
