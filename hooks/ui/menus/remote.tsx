import { ARM_MS } from '../../features/permissions'
import { answerPairing, forgetDevices, hideSession, remote, startRemote, stopRemote } from '../../features/remote'
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

  if (!s) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Opens every Claude Code session on this machine on your phone, through a Cloudflare quick tunnel.</Text>
        <Text dimColor>A phone that scans the code still waits for you to press Allow here, with the code it shows.</Text>
        <Text dimColor>Needs node and cloudflared (brew install cloudflared).</Text>
        {remote.isStarting
          ? <Text color="claude">Starting the hub and the tunnel…</Text>
          : entry('remote-start', 's', '▶', isArmed('remote-start') ? 'Press again to start' : 'Start the remote', 'one link for every session; it stops after the idle time in Settings', twice('remote-start', 'start the remote', () => startRemote($)), isArmed('remote-start') ? 'warning' : 'text')}
      </Box>
    )
  }

  let rows: string[] = []
  try {
    rows = s.link ? qrRows(qrMatrix(s.link)) : []
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
      {!s.url && !s.error ? <Text color="claude">Waiting for the tunnel's address…</Text> : null}
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
      {rows.length > 0 && (
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
