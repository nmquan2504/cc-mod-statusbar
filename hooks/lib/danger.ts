import { read } from 'claude-code'


// What makes a Bash command dangerous: each part of it (split at ; & | and newlines, the pipe kept
// for curl | sh) checked against the commands that destroy work or run code from the network.
// Text Bash only prints or feeds in is left out: a heredoc's body and a quoted string, so
// `echo "rm -rf x"` or a script piped to python is not a danger; a string handed to a shell to run
// (sh -c '…', bash -c "…", eval "…") is read as a command of its own.
// The name of the first danger found, or null.
export function dangerOf(command: string): string | null {
  const kept: string[] = []
  let until: string | null = null
  for (const line of command.split('\n')) {
    if (until !== null) {
      if (line.trim() === until) until = null
      continue
    }
    kept.push(line)
    const heredoc = /<<-?\s*(['"]?)([\w.-]+)\1/.exec(line)
    if (heredoc) until = heredoc[2]!
  }
  const text = kept.join('\n')
  for (const run of text.matchAll(/(?:\b(?:sh|bash|zsh|dash)\s+-c|\beval)\s+(['"])([\s\S]*?)\1/g)) {
    const inner = dangerOf(run[2]!)
    if (inner) return inner
  }
  const bare = text.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
  if (/\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(bare)) return 'curl | sh'
  for (const part of bare.split(/[;&|\n]+/)) {
    const words = part.trim().split(/\s+/).filter(Boolean)
    const at = words.findIndex(w => w === 'rm' || w.endsWith('/rm'))
    if (at >= 0) {
      const flags = words.slice(at + 1).filter(w => w.startsWith('-'))
      const short = flags.filter(f => !f.startsWith('--')).join('')
      const isRecursive = /[rR]/.test(short) || flags.includes('--recursive')
      const isForced = short.includes('f') || flags.includes('--force')
      if (isRecursive && isForced) return 'rm -rf'
    }
    const git = words.indexOf('git')
    if (git >= 0) {
      const rest = words.slice(git + 1)
      if (rest[0] === 'push' && rest.some(w => w === '--force' || w === '-f' || /^\+/.test(w) || (/^-[a-zA-Z]+$/.test(w) && w.includes('f')))) return 'git push --force'
      if (rest[0] === 'reset' && rest.includes('--hard')) return 'git reset --hard'
      if (rest[0] === 'clean' && rest.some(w => /^-[a-zA-Z]*f/.test(w) || w === '--force')) return 'git clean -f'
      if (rest[0] === 'branch' && rest.includes('-D')) return 'git branch -D'
    }
    if (words[0] === 'mkfs' || words[0]?.startsWith('mkfs.') || (words.includes('dd') && words.some(w => w.startsWith('of=/dev/')))) return 'disk overwrite'
  }
  return null
}
