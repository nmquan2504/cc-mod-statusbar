import { ARM_MS } from '../../features/permissions'
import { CLOUDFLARED_DOWNLOAD, answerPairing, checkCloudflared, forgetDevices, hideSession, installCloudflared, remote, spinnerFrame, startRemote, stopRemote, waitedFor } from '../../features/remote'
import { oneLine } from '../../lib/format'
import { qrMatrix, qrRows } from '../../lib/qr'
import { rt } from '../../state/runtime'
import type { Entry } from './entry'

// The Self remote menu: start the hub, the QR code a phone scans, the phones asking to pair,
// the paired ones, and stop. Start and Stop take a second press within ARM_MS.
export async function drawRemoteMenu($: any, els: any, _isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const s = remote.status
  const isArmed = (key: string) => rt.armedRule === key && Date.now() - rt.armedAt < ARM_MS
  const twice = (key: string, what: string, run: () => Promise<unknown>) => async () => {
    if (!isArmed(key)) {
      rt.armedRule = key
      rt.armedAt = Date.now()
      $.ui.toast(`statusbar: press again within 5 s to ${what}`)
      $.ui.invalidate('ui.render')
      return
    }
    rt.armedRule = ''
    await run()
  }

  // a turning spinner, the seconds waited, and how long it usually takes
  const waiting = (what: string, note = 'usually 10 to 20 s; the QR code shows once the address resolves', since = remote.startedAt) => (
    <Text>
      <Text color="claude" bold>{spinnerFrame()}</Text>
      <Text color="claude">{` ${what}…`}</Text>
      <Text dimColor>{`  ${waitedFor(since) ? `${waitedFor(since)}, ` : ''}${note}`}</Text>
    </Text>
  )
  const copy = async (text: string, what: string) => {
    const r = await $.ui.copy({ text }).catch(() => ({ isCopied: false }))
    $.ui.toast(r?.isCopied ? `statusbar: remote: ${what} copied` : 'statusbar: remote: could not copy')
  }

  // cloudflared is missing: install it with Homebrew, or get it another way and look again
  if (!s && (remote.missing || remote.installingAt)) {
    const brew = remote.missing?.brew ?? ''
    return (
      <Box flexDirection="column">
        {remote.installingAt ? waiting('Installing cloudflared with Homebrew', 'usually 30 to 60 s; the remote starts when it is in', remote.installingAt) : (
          <Text color="warning">cloudflared is not installed on this Mac. The remote needs it for the tunnel to your phone.</Text>
        )}
        {remote.installError ? <Text color="error">{`brew install failed: ${remote.installError}`}</Text> : null}
        {!remote.installingAt && brew ? entry('remote-install', 'i', '⇩', isArmed('remote-install') ? 'Press again to install' : 'Install with Homebrew', 'runs brew install cloudflared, then starts the remote', twice('remote-install', 'install cloudflared with Homebrew', () => installCloudflared($)), isArmed('remote-install') ? 'warning' : 'text') : null}
        {!remote.installingAt && !brew ? <Text dimColor>{`Homebrew is not installed either. Get cloudflared from ${CLOUDFLARED_DOWNLOAD} (the darwin .tgz), put it on your PATH, then check again.`}</Text> : null}
        {!remote.installingAt && !brew ? entry('remote-copy-url', 'c', '⧉', 'Copy the download link', 'Cloudflare\'s releases on GitHub', () => copy(CLOUDFLARED_DOWNLOAD, 'download link')) : null}
        {!remote.installingAt && brew ? entry('remote-copy-cmd', 'c', '⧉', 'Copy the command', 'brew install cloudflared, to run it yourself', () => copy('brew install cloudflared', 'command')) : null}
        {!remote.installingAt ? entry('remote-recheck', 'r', '↻', 'Check again', 'after installing it yourself; starts the remote once it is there', () => checkCloudflared($)) : null}
      </Box>
    )
  }

  if (!s) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Opens every Claude Code session on this machine on your phone, through a Cloudflare quick tunnel.</Text>
        <Text dimColor>A phone that scans the code still waits for you to press Allow here, with the code it shows.</Text>
        <Text dimColor>Needs node and cloudflared (brew install cloudflared).</Text>
        {remote.isStarting
          ? waiting('Starting the hub and the tunnel')
          : entry('remote-start', 's', '▶', isArmed('remote-start') ? 'Press again to start' : 'Start the remote', 'one link for every session; it stops after the idle time in Settings', twice('remote-start', 'start the remote', () => startRemote($)), isArmed('remote-start') ? 'warning' : 'text')}
      </Box>
    )
  }

  let rows: string[] = []
  try {
    rows = s.link ? qrRows(qrMatrix(s.link)) : []
    // drawn now: shutting the menu puts it away until asked for again
    if (rows.length && remote.isQrShown) remote.isQrSeen = true
  } catch {
    rows = []
  }
  const age = (at: number) => {
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000))
    return sec < 60 ? `${sec} s ago` : `${Math.round(sec / 60)} min ago`
  }
  return (
    <Box flexDirection="column">
      {s.error ? <Text color="error">{s.error}</Text> : null}
      {!s.url && !s.error ? waiting("Waiting for the tunnel's address") : null}
      {s.isLocked ? <Text color="error">Pairing is locked after 10 wrong links. Stop and start again.</Text> : null}
      {s.pending.map(p => (
        <Box key={`pend:${p.id}`} flexDirection="row" gap={1}>
          <Text color="warning" bold>{`${p.name} asks to pair, code ${p.code}`}</Text>
          <Button key={`allow:${p.id}`} plain onPress={() => answerPairing($, p.id, true)}>
            <Text backgroundColor="success" color="inverseText" bold>{' Allow '}</Text>
          </Button>
          <Button key={`deny:${p.id}`} plain onPress={() => answerPairing($, p.id, false)}>
            <Text backgroundColor="error" color="inverseText" bold>{' Deny '}</Text>
          </Button>
        </Box>
      ))}
      {rows.length > 0 && !remote.isQrShown ? entry('remote-qr', 'q', '▦', 'Show the QR code', 'to pair another phone; it goes away again when the menu shuts', () => {
        remote.isQrShown = true
        $.ui.invalidate('ui.render')
      }) : null}
      {rows.length > 0 && remote.isQrShown && (
        <Box flexDirection="column" marginY={1}>
          {rows.map((row, i) => <Text key={`qr:${i}`} color="#ffffff" backgroundColor="#000000">{row}</Text>)}
        </Box>
      )}
      {s.url ? <Text dimColor>{`${s.url}  ·  the code holds the pairing key; only a phone you allow gets in`}</Text> : null}
      <Text>
        <Text dimColor>Sessions on the link </Text><Text bold>{String(s.sessions)}</Text>
        <Text dimColor>   phones paired </Text><Text bold>{String(s.devices.length)}</Text>
        <Text dimColor>   watching now </Text><Text bold color={s.phones ? 'success' : undefined}>{String(s.phones)}</Text>
        <Text dimColor>   push </Text><Text bold>{String(s.subscriptions)}</Text>
      </Text>
      {s.devices.map((d, i) => <Text key={`dev:${i}`} dimColor>{`  ${oneLine(d.name, 40)}, seen ${age(d.seenAt)}`}</Text>)}
      {s.link ? entry('remote-copy', 'c', '⧉', 'Copy the link', 'to open it on a device without a camera', async () => {
        const r = await $.ui.copy({ text: s.link }).catch(() => ({ isCopied: false }))
        $.ui.toast(r?.isCopied ? 'statusbar: remote: link copied' : 'statusbar: remote: could not copy')
      }) : null}
      {entry('remote-hide', 'h', remote.isHidden ? '◌' : '●', remote.isHidden ? 'Show this session on the phone' : 'Hide this session from the phone', remote.isHidden ? 'it is off the list now' : 'the other sessions stay', () => hideSession($, !remote.isHidden))}
      {s.devices.length > 0 ? entry('remote-forget', 'f', '✕', isArmed('remote-forget') ? 'Press again to forget' : 'Forget the paired phones', 'each must scan and be allowed again', twice('remote-forget', 'forget the paired phones', () => forgetDevices($)), isArmed('remote-forget') ? 'warning' : 'text') : null}
      {entry('remote-stop', 'x', '■', isArmed('remote-stop') ? 'Press again to stop' : 'Stop the remote', 'for every session: the link ends', twice('remote-stop', 'stop the remote', () => stopRemote($)), isArmed('remote-stop') ? 'warning' : 'text')}
    </Box>
  )
}
