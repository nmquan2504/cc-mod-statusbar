// ZeroTTS, the phone's Vietnamese voice made on the Mac. /zerotts-install runs remote/zerotts-setup.sh
// in the background: a Python of its own and the model, about 900 MB, under
// ~/.cache/cc-mod-statusbar/zerotts. The hub starts the voice the first time the phone asks for it
// (remote/tts.py), and the phone picks it in its Settings. /zerotts-uninstall stops the voice and
// an install still running, and deletes that folder; the phone goes back to its own voices.
// Both stay at the computer: from the phone they are refused with a note.
import { hub } from './remote'

export async function zeroTtsSessionStart($: any) {
  await $.command.register({ name: 'zerotts-install', description: 'Install ZeroTTS (about 900 MB) so the phone reads Vietnamese in a voice made on the Mac' })
  await $.command.register({ name: 'zerotts-uninstall', description: "Remove ZeroTTS from the Mac; the phone goes back to its own voices" })
}

// Starts the install in the background, or says it is in already; the log is setup.log beside it
export async function installZeroTts($: any) {
  const script = `${$.plugin.root}/remote/zerotts-setup.sh`
  const sh = [
    'home="${QSB_TTS_HOME:-$HOME/.cache/cc-mod-statusbar/zerotts}"',
    'mkdir -p "$home"',
    '[ -f "$home/ready" ] && { echo "ready $home"; exit 0; }',
    'pgrep -f zerotts-setup.sh >/dev/null && { echo "running $home"; exit 0; }',
    'nohup sh "$0" >"$home/setup.log" 2>&1 </dev/null &',
    'echo "started $home"',
  ].join('\n') // lines: a ; after the & that sends the setup off is a syntax error
  const r = await $.process.run(['/bin/sh', '-c', sh, script]).catch(() => undefined)
  const [state, home] = String(r?.stdout ?? '').trim().split(' ')
  if (state === 'ready') return `ZeroTTS is installed in ${home}. On the phone, pick it in Settings, Vietnamese voice.`
  if (state === 'running') return `ZeroTTS is installing already; see ${home}/setup.log.`
  if (state === 'started') return `Installing ZeroTTS in the background (a Python of its own and about 900 MB of model) in ${home}; a few minutes. Follow ${home}/setup.log. When it is done, pick it on the phone in Settings, Vietnamese voice.`
  return `Could not start the install${r?.stderr ? `: ${String(r.stderr).trim().slice(0, 200)}` : '.'}`
}

// Stops the voice (the hub, when one runs) and an install still running, then deletes the folder.
// Only a folder whose name is zerotts goes, so a QSB_TTS_HOME set to something else is left alone.
export async function uninstallZeroTts($: any) {
  await hub($, 'POST', '/tts-stop').catch(() => undefined)
  const sh = [
    'home="${QSB_TTS_HOME:-$HOME/.cache/cc-mod-statusbar/zerotts}"',
    'case "$home" in */zerotts) ;; *) echo "refused $home"; exit 0 ;; esac',
    '[ -d "$home" ] || { echo "none $home"; exit 0; }',
    'pkill -f zerotts-setup.sh 2>/dev/null; pkill -f "remote/tts.py" 2>/dev/null',
    'size=$(du -sh "$home" 2>/dev/null | cut -f1)',
    'rm -rf "$home"',
    'echo "removed $home $size"',
  ].join('\n')
  const r = await $.process.run(['/bin/sh', '-c', sh]).catch(() => undefined)
  const [state, home, size] = String(r?.stdout ?? '').trim().split(' ')
  if (state === 'removed') return `ZeroTTS removed from ${home}${size ? ` (${size} freed)` : ''}. The phone reads with its own voices again.`
  if (state === 'none') return `ZeroTTS is not installed (no ${home}).`
  if (state === 'refused') return `Not removed: ${home} is not a folder named zerotts.`
  return `Could not remove ZeroTTS${r?.stderr ? `: ${String(r.stderr).trim().slice(0, 200)}` : '.'}`
}
