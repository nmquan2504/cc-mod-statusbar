import { projectDir } from '../lib/project'
import { cfg } from '../state/config'

// Where the shield menu writes a rule or a hook, as its scope chip picks: the project's shared
// .claude/settings.json (it goes into git, so the team gets it), the project's
// .claude/settings.local.json (yours alone, kept out of git), or ~/.claude/settings.json (every project).
export type RuleScope = 'project' | 'local' | 'user'
export const SCOPES: RuleScope[] = ['project', 'local', 'user']
export const scopeNow = (): RuleScope => (SCOPES.includes(cfg.ruleScope as RuleScope) ? (cfg.ruleScope as RuleScope) : 'project')
export const scopeFile: Record<RuleScope, string> = {
  project: '.claude/settings.json',
  local: '.claude/settings.local.json',
  user: '~/.claude/settings.json',
}

export async function scopePath($: any, scope: RuleScope = scopeNow()) {
  if (scope === 'user') {
    const home: string = (await $.env.get('HOME').catch(() => '')) ?? ''
    if (!home) throw new Error('no home folder')
    return `${home}/.claude/settings.json`
  }
  return `${await projectDir($)}/${scopeFile[scope]}`
}

// Read, change and write the settings file of `scope` (made when missing)
export async function editSettings($: any, change: (json: any) => void, scope: RuleScope = scopeNow()) {
  const path = await scopePath($, scope)
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const json = JSON.parse(text || '{}')
  change(json)
  await $.fs.write(path, `${JSON.stringify(json, null, 2)}\n`)
  return scopeFile[scope]
}
