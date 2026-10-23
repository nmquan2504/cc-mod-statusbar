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

// Where the install stands: ready, failed (with the log's last line) or running (with its step,
// and how far the model's download is)
const STATUS_SH = [
  'home="${QSB_TTS_HOME:-$HOME/.cache/cc-mod-statusbar/zerotts}"',
  'log="$home/setup.log"',
  'if [ -f "$home/ready" ]; then echo "ready"',
  'elif [ -f "$home/failed" ]; then echo "failed $(tail -c 400 "$log" 2>/dev/null | tr \'\\r\' \'\\n\' | grep -v \'^ *$\' | tail -1)"',
  'elif grep -q "Downloading the model" "$log" 2>/dev/null; then echo "model $(tail -c 300 "$log" | tr \'\\r\' \'\\n\' | grep -o \'[0-9]*%\' | tail -1)"',
  'else echo "python"; fi',
].join('\n')
export async function zeroTtsStatus($: any) {
  const r = await $.process.run(['/bin/sh', '-c', STATUS_SH]).catch(() => undefined)
  const line = String(r?.stdout ?? '').trim()
  const [state = '', ...rest] = line.split(' ')
  return { state, detail: rest.join(' ') }
}

// The voice loaded on the hub, when one runs: { isLoaded, voices, error } or undefined
async function warmZeroTts($: any) {
  return (await hub($, 'POST', '/tts-warm').catch(() => undefined)) as { isLoaded?: boolean; voices?: string[]; error?: string } | undefined
}
const loadedNote = (w: { isLoaded?: boolean; voices?: string[]; error?: string } | undefined) =>
  !w ? 'the remote is off: it loads the voice the first time the phone asks'
    : w.isLoaded ? `loaded on the remote (${w.voices?.length ?? 0} voices)`
      : `the remote could not load it${w.error ? `: ${w.error}` : ''}`

// Starts the install in the background and follows it with a toast at each step, then loads the
// voice on the remote; or, installed already, loads it and says so
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
  if (state === 'ready') return `ZeroTTS is installed in ${home}; ${loadedNote(await warmZeroTts($))}. On the phone it is the default voice (Settings, Automatic).`
  if (state === 'running' || state === 'started') {
    void followInstall($).catch(() => undefined)
    return state === 'running'
      ? `ZeroTTS is installing already; a toast tells each step. Log: ${home}/setup.log.`
      : `Installing ZeroTTS in the background (a Python of its own and about 900 MB of model) in ${home}; a toast tells each step, and the voice loads when it is done. Log: ${home}/setup.log.`
  }
  return `Could not start the install${r?.stderr ? `: ${String(r.stderr).trim().slice(0, 200)}` : '.'}`
}

// A toast at each step of the install (the Python, the model by quarters), then the voice loaded;
// 15 minutes at most
let isFollowing = false
async function followInstall($: any) {
  if (isFollowing) return
  isFollowing = true
  try {
    let said = ''
    for (let i = 0; i < 180; i++) {
      await $.clock.sleep(5000)
      const s = await zeroTtsStatus($)
      if (s.state === 'ready') {
        $.ui.toast('statusbar: ZeroTTS installed; loading the voice…')
        $.ui.toast(`statusbar: ZeroTTS ready, ${loadedNote(await warmZeroTts($))}`)
        return
      }
      if (s.state === 'failed') return $.ui.toast(`statusbar: ZeroTTS install failed: ${s.detail || 'see setup.log'}`)
      const pct = Number.parseInt(s.detail, 10)
      const step = s.state === 'model' ? `downloading the model${Number.isFinite(pct) ? ` ${Math.floor(pct / 25) * 25}%` : ''}` : 'installing its Python'
      if (step !== said) $.ui.toast(`statusbar: ZeroTTS: ${step}`)
      said = step
    }
  } finally {
    isFollowing = false
  }
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
