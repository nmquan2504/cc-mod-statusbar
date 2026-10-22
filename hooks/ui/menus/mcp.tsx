import { atom, read } from 'claude-code'
import { checkMcp } from '../../features/mcp'
import { closeMenu } from '../../features/menu'

import { hhmm, oneLine } from '../../lib/format'
import { rt } from '../../state/runtime'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// The MCP servers: those connected, from the tool list; every configured one with its health,
// from the last `claude mcp list`; and each server's calls this session.
const mcpServers = atom({ plugin: 'cc-mod-statusbar', key: 'mcpServers' } as const, [])
const mcpCheck = atom({ plugin: 'cc-mod-statusbar', key: 'mcpCheck' } as const, null)
const mcpCalls = atom({ plugin: 'cc-mod-statusbar', key: 'mcpCalls' } as const, [])

// The mcp menu.
export async function drawMcpMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
  const { Box, Button, Text } = els
  const live = await read($, mcpServers)
  const check = await read($, mcpCheck)
  const calls = await read($, mcpCalls)
  const on = live.filter(r => !r.needsAuth)
  const auth = live.filter(r => r.needsAuth)
  const failed = check?.rows.filter(r => r.status === 'failed') ?? []
  const callsOf = (key: string) => calls.find(c => c.key === key)
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="claude" bold>◆ Connected</Text>
        <Text dimColor>{`  ${on.length} servers, ${on.reduce((n, r) => n + r.tools, 0)} tools`}</Text>
      </Text>
      {on.map(r => {
        const c = callsOf(r.key)
        return (
          <Text key={`mcp:${r.key}`}>
            {'  '}<Text color="success">●</Text> <Text bold>{oneLine(r.name, 40).padEnd(30)}</Text>
            <Text dimColor>{`${String(r.tools).padStart(3)} tools`}</Text>
            {c ? <Text>{`  ${c.calls} call${c.calls === 1 ? '' : 's'}`}</Text> : null}
            {c?.errors ? <Text color="error">{` · ${c.errors} failed`}</Text> : null}
          </Text>
        )
      })}
      {auth.length ? (
        <Text>
          {'\n'}<Text color="warning" bold>◇ Needs sign-in</Text>
          <Text dimColor>{`  ${auth.length}: ${oneLine(auth.map(r => r.name.replace(/^claude\.ai /, '')).join(', '), 110)}`}</Text>
        </Text>
      ) : null}
      <Text>
        {'\n'}<Text color={failed.length ? 'error' : 'subtle'} bold>◇ Failed</Text>
        <Text dimColor>{check
          ? `  ${failed.length ? failed.length : 'none'} at the last check, ${hhmm(check.at)} (${check.rows.length} configured)`
          : '  not checked yet: press c'}</Text>
      </Text>
      {failed.map(r => (
        <Text key={`fail:${r.name}`}>
          {'  '}<Text color="error">✘</Text> <Text bold>{r.name}</Text>
          <Text dimColor>{`  ${oneLine(r.detail || r.target, 90)}`}</Text>
        </Text>
      ))}
      <Button key="mcp:check" plain hotkey="c" onPress={() => checkMcp($)}>
        <Text color="claude">{rt.isCheckingMcp ? '… checking every server (about 12 s)' : '→ Check every server (claude mcp list)'}</Text>
      </Button>
      <Button key="mcp:open" plain hotkey="m" onPress={async () => {
        await closeMenu($)
        await $.command.run({ command: 'mcp' })
      }}>
        <Text color="claude">→ Open /mcp to sign in, reconnect or turn one off</Text>
      </Button>
    </Box>
  )
}
