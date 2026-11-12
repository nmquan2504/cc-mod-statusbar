// The git commands the protect-git guardrail stops: a push to main or master, a force push, and a
// reset --hard of a branch that has an upstream (its commits may be on the remote). A pure reading
// of the command line, its parts split at && || ; and |, each part's git and its options.
export type GitVerdict = { kind: 'deny' | 'ask'; why: string } | null
const PROTECTED = new Set(['main', 'master'])

// the words of each git part: `git -C dir -c k=v push origin main` gives ['push', 'origin', 'main']
function gitParts(command: string): string[][] {
  const parts: string[][] = []
  for (const part of command.split(/&&|\|\||;|\||\n/)) {
    const words = part.trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < words.length && (/^\w+=/.test(words[i]!) || words[i] === 'sudo' || words[i] === 'command' || words[i] === 'env')) i++
    if (words[i] !== 'git') continue
    i++
    while (i < words.length && /^-/.test(words[i]!)) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(words[i]!) ? 2 : 1
    parts.push(words.slice(i).map(w => w.replace(/^['"]|['"]$/g, '')))
  }
  return parts
}

export function gitRisk(command: string, branch: string | null, hasUpstream: boolean): GitVerdict {
  if (!/\bgit\b/.test(command)) return null
  for (const [sub, ...args] of gitParts(command)) {
    if (sub === 'push') {
      const isForce = args.some(a => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror)$/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a))
      const refs = args.filter(a => !a.startsWith('-'))
      // after the remote, each refspec: src:dst, +src:dst (a forced one), or a name
      const specs = refs.slice(1)
      const forcedSpec = specs.some(s => s.startsWith('+'))
      const dests = specs.length ? specs.map(s => s.replace(/^\+/, '').split(':').pop()!.replace(/^refs\/heads\//, '')) : branch ? [branch] : []
      if (isForce || forcedSpec) return { kind: 'deny', why: 'a force push rewrites what others may have pulled' }
      const hit = dests.find(d => PROTECTED.has(d) || (d === 'HEAD' && branch && PROTECTED.has(branch)))
      if (hit) return { kind: 'deny', why: `a push straight to ${hit === 'HEAD' ? branch : hit}; push a branch and open a pull request` }
    }
    if (sub === 'reset' && args.includes('--hard') && hasUpstream) return { kind: 'ask', why: 'reset --hard on a branch that has an upstream: commits on it may be lost' }
  }
  return null
}

// A package install with a name: npm/pnpm/yarn/bun add or install NAME, pip install NAME (not -r
// or -e), uv add, poetry add, cargo add or install, go get or install, gem and brew install. The
// install of what a lock file or manifest already lists (npm ci, npm install alone) is left alone.
const INSTALLS: RegExp[] = [
  /\b(?:npm|pnpm|bun)\s+(?:i|install|add)\s+(?:-\S+\s+)*([^-\s&|;][^\s&|;]*)/,
  /\byarn\s+(?:global\s+)?add\s+(?:-\S+\s+)*([^-\s&|;][^\s&|;]*)/,
  /\b(?:pip3?|python3?\s+-m\s+pip|uv\s+pip)\s+install\s+(?:--?(?!r\b|e\b|requirement|editable)\S+\s+)*([^-\s&|;][^\s&|;]*)/,
  /\b(?:uv|poetry)\s+add\s+(?:-\S+\s+)*([^-\s&|;][^\s&|;]*)/,
  /\bcargo\s+(?:add|install)\s+(?:-\S+\s+)*([^-\s&|;][^\s&|;]*)/,
  /\bgo\s+(?:get|install)\s+(?:-\S+\s+)*([^-\s&|;][^\s&|;]*)/,
  /\b(?:gem|brew)\s+install\s+(?:-\S+\s+)*([^-\s&|;][^\s&|;]*)/,
]
export function newPackage(command: string): string | null {
  for (const re of INSTALLS) {
    const m = re.exec(command)
    if (m?.[1]) return m[1]
  }
  return null
}

// A command that checks work: tests, a build, a type check, a linter, or running what was written
export const VERIFY_RE = /\b(test|tests|jest|vitest|mocha|pytest|unittest|tox|nox|go\s+(test|vet|build)|cargo\s+(test|check|build|clippy)|tsc|typecheck|type-check|lint|eslint|ruff|mypy|pyright|build|compile|make|gradle|gradlew|mvn|xcodebuild|swift\s+(test|build)|dotnet\s+(test|build)|plugin\s+test|e2e|check|verify|playwright|cypress)\b/i
