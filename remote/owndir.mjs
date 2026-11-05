// Whether a folder in /tmp is this user's own: a real folder (no link), owned by this user, which no
// one else can read or write. The hub and the dialog hook trust nothing in /tmp/qsb-remote-<uid>
// otherwise: another user could have made it first.
import { lstatSync } from 'node:fs'

export function isOwnDir(path) {
  try {
    const st = lstatSync(path)
    return st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid?.() && (st.mode & 0o077) === 0
  } catch {
    return false
  }
}
