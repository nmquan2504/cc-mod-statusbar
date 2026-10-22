import { ENTRY_INDENT } from './entry'
import { atom, read } from 'claude-code'
import { readGuard } from '../../features/guard'
import { closeMenu, openMenu } from '../../features/menu'
import { ARM_MS, ASK_KEY, SUGGESTED_DENY, addAuditHook, addSuggestedDeny, allowRule } from '../../features/permissions'
import type { AskCount } from '../../features/permissions'

import { modeStyle } from '../../lib/catalog'
import { hhmm, oneLine } from '../../lib/format'
import { rt } from '../../state/runtime'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
const bar = atom({ plugin: 'cc-mod-statusbar', key: 'bar' } as const, {
  model: '', effort: null, folder: '', branch: null, dirty: 0, ahead: 0, behind: 0, five: null, week: null, mode: 'manual',
})
const guard = atom({ plugin: 'cc-mod-statusbar', key: 'guard' } as const, {
  deny: [], ask: 0, allow: 0, allowRules: [], sandbox: false, hooks: [], plugins: 0,
})
// The NAMEs of the saved secrets, as the shield menu lists them.
const vault = atom({ plugin: 'cc-mod-statusbar', key: 'vault' } as const, [])
// Every host the session reached out to, for the shield menu's Network list.
const egress = atom({ plugin: 'cc-mod-statusbar', key: 'egress' } as const, [])
// What the guardrails did this session, newest last, for the shield menu.
const audit = atom({ plugin: 'cc-mod-statusbar', key: 'audit' } as const, [])

// The guard menu.
export async function drawGuardMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const g = await read($, guard)
  const saved = await read($, vault)
  const events = await read($, audit)
  const net = await read($, egress)
  const netBlocked = net.reduce((n, r) => n + r.blocked, 0)
  const asks = Object.entries(((await $.store.get(ASK_KEY).catch(() => undefined)) ?? {}) as AskCount)
    .filter(([rule]) => !g.allowRules.includes(rule))
    .sort(([, a], [, b]) => b.n - a.n || b.last - a.last)
    .slice(0, 3)
  const blocks = events.filter(a => a.isBlock).length
  const mode = rt.probedMode ?? rt.hintMode ?? (await read($, bar)).mode
  // the same three checks the bar's ◈ chip counts
  const passed = [g.deny.length > 0, g.hooks.length > 0, mode !== 'bypass'].filter(Boolean).length
  // What would make each check that fails pass, and the advised sandbox: a fix that writes the
  // settings asks for a second press within 5 seconds, as allowing an asked rule does
  const fixes: { key: string; hotkey: string; title: string; note: string; isWrite: boolean; done?: string; run: () => Promise<unknown> }[] = [
    ...(g.deny.length === 0 ? [{
      key: 'fix:deny', hotkey: 'd', title: 'Add the suggested deny rules', isWrite: true,
      note: `${SUGGESTED_DENY.slice(0, 3).join(', ')} and ${SUGGESTED_DENY.length - 3} more: .env, secrets, key files, ~/.ssh, ~/.aws`,
      done: `${SUGGESTED_DENY.length} deny rules added to .claude/settings.local.json`, run: () => addSuggestedDeny($),
    }] : []),
    ...(g.hooks.length === 0 ? [{
      key: 'fix:hook', hotkey: 'h', title: 'Add an audit hook', isWrite: true,
      note: 'PreToolUse: each Bash call appended to .claude/audit.jsonl; it records, blocks nothing',
      done: 'audit hook added to .claude/settings.local.json', run: () => addAuditHook($),
    }, {
      key: 'fix:hooks', hotkey: 'k', title: 'Write your own in /hooks', isWrite: false,
      note: "Claude Code's hook editor", run: async () => { await closeMenu($); await $.command.run({ command: 'hooks' }) },
    }] : []),
    ...(mode === 'bypass' ? [{
      key: 'fix:mode', hotkey: 'm', title: 'Pick a mode that asks', isWrite: false,
      note: 'bypass runs every tool without a prompt', run: () => openMenu($, 'mode'),
    }] : []),
    ...(!g.sandbox ? [{
      key: 'fix:sandbox', hotkey: 'x', title: 'Turn on the sandbox', isWrite: false,
      note: 'advised: Bash runs walled off from your files and network; /sandbox sets it up', run: async () => { await closeMenu($); await $.command.run({ command: 'sandbox' }) },
    }] : []),
  ]
  // A scored check: a green check or a red cross. 'warn': a yellow mark for what is advised,
  // not scored. 'info': a dim dot for a figure that is neither.
  // two cells in from its group's heading, as every menu's rows
  const row = (isOk: boolean | 'warn' | 'info', name: string, detail: string) => (
    <Box key={`row:${name}`} paddingLeft={ENTRY_INDENT}>
      <Text>
        {isOk === 'warn'
          ? <Text color="warning">!</Text>
          : isOk === 'info'
            ? <Text dimColor>·</Text>
            : <Text color={isOk ? 'success' : 'error'}>{isOk ? '✓' : '✗'}</Text>} <Text bold>{name}</Text>
        <Text dimColor>{`  ${detail}`}</Text>
      </Text>
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={passed === 3 ? 'success' : 'error'} bold>{`◈ ${passed}/3 checks pass`}</Text>
        <Text dimColor>  scored: deny rules, settings hooks, a mode other than bypass</Text>
      </Text>
      {fixes.length > 0 && (
        <Text>
          {'\n'}<Text color="warning" bold>◆ To fix</Text>
          <Text dimColor>  a fix that writes .claude/settings.local.json asks for a second press</Text>
        </Text>
      )}
      {fixes.map(f => {
        const isArmed = f.isWrite && rt.armedRule === f.key && Date.now() - rt.armedAt < ARM_MS
        // indented by the row, not the label: a highlighted fix starts at its hotkey
        return (
          <Box key={`row:${f.key}`} paddingLeft={ENTRY_INDENT}>
            <Button key={f.key} plain hotkey={f.hotkey} onPress={async () => {
              if (!f.isWrite) return f.run()
              if (rt.armedRule === f.key && Date.now() - rt.armedAt < ARM_MS) {
                rt.armedRule = ''
                await f.run().then(() => $.ui.toast(`statusbar: ${f.done}`), () => $.ui.toast('statusbar: could not write .claude/settings.local.json'))
                await readGuard($)
              } else {
                rt.armedRule = f.key
                rt.armedAt = Date.now()
                $.ui.toast(`statusbar: press again within 5 s to ${f.title.toLowerCase()}`)
              }
              $.ui.invalidate('ui.render')
            }}>
              <Text color={isArmed ? 'warning' : 'suggestion'} bold>{f.title}</Text>
              <Text dimColor>{`  ${isArmed ? 'press again to write it' : f.note}`}</Text>
            </Button>
          </Box>
        )
      })}
      <Text color="claude" bold>{'\n'}◆ Permissions</Text>
      {row(g.deny.length > 0, 'Deny rules', g.deny.length ? `${g.deny.length}: ${oneLine(g.deny.slice(0, 4).join(', '), 90)}` : 'none: Claude may read any file')}
      {row('info', 'Ask rules', `${g.ask} ask before running`)}
      {row('info', 'Allow rules', `${g.allow} run without asking`)}
      {row(mode !== 'bypass', 'Mode', mode === 'bypass' ? 'bypass permissions: no prompts at all' : modeStyle(mode).note)}
      <Text color="subtle" bold>{'\n'}◇ Enforcement</Text>
      {row(g.sandbox || 'warn', 'Sandbox', g.sandbox ? 'on: Bash runs sandboxed' : 'off: advised, not counted in the score')}
      {row(g.hooks.length > 0, 'Hooks', g.hooks.length ? `on ${g.hooks.join(', ')}` : 'no settings hooks')}
      {row('info', 'Plugins', `${g.plugins} enabled`)}
      {row('info', 'Secret vault', saved.length ? saved.join(', ') : 'nothing saved yet: + then 4, or /secret')}
      {asks.length > 0 && (
        <Text>
          {'\n'}<Text color="subtle" bold>◇ Asked most</Text>
          <Text dimColor>  press one twice to allow it in .claude/settings.local.json</Text>
        </Text>
      )}
      {asks.map(([rule, c], i) => {
        const isArmed = rt.armedRule === rule && Date.now() - rt.armedAt < ARM_MS
        // indented by the row, not the label, as the fixes above
        return (
          <Box key={`row:allow:${rule}`} paddingLeft={ENTRY_INDENT}>
            <Button key={`allow:${rule}`} plain hotkey={String(i + 1)} onPress={async () => {
              if (rt.armedRule === rule && Date.now() - rt.armedAt < ARM_MS) {
                rt.armedRule = ''
                await allowRule($, rule).then(
                  () => $.ui.toast(`statusbar: ${rule} allowed in .claude/settings.local.json`),
                  () => $.ui.toast('statusbar: could not write .claude/settings.local.json'))
                await readGuard($)
              } else {
                rt.armedRule = rule
                rt.armedAt = Date.now()
                $.ui.toast(`statusbar: press again within 5 s to allow ${rule}`)
              }
              $.ui.invalidate('ui.render')
            }}>
              <Text color={isArmed ? 'warning' : 'suggestion'} bold={isArmed}>{rule}</Text>
              <Text dimColor>{`  asked ${c.n}×${isArmed ? '  press again to allow' : ''}`}</Text>
            </Button>
          </Box>
        )
      })}
      <Text>
        {'\n'}<Text color="subtle" bold>◇ This session</Text>
        <Text dimColor>{events.length ? `  ${blocks} blocked or masked, ${events.length - blocks} other` : '  nothing blocked yet'}</Text>
      </Text>
      {events.slice(-5).map((a, i) => (
        <Text key={`ev-${i}`}>
          <Text dimColor>{`  ${hhmm(a.at)} `}</Text>
          <Text color={a.isBlock ? 'error' : 'text'}>{a.line}</Text>
        </Text>
      ))}
      <Text>
        {'\n'}<Text color="subtle" bold>◇ Network</Text>
        <Text dimColor>{net.length
          ? `  ${net.length} host${net.length === 1 ? '' : 's'}, ${net.reduce((n, r) => n + r.count, 0)} calls${netBlocked ? `, ${netBlocked} blocked` : ''}`
          : '  nothing reached out yet'}</Text>
      </Text>
      {[...net].sort((p, q) => q.lastAt - p.lastAt).slice(0, 8).map(r => (
        <Text key={`net:${r.host}`}>
          <Text dimColor>{`  ${hhmm(r.lastAt)} `}</Text>
          <Text color={r.blocked ? 'error' : 'suggestion'}>{oneLine(r.host, 40)}</Text>
          <Text>{`  ${r.count}×`}</Text>
          {r.blocked ? <Text color="error">{` ${r.blocked} blocked`}</Text> : null}
          <Text dimColor>{`  ${r.via.join(', ')}`}</Text>
        </Text>
      ))}
      {net.length > 8 ? <Text dimColor>{`  and ${net.length - 8} more`}</Text> : null}
      {/* the way out to /permissions, a line below the lists */}
      <Box key="row:permissions" marginTop={1}>
        <Button key="permissions" plain hotkey="p" onPress={async () => {
          await closeMenu($)
          await $.command.run({ command: 'permissions' })
        }}>
          <Text color="claude">→ Open /permissions</Text>
        </Button>
      </Box>
    </Box>
  )
}
