import { atom, read, update } from 'claude-code'
import type { ChangeRow } from '../../types'
import { keepUsage } from './usage'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
// The files git reports changed, for the menu the folder opens.
const changes = atom({ plugin: 'cc-mod-statusbar', key: 'changes' } as const, [])

// `git status --porcelain=v2 --branch`: the branch, commits to push and to pull, the changed files.
export function parseStatus(out: string) {
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const files: ChangeRow[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14).trim()
      branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    } else if (line.startsWith('? ')) {
      files.push({ path: line.slice(2), code: '??' })
    } else if (/^[12u] /.test(line)) {
      const f = line.split(' ')
      // fields before the path: 1 has 8, 2 has 9 (its path is "new<TAB>old"), u has 10
      const skip = line[0] === '1' ? 8 : line[0] === '2' ? 9 : 10
      const path = f.slice(skip).join(' ').split('\t')[0] ?? ''
      files.push({ path, code: (f[1] ?? '').replace(/\./g, ' ').trim() })
    }
  }
  return { branch, ahead, behind, files }
}

// The taskbar's readings: model, folder and branch, usage; refreshed at start, every 5 s, after each turn, on a pick.
export async function refreshBar($: any) {
  const model: string = await $.session.model().catch(() => '')
  // the effort a turn last ran at wins; before the first one, the settings' default
  if ((await read($, bar)).effort === null) {
    const set = (await $.settings.read().catch(() => ({}))) as { effortLevel?: unknown }
    if (typeof set.effortLevel === 'string') await update($, bar, b => ({ ...b, effort: set.effortLevel as string }))
  }
  const usage = await $.session.usage().catch(() => undefined)
  await keepUsage($, usage)
  const used = (kind: string): number | null =>
    usage?.rateLimits.find((r: { kind: string }) => r.kind === kind)?.percentUsed ?? null
  const cwd: string = await $.session.cwd().catch(() => '')
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd
  // null outside a repository; the branch is null on a detached HEAD
  const git = cwd ? await $.process.run(['git', '-C', cwd, 'status', '--porcelain=v2', '--branch']).catch(() => undefined) : undefined
  const st = git?.exitCode === 0 ? parseStatus(git.stdout) : null
  await update($, changes, () => st?.files ?? [])
  await update($, bar, b => ({
    ...b, model, folder, branch: st?.branch ?? null,
    dirty: st?.files.length ?? 0, ahead: st?.ahead ?? 0, behind: st?.behind ?? 0,
    five: used('five_hour'), week: used('seven_day'),
  }))
}
