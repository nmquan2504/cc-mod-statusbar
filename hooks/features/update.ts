import { atom, read, update } from 'claude-code'
import { rt } from '../state/runtime'

// The version this session ran before its last reload, kept in the session's state, which a
// reload keeps: a reload that loads another version says so.
const loadedVersion = atom({ plugin: 'cc-mod-statusbar', key: 'loadedVersion' } as const, '')

// How often the mod asks its own repository for new commits, in the session clock's seconds.
export const UPDATE_EVERY = 3600

// The mod's folder, when it is a git working copy with an upstream: fetches it and counts the
// commits upstream that this copy lacks. Installed from a marketplace, the folder is a copy with
// no repository, and the count stays 0 (`claude plugin update` updates those).
export async function checkModUpdate($: any) {
  const root: string = $.plugin.root
  const fetched = await $.process.run(['git', '-C', root, 'fetch', '--quiet'], { timeoutMs: 30_000 }).catch(() => undefined)
  if (!fetched || fetched.exitCode !== 0) return
  const r = await $.process.run(['git', '-C', root, 'rev-list', '--count', 'HEAD..@{u}']).catch(() => undefined)
  const n = r && r.exitCode === 0 ? Number(r.stdout.trim()) || 0 : 0
  if (n === rt.modBehind) return
  rt.modBehind = n
  $.ui.invalidate('ui.render')
}

// Pulls the new commits (fast-forward only, so a local change is never merged over), after a yes.
export async function pullModUpdate($: any) {
  const root: string = $.plugin.root
  const n = rt.modBehind
  const PULL = 'Pull'
  const answer = await $.ui.ask(`${n} new commit${n === 1 ? '' : 's'} for cc-mod-statusbar on its upstream. Pull them into ${root}?`, {
    header: '↑ mod',
    options: [PULL, 'Not now'],
  }).catch(() => undefined)
  if (answer !== PULL) return
  const r = await $.process.run(['git', '-C', root, 'pull', '--ff-only', '--quiet'], { timeoutMs: 60_000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) {
    const why = (r?.stderr || r?.stdout || 'git did not run').trim().split('\n')[0]
    $.ui.toast(`statusbar: pull failed: ${why}`)
    return
  }
  rt.modBehind = 0
  rt.isModPulled = true
  $.ui.invalidate('ui.render')
  $.ui.toast('statusbar: mod updated; run /reload-plugins to load it')
}

// The code this session loaded: the manifest's version and, in a git working copy, its commit and
// the commit's date. Read at session.start, which a reload runs again, so it names the code loaded,
// not what a later pull put in the folder.
export async function readModVersion($: any) {
  const root: string = $.plugin.root
  const manifest = await $.process.run(['cat', `${root}/.claude-plugin/plugin.json`]).catch(() => undefined)
  let version = ''
  try { version = String(JSON.parse(manifest?.stdout ?? '').version ?? '') } catch { version = '' }
  const r = await $.process.run(['git', '-C', root, 'log', '-1', '--format=%h %ct']).catch(() => undefined)
  const [commit = '', at = ''] = r && r.exitCode === 0 ? r.stdout.trim().split(' ') : []
  rt.modVersion = { version, commit, at: Number(at) * 1000 || 0 }
  const now = modVersionText()
  const was = await read($, loadedVersion).catch(() => '')
  if (now && was && was !== now) $.ui.toast(`statusbar: now on ${now} (was ${was})`)
  if (now !== was) await update($, loadedVersion, () => now).catch(() => undefined)
}

// "0.1.0 · 994a88c, 23 Oct 10:41": the manifest's version, then the commit and when it was made.
export function modVersionText() {
  const { version, commit, at } = rt.modVersion
  const when = at ? new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  return [version, [commit, when].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
}
