import { ENTRY_INDENT } from './entry'
import { atom, read } from 'claude-code'
import { readGuard } from '../../features/guard'
import { closeMenu, openMenu } from '../../features/menu'
import { ARM_MS, ASK_KEY, SUGGESTED_DENY, addAuditHook, addSuggestedDeny, allowRule, setMcpRule } from '../../features/permissions'
import type { AskCount, McpRule } from '../../features/permissions'
import { GUARDRAILS, egressHosts, guardScore, guardState } from '../../features/guardrails'
import { groupHooks, groupRules } from '../../lib/guardclass'
import { SCOPES, scopeFile, scopeNow } from '../../features/settingsfile'
import type { RuleScope } from '../../features/settingsfile'
import { cfg, saveSettings } from '../../state/config'
import type { CfgKey } from '../../state/config'

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
// The MCP servers connected now, with their tools, for MCP access
const mcpServers = atom({ plugin: 'cc-mod-statusbar', key: 'mcpServers' } as const, [])

// The guard menu.
export async function drawGuardMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
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
  // the guardrails switched on that pass, of those switched on: what the bar's ◈ chip counts
  const score = guardScore(g, mode)
  const file = scopeFile[scopeNow()]
  const servers = (await read($, mcpServers)).filter(r => !r.needsAuth)
  // What would make each check that fails pass, and the advised sandbox: a fix that writes the
  // settings asks for a second press within 5 seconds, as allowing an asked rule does
  const fixes: { key: string; hotkey: string; title: string; note: string; isWrite: boolean; done?: string; run: () => Promise<unknown> }[] = [
    ...(cfg.guardDeny && g.deny.length === 0 ? [{
      key: 'fix:deny', hotkey: 'd', title: 'Add the suggested deny rules', isWrite: true,
      note: `${SUGGESTED_DENY.slice(0, 3).join(', ')} and ${SUGGESTED_DENY.length - 3} more: .env, secrets, key files, ~/.ssh, ~/.aws`,
      done: `${SUGGESTED_DENY.length} deny rules added to ${file}`, run: () => addSuggestedDeny($),
    }] : []),
    ...(cfg.guardHooks && g.hooks.length === 0 ? [{
      key: 'fix:hook', hotkey: 'h', title: 'Add an audit hook', isWrite: true,
      note: 'PreToolUse: each Bash call appended to .claude/audit.jsonl; it records, blocks nothing',
      done: `audit hook added to ${file}`, run: () => addAuditHook($),
    }, {
      key: 'fix:hooks', hotkey: 'k', title: 'Write your own in /hooks', isWrite: false,
      note: "Claude Code's hook editor", run: async () => { await closeMenu($); await $.command.run({ command: 'hooks' }) },
    }] : []),
    ...(cfg.guardMode && mode === 'bypass' ? [{
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
  // a switch flipped, saved for every session; the bar's score follows
  const flip = async (key: CfgKey) => {
    ;(cfg as Record<string, unknown>)[key] = !cfg[key]
    await saveSettings($)
  }
  // an MCP server's or tool's rule as the merged settings have it
  const ruleOf = (rule: string): McpRule => (g.deny.includes(rule) ? 'deny' : g.allowRules.includes(rule) ? 'allow' : 'default')
  const NEXT_RULE: Record<McpRule, McpRule> = { default: 'allow', allow: 'deny', deny: 'default' }
  const ruleButton = (rule: string, label: string, detail: string, onOpen?: () => void) => {
    const now = ruleOf(rule)
    return (
      <Box key={`row:mcp:${rule}`} flexDirection="row" gap={1} paddingLeft={ENTRY_INDENT}>
        <Button key={`mcprule:${rule}`} plain onPress={async () => {
          const to = NEXT_RULE[now]
          await setMcpRule($, rule, to).then(
            written => $.ui.toast(`statusbar: ${rule}: ${to === 'default' ? 'no rule' : to} in ${written}${scopeNow() === 'project' ? ' (shared through git)' : ''}`),
            () => $.ui.toast(`statusbar: could not write ${file}`))
          await readGuard($)
        }}>
          <Text color={now === 'deny' ? 'error' : now === 'allow' ? 'success' : 'subtle'} bold>{now === 'deny' ? '[⊘ deny ]' : now === 'allow' ? '[✓ allow]' : '[default]'}</Text>
        </Button>
        {onOpen
          ? <Button key={`mcpopen:${rule}`} plain onPress={onOpen}><Text bold>{label}</Text><Text dimColor>{`  ${detail}`}</Text></Button>
          : <Text><Text>{label}</Text><Text dimColor>{detail ? `  ${detail}` : ''}</Text></Text>}
      </Box>
    )
  }
  const mcpSection = (
    <Box key="sec:mcp" flexDirection="column">
      <Text>
        {'\n'}<Text color="claude" bold>◆ MCP access</Text>
        <Text dimColor>{`  a press steps default → allow → deny (default: the mode decides); written to ${file}`}</Text>
      </Text>
      {servers.length ? null : <Text dimColor>{'  no MCP server connected'}</Text>}
      {servers.map(s => {
        const isOpen = rt.mcpOpen.has(s.key)
        const tools = s.toolNames ?? []
        const deniedTools = tools.filter(t => ruleOf(`mcp__${s.key}__${t}`) === 'deny').length
        return (
          <Box key={`mcpsrv:${s.key}`} flexDirection="column">
            {ruleButton(`mcp__${s.key}`, `${isOpen ? '▾' : '▸'} ${s.name}`, `${s.tools} tool${s.tools === 1 ? '' : 's'}${deniedTools ? `, ${deniedTools} denied` : ''}`, () => {
              if (isOpen) rt.mcpOpen.delete(s.key)
              else rt.mcpOpen.add(s.key)
              $.ui.invalidate('ui.render')
            })}
            {isOpen ? tools.map(tool => (
              <Box key={`mcptool:${s.key}:${tool}`} paddingLeft={ENTRY_INDENT}>{ruleButton(`mcp__${s.key}__${tool}`, tool, '')}</Box>
            )) : null}
          </Box>
        )
      })}
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={score.isAlert ? 'error' : 'success'} bold>{`◈ ${score.ok}/${score.of} on and passing`}</Text>
        <Text dimColor>  rules go to</Text>
        {SCOPES.map((sc: RuleScope) => (
          <Button key={`scope:${sc}`} plain onPress={async () => {
            cfg.ruleScope = sc
            await saveSettings($)
          }}>
            <Text backgroundColor={sc === scopeNow() ? 'claude' : 'subtle'} color="inverseText" bold>{` ${sc} `}</Text>
          </Button>
        ))}
        <Text dimColor>{file}</Text>
      </Box>
      {rt.guardSection === 'mcp' ? mcpSection : null}
      {fixes.length > 0 && (
        <Text>
          {'\n'}<Text color="warning" bold>◆ To fix</Text>
          <Text dimColor>{`  a fix that writes ${file} asks for a second press`}</Text>
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
                await f.run().then(() => $.ui.toast(`statusbar: ${f.done}`), () => $.ui.toast(`statusbar: could not write ${file}`))
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
      <Text>
        {'\n'}<Text color="claude" bold>◆ Guardrails</Text>
        <Text dimColor>  a press switches one on or off; one off is not counted</Text>
      </Text>
      {GUARDRAILS.map(r => {
        const st = guardState(r, g, mode)
        const isOn = st.state !== 'off'
        // under deny rules and hooks, what each one is for, a line a kind
        const detail = !isOn ? [] : r.id === 'deny'
          ? groupRules(g.deny).map(x => ({ key: x.kind, title: x.title, n: x.rules.length, text: x.rules.join(', ') }))
          : r.id === 'hooks'
            ? groupHooks(g.hookList ?? []).map(x => ({ key: x.purpose, title: x.title, n: x.hooks.length, text: x.hooks.map(hk => `${hk.event}${hk.matcher ? ` ${hk.matcher}` : ''}: ${hk.command}`).join(' · ') }))
            : []
        return (
          <Box key={`row:gr:${r.id}`} flexDirection="column" paddingLeft={ENTRY_INDENT}>
            <Button key={`gr:${r.id}`} plain onPress={() => flip(r.key)}>
              <Text color={isOn ? 'success' : 'inactive'} bold>{isOn ? '[on] ' : '[off]'}</Text>
              {' '}{st.state === 'fail'
                ? <Text color="error">✗</Text>
                : st.state === 'warn'
                  ? <Text color="warning">!</Text>
                  : st.state === 'pass' ? <Text color="success">✓</Text> : <Text dimColor>·</Text>}
              {' '}<Text bold>{r.title}</Text>
              <Text dimColor>{`  ${isOn ? st.note : r.what}`}</Text>
            </Button>
            {detail.map(d => (
              <Text key={`gd:${r.id}:${d.key}`}>
                {'        '}<Text color="suggestion">{`${d.title} ${d.n}`}</Text>
                <Text dimColor>{`  ${oneLine(d.text, 110)}`}</Text>
              </Text>
            ))}
          </Box>
        )
      })}
      {cfg.guardEgress ? (
        <Box key="sec:allow" flexDirection="column">
          <Text dimColor>{'  allowed hosts (a name covers its subdomains; ✕ takes one off):'}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={ENTRY_INDENT}>
            {/* never `h` here: JSX compiles to h(...), which a parameter of that name would hide */}
            {egressHosts().map(host => (
              <Button key={`host:${host}`} plain onPress={async () => {
                cfg.egressHosts = egressHosts().filter(x => x !== host).join(',')
                await saveSettings($)
              }}>
                <Text color="suggestion">{host}</Text><Text dimColor> ✕</Text>
              </Button>
            ))}
          </Box>
        </Box>
      ) : null}
      {rt.guardSection === 'mcp' ? null : mcpSection}
      <Text color="claude" bold>{'\n'}◆ Permissions</Text>
      {row(g.deny.length > 0 || 'info', 'Deny rules', g.deny.length ? `${g.deny.length}: ${oneLine(g.deny.slice(0, 4).join(', '), 90)}` : 'none: Claude may read any file')}
      {row('info', 'Ask rules', `${g.ask} ask before running`)}
      {row('info', 'Allow rules', `${g.allow} run without asking`)}
      {row(mode !== 'bypass' || 'info', 'Mode', mode === 'bypass' ? 'bypass permissions: no prompts at all' : modeStyle(mode).note)}
      {row(g.sandbox || 'warn', 'Sandbox', g.sandbox ? 'on: Bash runs sandboxed' : 'off: advised')}
      {row(g.hooks.length > 0 || 'info', 'Hooks', g.hooks.length ? `on ${g.hooks.join(', ')}` : 'no settings hooks')}
      {row('info', 'Plugins', `${g.plugins} enabled`)}
      {row('info', 'Secret vault', saved.length ? saved.join(', ') : 'nothing saved yet: + then 4, or /secret')}
      {asks.length > 0 && (
        <Text>
          {'\n'}<Text color="subtle" bold>◇ Asked most</Text>
          <Text dimColor>{`  press one twice to allow it in ${file}`}</Text>
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
                  () => $.ui.toast(`statusbar: ${rule} allowed in ${file}`),
                  () => $.ui.toast(`statusbar: could not write ${file}`))
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
