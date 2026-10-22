import { rt } from '../state/runtime'

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
  $.ui.invalidate('ui.render')
  $.ui.toast('statusbar: mod updated; run /reload-plugins to load it')
}
