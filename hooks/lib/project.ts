// The folder the session started in, as the bar, the menus and the phone show it: Claude Code's
// project root, which a shell `cd` in a Bash call does not move (only /cd, a host's directory change
// or a worktree move does). $.session.cwd() follows the shell, so the folder chip used to jump to
// wherever Claude last cd'ed. An engine without root() gives the cwd.
export async function projectDir($: any): Promise<string> {
  try {
    const root: string = await $.session.root()
    if (root) return root
  } catch {}
  return $.session.cwd()
}
