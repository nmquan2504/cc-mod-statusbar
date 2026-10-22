// What makes a Bash command dangerous: each part of it (split at ; & | and newlines, the pipe kept
// for curl | sh) checked against the commands that destroy work, data or infrastructure, or run code
// from the network. Text Bash only prints or feeds in is left out: a quoted string and a heredoc's
// body, so `echo "rm -rf x"` or a script piped to python is not a danger. Text a shell runs is read
// as commands of its own: sh -c '…', bash -c "…", eval "…", a heredoc fed to a shell, a string
// echoed into one. A word quoted or escaped to hide it ("rm", \rm, r''m) is read as the word.
//
// rm -rf inside a temporary folder (/tmp, /private/tmp, /var/folders, $TMPDIR), named or through a
// variable the command sets, is no danger. rm -rf on /, the home folder, a parent folder or the
// project itself is refused outright: a misplaced press on Run would cost too much.

export type Danger = { name: string; isBlocked: boolean; target?: string }
// the home folder, the session's folder, and the temporary folder the environment names
export type Where = { home?: string; cwd?: string; tmpdir?: string }

const SHELL = /^(sudo\s+)?(ba|z|da)?sh$/
const TEMP_ROOTS = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/']
const DB_CLIENT = /\b(psql|mysql|mariadb|sqlite3|mongosh?|clickhouse(-client)?|cockroach|bq|snowsql|sqlcmd|duckdb)\b/

// A word as the shell reads it: quotes and escapes taken out
const unquote = (w: string) => w.replace(/\\(.)/g, '$1').replace(/['"]/g, '')

// The name of the first danger found, or null.
export function dangerOf(command: string, where: Where = {}): Danger | null {
  const kept: string[] = []
  let until: string | null = null
  let isFed = false
  for (const line of command.split('\n')) {
    if (until !== null) {
      if (line.trim() === until) until = null
      // a heredoc fed to a shell is commands, not text
      else if (isFed) kept.push(line)
      continue
    }
    kept.push(line)
    const heredoc = /^(.*?)<<-?\s*(['"]?)([\w.-]+)\2/.exec(line)
    if (heredoc) {
      until = heredoc[3]!
      isFed = SHELL.test(heredoc[1]!.trim().split(/[;&|]/).pop()!.trim())
    }
  }
  const text = kept.join('\n')
  // SQL that drops or empties a table, sent to a database client (in a string or a heredoc)
  if (DB_CLIENT.test(command) && /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?[\w."`]+)/i.test(command)) return { name: 'DROP / TRUNCATE', isBlocked: false }
  // text a shell runs: sh -c '…', eval "…", and a string echoed or printed into a shell
  for (const run of text.matchAll(/(?:\b(?:sh|bash|zsh|dash)\s+-c|\beval)\s+(['"])([\s\S]*?)\1/g)) {
    const inner = dangerOf(run[2]!, where)
    if (inner) return inner
  }
  for (const run of text.matchAll(/(['"])([\s\S]*?)\1[^|;&\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/g)) {
    const inner = dangerOf(run[2]!, where)
    if (inner) return inner
  }
  // a quoted word with no space in it is that word ("rm", r''m); other quoted text is blanked
  const bare = text
    .replace(/''|""/g, '')
    .replace(/'([^'\s]*)'/g, '$1')
    .replace(/"([^"\s\\]*)"/g, '$1')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  if (/\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(bare)) return { name: 'curl | sh', isBlocked: false }
  // the variables the command sets (D=/tmp/x; rm -rf $D), for what rm deletes
  const vars = new Map<string, string>()
  for (const m of text.matchAll(/(?:^|[\s;&|])(?:export\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]*)/g)) vars.set(m[1]!, unquote(m[2]!))
  if (where.tmpdir && !vars.has('TMPDIR')) vars.set('TMPDIR', where.tmpdir)
  const hasCd = /(^|[;&|\n]\s*)(cd|pushd)\s/.test(bare)
  for (const part of bare.split(/[;&|\n]+/)) {
    const words = part.trim().split(/\s+/).filter(Boolean).map(unquote)
    const at = words.findIndex(w => w === 'rm' || w.endsWith('/rm'))
    if (at >= 0) {
      const args = words.slice(at + 1)
      const flags = args.filter(w => w.startsWith('-') && w !== '--')
      const short = flags.filter(f => !f.startsWith('--')).join('')
      const isRecursive = /[rR]/.test(short) || flags.includes('--recursive')
      const isForced = short.includes('f') || flags.includes('--force')
      if (isRecursive && isForced) {
        const targets = args.filter(w => !w.startsWith('-')).map(t => expand(t, vars, where))
        const ruinous = targets.find(t => isRuinous(t, where, hasCd)) ?? (flags.includes('--no-preserve-root') ? '/' : undefined)
        if (ruinous !== undefined) return { name: 'rm -rf', isBlocked: true, target: ruinous }
        if (!targets.length || !targets.every(t => isTemp(t))) return { name: 'rm -rf', isBlocked: false }
      }
    }
    const git = words.indexOf('git')
    if (git >= 0) {
      const rest = words.slice(git + 1)
      const sub = rest[0]
      if (sub === 'push' && rest.some(w => w === '--force' || w === '-f' || w.startsWith('+') || (/^-[a-zA-Z]+$/.test(w) && w.includes('f')))) return { name: 'git push --force', isBlocked: false }
      if (sub === 'push' && rest.includes('--mirror')) return { name: 'git push --mirror', isBlocked: false }
      if (sub === 'push' && (rest.includes('--delete') || rest.includes('-d') || rest.slice(1).some(w => w.startsWith(':') && w.length > 1))) return { name: 'git push --delete', isBlocked: false }
      if (sub === 'reset' && rest.includes('--hard')) return { name: 'git reset --hard', isBlocked: false }
      if (sub === 'clean' && rest.some(w => /^-[a-zA-Z]*f/.test(w) || w === '--force')) return { name: 'git clean -f', isBlocked: false }
      if (sub === 'branch' && rest.includes('-D')) return { name: 'git branch -D', isBlocked: false }
      if (sub === 'stash' && (rest[1] === 'clear' || rest[1] === 'drop')) return { name: `git stash ${rest[1]}`, isBlocked: false }
      // the whole tree's uncommitted changes thrown away (a --staged restore only unstages)
      const isWholeTree = rest.some(w => w === '.' || w === ':/' || w === '*')
      if (sub === 'checkout' && (isWholeTree || rest.includes('-f') || rest.includes('--force'))) return { name: 'git checkout .', isBlocked: false }
      if (sub === 'restore' && isWholeTree && !(rest.includes('--staged') && !rest.includes('--worktree') && !rest.includes('-W'))) return { name: 'git restore .', isBlocked: false }
    }
    if (words[0] === 'mkfs' || words[0]?.startsWith('mkfs.') || (words.includes('dd') && words.some(w => w.startsWith('of=/dev/')))) return { name: 'disk overwrite', isBlocked: false }
    if (words.includes('find') && words.includes('-delete')) return { name: 'find -delete', isBlocked: false }
    const tool = (name: string) => words.indexOf(name)
    if (tool('docker') >= 0 && (words.includes('prune') || (words.includes('volume') && (words.includes('rm') || words.includes('remove'))))) return { name: 'docker prune', isBlocked: false }
    if (tool('kubectl') >= 0 && words[tool('kubectl') + 1] === 'delete') return { name: 'kubectl delete', isBlocked: false }
    if (tool('terraform') >= 0 && (words.includes('destroy') || words.includes('-destroy'))) return { name: 'terraform destroy', isBlocked: false }
  }
  return null
}

// A path with the variables the command set (or the environment's TMPDIR, the home folder) in place
function expand(target: string, vars: Map<string, string>, where: Where) {
  return target
    .replace(/^~(?=\/|$)/, where.home ?? '~')
    .replace(/\$\{?(\w+)\}?/g, (m, name: string) => vars.get(name) ?? (name === 'HOME' && where.home ? where.home : m))
}

// Inside a temporary folder, the folder itself left alone; nothing unknown ($X) in it
function isTemp(path: string) {
  if (path.includes('$') || path.includes('..')) return false
  return TEMP_ROOTS.some(root => path.startsWith(root) && path.length > root.length && !/^\*?$/.test(path.slice(root.length)))
}

// The disk, the home folder, a parent folder, or the project itself: what no rm -rf should take
function isRuinous(path: string, where: Where, hasCd: boolean) {
  const p = path.replace(/\/+$/, '').replace(/\/\*$/, '') || '/'
  if (p === '/' || p === '/*' || p === '~' || p === '$HOME' || p === '${HOME}' || p === '..' || p.startsWith('../') && /^(\.\.\/)*\.\.$/.test(p)) return true
  if (where.home && (p === where.home || p === where.home.replace(/\/+$/, ''))) return true
  if (where.cwd && p === where.cwd.replace(/\/+$/, '')) return true
  // the folder the command runs in, when it has not moved first
  return !hasCd && (p === '.' || p === '*' || p === './*' || path === './')
}
