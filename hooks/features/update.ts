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
// Resolves the count, or undefined when the fetch failed or the folder is no clone.
export async function checkModUpdate($: any): Promise<number | undefined> {
  const root: string = $.plugin.root
  const fetched = await $.process.run(['git', '-C', root, 'fetch', '--quiet'], { timeoutMs: 30_000 }).catch(() => undefined)
  if (!fetched || fetched.exitCode !== 0) return undefined
  const r = await $.process.run(['git', '-C', root, 'rev-list', '--count', 'HEAD..@{u}']).catch(() => undefined)
  if (!r || r.exitCode !== 0) return undefined
  const n = Number(r.stdout.trim()) || 0
  if (n !== rt.modBehind) {
    rt.modBehind = n
    $.ui.invalidate('ui.render')
  }
  return n
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
  if (await pullMod($)) $.ui.toast('statusbar: mod updated; run /reload-plugins to load it')
}

// git pull --ff-only in the mod's folder: true once pulled; a failure says why in a toast.
async function pullMod($: any) {
  const r = await $.process.run(['git', '-C', $.plugin.root, 'pull', '--ff-only', '--quiet'], { timeoutMs: 60_000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) {
    const why = (r?.stderr || r?.stdout || 'git did not run').trim().split('\n')[0]
    $.ui.toast(`statusbar: pull failed: ${why}`)
    return false
  }
  rt.modBehind = 0
  rt.isModPulled = true
  $.ui.invalidate('ui.render')
  return true
}

// Settings, Check for update: fetch now, pull what the upstream has (fast-forward only), and run
// /reload-plugins so the session loads it. The press is the yes: nothing more is asked.
export async function updateNow($: any) {
  $.ui.toast('statusbar: checking for an update…')
  const n = await checkModUpdate($)
  if (n === undefined) return void $.ui.toast('statusbar: could not check: the fetch failed, or the mod is not a git clone (claude plugin update updates a marketplace install)')
  if (n === 0 && !rt.isModPulled) return void $.ui.toast(`statusbar: up to date (${modVersionText() || 'version unknown'})`)
  if (n > 0 && !(await pullMod($))) return
  $.ui.toast(n > 0 ? `statusbar: pulled ${n} new commit${n === 1 ? '' : 's'}; reloading` : 'statusbar: loading the version already pulled')
  await $.command.run({ command: 'reload-plugins' }).catch((err: unknown) => $.ui.toast(`statusbar: run /reload-plugins to load it (${String(err)})`))
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

// "0.2.0 · 994a88c": the manifest's version and the commit, for the phone's drawer.
export function modVersionShort() {
  const { version, commit } = rt.modVersion
  return [version, commit].filter(Boolean).join(' · ')
}

// "0.2.0 · 994a88c, 23 Oct 10:41": the manifest's version, then the commit and when it was made.
export function modVersionText() {
  const { version, commit, at } = rt.modVersion
  const when = at ? new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  return [version, [commit, when].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
}
