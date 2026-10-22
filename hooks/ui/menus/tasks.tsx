import { atom, read } from 'claude-code'
import { insertText } from '../../features/menu'
import { LOG_ERROR, SCAN_LINES, askAboutTask, frameworkOf, healthOf, holderOf, rerunTask, stopPid, stopTask, tailTask } from '../../features/work'
import { closeMenu } from '../../features/menu'
import { ARM_MS } from '../../features/permissions'
import { ENTRY_INDENT } from './entry'

import { clockOf, hhmm, mention, oneLine } from '../../lib/format'
import { rt } from '../../state/runtime'
import type { Entry } from './entry'

// The atoms this file reads or writes (each file declares its own: the engine reads an atom only
// where a const of the same file made it; the same plugin and key are the same value).
// What Claude is working through, for the tasks menu Claude's ✻ opens: its task list (from
// TaskCreate, TaskUpdate, TodoWrite and TaskList) and the agents running for it.
const tasks = atom({ plugin: 'cc-mod-statusbar', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'cc-mod-statusbar', key: 'agents' } as const, [])
const servers = atom({ plugin: 'cc-mod-statusbar', key: 'servers' } as const, [])
// The files the main loop wrote this turn, with the lines each call added and removed.
const edited = atom({ plugin: 'cc-mod-statusbar', key: 'edited' } as const, [])
// The last long turn, as Haiku summed it up: what was done and how it came out.
const lastTurn = atom({ plugin: 'cc-mod-statusbar', key: 'lastTurn' } as const, null)

// The tasks menu.
export async function drawTasksMenu($: any, els: any, isTerminal: boolean, entry: Entry) {
  const { Box, Button, Text } = els
  const list = await read($, tasks)
  const files = await read($, edited)
  const root: string = await $.session.cwd().catch(() => '')
  const rel = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
  const listening = await read($, servers)
  const all = await read($, agents)
  const crew = all.filter(a => ['pending', 'running', 'waiting'].includes(a.status))
  // the agents shown: those running, then the last three that finished and left a log
  const finished = all.filter(a => !crew.includes(a) && rt.agentLog[a.id]).slice(-3)
  const shown = [...crew, ...finished]
  // a press opens a row's detail and a second shuts it
  const toggle = (key: string) => {
    rt.openDetail = rt.openDetail === key ? '' : key
    if (!rt.openDetail.startsWith('bg:')) rt.isLogFollow = false
    $.ui.invalidate('ui.render')
  }
  // the background command a server came from: its port, or its program, in the command line
  const taskOf = (sv: { port: number; command: string }) => {
    const program = (sv.command.split('/').pop() ?? '').split(' ')[0] ?? ''
    return [...rt.bgTasks].reverse().find(t => t.command.includes(String(sv.port)) || (program.length > 2 && program !== 'node' && t.command.includes(program)))
  }
  const openTask = rt.openDetail.startsWith('bg:') ? rt.openDetail.slice(3) : ''
  const holders = new Map<number, { pid: number; program: string } | undefined>()
  for (const t of rt.bgTasks) if (t.busyPort && !holders.has(t.busyPort)) holders.set(t.busyPort, await holderOf($, t.busyPort))
  if (openTask) {
    const seen = rt.bgTasks.find(t => t.id === openTask)
    if (seen) seen.isSeen = true
  }
  // a stop takes a second press within ARM_MS
  const isArmed = (key: string) => rt.armedRule === key && Date.now() - rt.armedAt < ARM_MS
  const stop = async (key: string, what: string, run: () => Promise<boolean>) => {
    if (!isArmed(key)) {
      rt.armedRule = key
      rt.armedAt = Date.now()
      $.ui.toast(`statusbar: press again within 5 s to stop ${what}`)
      $.ui.invalidate('ui.render')
      return
    }
    rt.armedRule = ''
    $.ui.toast(await run() ? `statusbar: stopped ${what}` : `statusbar: could not stop ${what}`)
    $.ui.invalidate('ui.render')
  }
  const stopChip = (key: string) => (
    <Text backgroundColor={isArmed(key) ? 'error' : 'subtle'} color="inverseText" bold>{isArmed(key) ? ' ■ stop: again ' : ' ■ stop '}</Text>
  )
  // the open log: its last 15 lines, or its last 15 error lines when filtered
  const tail = !openTask ? null : rt.isLogErrorsOnly
    ? (await tailTask($, openTask, SCAN_LINES))?.filter(line => LOG_ERROR.test(line)).slice(-15) ?? null
    : await tailTask($, openTask)
  const logLines = (id: string) => id !== openTask ? null : (
    <Box key={`log:${id}`} flexDirection="column" paddingLeft={ENTRY_INDENT + 2}>
      {tail && tail.some(Boolean) ? (
        <Button key={`bglog@:${id}`} plain onPress={() => {
          const task = rt.bgTasks.find(t => t.id === id)
          return insertText($, `The log of \`${task?.command ?? id}\`, its last ${tail.length} lines:\n\`\`\`\n${tail.join('\n')}\n\`\`\`\n`)
        }}>
          <Text backgroundColor="subtle" color="inverseText" bold>{' @ '}</Text>
          <Text dimColor>  put these lines in the prompt</Text>
        </Button>
      ) : null}
      <Button key={`bgfollow:${id}`} plain onPress={() => {
        rt.isLogFollow = !rt.isLogFollow
        $.ui.invalidate('ui.render')
      }}>
        <Text backgroundColor={rt.isLogFollow ? 'success' : 'subtle'} color="inverseText" bold>{rt.isLogFollow ? ' ● following ' : ' follow '}</Text>
        <Text dimColor>{rt.isLogFollow ? '  the newest lines, every second; a press stops' : '  keeps the newest lines in view, every second'}</Text>
      </Button>
      <Button key={`bgfilter:${id}`} plain onPress={() => {
        rt.isLogErrorsOnly = !rt.isLogErrorsOnly
        $.ui.invalidate('ui.render')
      }}>
        <Text backgroundColor={rt.isLogErrorsOnly ? 'error' : 'subtle'} color="inverseText" bold>{rt.isLogErrorsOnly ? ' errors only ' : ' all lines '}</Text>
        <Text dimColor>{rt.isLogErrorsOnly ? '  a press shows every line' : '  a press shows the error lines alone'}</Text>
      </Button>
      {tail === null ? <Text dimColor>its log cannot be read (the session's tasks folder holds none for it)</Text>
        : tail.length === 0 || (tail.length === 1 && !tail[0]) ? <Text dimColor>{rt.isLogErrorsOnly ? 'no error line' : 'nothing logged yet'}</Text>
          : tail.map((line, i) => <Text key={`ll:${id}:${i}`} dimColor>{oneLine(line, 110) || ' '}</Text>)}
    </Box>
  )
  const mark = (status: string) =>
    status === 'completed' ? <Text color="success">✓</Text>
      : status === 'in_progress' ? <Text color="claude" bold>▸</Text>
        : <Text dimColor>○</Text>
  const done = list.filter(t => t.status === 'completed').length
  const turn = await read($, lastTurn)
  return (
    <Box flexDirection="column">
      {turn ? (
        <Box key="last-turn" flexDirection="column" marginBottom={1}>
          <Text>
            <Text color="claude" bold>◆ Last turn</Text>
            <Text dimColor>{`  ${hhmm(turn.at)} · ${clockOf(turn.took)}${turn.cost !== null ? ` · $${turn.cost.toFixed(2)}` : ''}  ${turn.prompt}`}</Text>
          </Text>
          <Text>{'  '}<Text bold>Did</Text>{`     ${turn.did}`}</Text>
          {turn.result ? <Text>{'  '}<Text bold>Result</Text>{`  ${turn.result}`}</Text> : null}
        </Box>
      ) : null}
      <Text>
        <Text color="claude" bold>◆ Now</Text>
        <Text>{`  ${rt.nowTool || (rt.isBusy ? 'thinking' : 'idle')}`}</Text>
      </Text>
      <Text>
        {'\n'}<Text color="claude" bold>◆ Tasks</Text>
        <Text dimColor>{list.length ? `  ${done}/${list.length} done` : '  none: Claude has not made a task list this session'}</Text>
      </Text>
      {list.map(t => (
        <Text key={`t:${t.id}`}>
          {'  '}{mark(t.status)} <Text bold={t.status === 'in_progress'} dimColor={t.status === 'completed'}>{oneLine(t.subject, 100)}</Text>
        </Text>
      ))}
      <Text>
        {'\n'}<Text color="subtle" bold>◇ Edited this turn</Text>
        <Text dimColor>{files.length ? `  ${files.length} file(s): a pick puts it in the prompt, o opens the last in your editor` : '  nothing yet'}</Text>
      </Text>
      {files.map(f => (
        <Button key={`e:${f.path}`} plain onPress={() => insertText($, mention(rel(f.path)))}>
          {'  '}<Text>{rel(f.path)}</Text>
          <Text color="success">{`  +${f.added}`}</Text>
          <Text color="error">{` −${f.removed}`}</Text>
        </Button>
      ))}
      {files.length > 0 && (
        <Button key="open-last" plain hotkey="o" onPress={async () => {
          const last = files[files.length - 1]!
          const r = await $.process.run(['code', '-g', last.path]).catch(() => undefined)
          if (r?.exitCode !== 0) await $.process.run(['open', last.path]).catch(() => undefined)
        }}>
          <Text color="claude">→ Open {rel(files[files.length - 1]!.path)}</Text>
        </Button>
      )}
      <Text>
        {'\n'}<Text color="subtle" bold>◇ Agents</Text>
        <Text dimColor>{crew.length ? `  ${crew.length} running; a press shows what one did` : shown.length ? '  none running; a press shows what one did' : '  none running'}</Text>
      </Text>
      {shown.map(a => {
        const log = rt.agentLog[a.id]
        const isOpen = rt.openDetail === `agent:${a.id}`
        const took = log ? clockOf((log.endedAt ?? Date.now()) - log.startedAt) : ''
        return (
          <Box key={`agentrow:${a.id}`} flexDirection="column">
            <Box paddingLeft={ENTRY_INDENT}>
              <Button key={`agent:${a.id}`} plain onPress={() => toggle(`agent:${a.id}`)}>
                <Text dimColor>{isOpen ? '▾ ' : '▸ '}</Text>
                <Text color="suggestion">{a.type}</Text> <Text>{oneLine(a.description, 70)}</Text>
                <Text dimColor>{`  ${a.status}${log ? ` · ${took} · ${log.tools.length} tool${log.tools.length === 1 ? '' : 's'}` : ''}`}</Text>
              </Button>
            </Box>
            {isOpen ? (
              <Box key={`agentlog:${a.id}`} flexDirection="column" paddingLeft={ENTRY_INDENT + 2}>
                {!log || log.tools.length === 0 ? <Text dimColor>no tool call seen yet</Text>
                  : log.tools.slice(-8).map((tool, i) => <Text key={`at:${a.id}:${i}`} dimColor>{`· ${oneLine(tool, 100)}`}</Text>)}
                {log?.answer ? <Text><Text bold>Answer</Text>{`  ${oneLine(log.answer, 300)}`}</Text> : null}
              </Box>
            ) : null}
          </Box>
        )
      })}
      <Text>
        {'\n'}<Text color="subtle" bold>◇ Servers</Text>
        <Text dimColor>{listening.length ? `  ${listening.length} listening: a click opens it` : '  none listening'}</Text>
      </Text>
      {listening.map(sv => {
        const task = taskOf(sv)
        return (
          <Box key={`srvrow:${sv.port}`} flexDirection="column">
            <Box flexDirection="row" gap={1} paddingLeft={ENTRY_INDENT}>
              <Button key={`srv:${sv.port}`} plain onPress={async () => {
                const url = `http://localhost:${sv.port}`
                const r = await $.process.run(['open', url]).catch(() => undefined)
                if (!r || r.exitCode !== 0) await $.process.run(['xdg-open', url]).catch(() => undefined)
              }}>
                <Text color={healthOf(rt.serverHealth[sv.port]?.code)?.isBad ? 'error' : 'suggestion'} bold>{`:${sv.port}`.padEnd(7)}</Text>
                {frameworkOf(sv.command, task?.command ?? '') ? <Text bold>{`${frameworkOf(sv.command, task?.command ?? '')}  `}</Text> : null}
                <Text dimColor={Boolean(frameworkOf(sv.command, task?.command ?? ''))}>{oneLine(sv.command.split('/').pop() ?? sv.command, 60)}</Text>
                {healthOf(rt.serverHealth[sv.port]?.code) ? (
                  <Text color={healthOf(rt.serverHealth[sv.port]?.code)!.isBad ? 'error' : 'success'} dimColor={!healthOf(rt.serverHealth[sv.port]?.code)!.isBad}>
                    {`  ${healthOf(rt.serverHealth[sv.port]?.code)!.text} ${hhmm(rt.serverHealth[sv.port]!.at)}`}
                  </Text>
                ) : null}
              </Button>
              {task ? (
                <Button key={`srvlog:${sv.port}`} plain onPress={() => toggle(`bg:${task.id}`)}>
                  <Text backgroundColor={openTask === task.id ? 'claude' : 'subtle'} color="inverseText" bold>{' log '}</Text>
                </Button>
              ) : null}
              <Button key={`srvstop:${sv.port}`} plain onPress={() => stop(`srvstop:${sv.port}`, `:${sv.port}`, () => (task ? stopTask($, task.id) : stopPid($, sv.pid)))}>
                {stopChip(`srvstop:${sv.port}`)}
              </Button>
            </Box>
            {task ? logLines(task.id) : null}
          </Box>
        )
      })}
      <Text>
        {'\n'}<Text color="subtle" bold>◇ Background commands</Text>
        <Text dimColor>{rt.bgTasks.length ? `  ${rt.bgTasks.length} this session; a press shows its last lines` : '  none this session'}</Text>
      </Text>
      {[...rt.bgTasks].reverse().slice(0, 5).map(t => (
        <Box key={`bgrow:${t.id}`} flexDirection="column">
          <Box paddingLeft={ENTRY_INDENT}>
            <Box flexDirection="row" gap={1}>
              <Button key={`bg:${t.id}`} plain onPress={() => toggle(`bg:${t.id}`)}>
                <Text dimColor>{openTask === t.id ? '▾ ' : '▸ '}</Text>
                <Text>{oneLine(t.command, 70)}</Text>
                <Text dimColor>{`  ${hhmm(t.at)}`}</Text>
                <Text color={t.status === 'failed' || t.errorLine ? 'error' : t.status ? 'inactive' : 'success'}>
                  {`  ${t.status ?? (t.errorLine ? 'running, error in log' : 'running')}`}
                </Text>
                {t.errorCount ? <Text color="error">{` · ${t.errorCount} error${t.errorCount === 1 ? '' : 's'}`}</Text> : null}
              </Button>
              {t.status ? (
                <Button key={`bgrerun:${t.id}`} plain onPress={async () => {
                  $.ui.toast(await rerunTask($, t.id) ? `statusbar: running ${oneLine(t.command, 30)} again` : `statusbar: could not run ${oneLine(t.command, 30)} again`)
                  $.ui.invalidate('ui.render')
                }}>
                  <Text backgroundColor="subtle" color="inverseText" bold>{' ↻ rerun '}</Text>
                </Button>
              ) : null}
              {!t.status ? (
                <Button key={`bgstop:${t.id}`} plain onPress={() => stop(`bgstop:${t.id}`, oneLine(t.command, 30), () => stopTask($, t.id))}>
                  {stopChip(`bgstop:${t.id}`)}
                </Button>
              ) : null}
            </Box>
          </Box>
          {t.errorLine && openTask !== t.id ? <Box key={`bgerrline:${t.id}`} paddingLeft={ENTRY_INDENT + 2}><Text color="error">{t.errorLine}</Text></Box> : null}
          {t.status === 'failed' || t.errorCount ? (
            <Box key={`bgaskrow:${t.id}`} paddingLeft={ENTRY_INDENT + 2}>
              <Button key={`bgask:${t.id}`} plain onPress={async () => {
                await closeMenu($)
                $.ui.toast(await askAboutTask($, t.id) ? 'statusbar: asked Claude about it' : 'statusbar: could not send the question')
              }}>
                <Text backgroundColor="claude" color="inverseText" bold>{' ? ask Claude '}</Text>
                <Text dimColor>  sends its error lines and last lines, to find the cause and fix it</Text>
              </Button>
            </Box>
          ) : null}
          {t.busyPort ? (
            <Box key={`bgport:${t.id}`} flexDirection="row" gap={1} paddingLeft={ENTRY_INDENT + 2}>
              <Text color="warning">{holders.get(t.busyPort)
                ? `port ${t.busyPort} is held by pid ${holders.get(t.busyPort)!.pid} ${holders.get(t.busyPort)!.program}`
                : `port ${t.busyPort} was taken; nothing holds it now`}</Text>
              {holders.get(t.busyPort) ? (
                <Button key={`bgportstop:${t.id}`} plain onPress={() => stop(`bgportstop:${t.id}`, `pid ${holders.get(t.busyPort!)!.pid}`, () => stopPid($, holders.get(t.busyPort!)!.pid))}>
                  {stopChip(`bgportstop:${t.id}`)}
                </Button>
              ) : null}
            </Box>
          ) : null}
          {(t.urls ?? []).length && !t.status ? (
            <Box key={`bgurls:${t.id}`} flexDirection="row" gap={1} paddingLeft={ENTRY_INDENT + 2}>
              {(t.urls ?? []).map((url, i) => (
                <Button key={`bgurl:${t.id}:${i}`} plain onPress={async () => {
                  const r = await $.process.run(['open', url]).catch(() => undefined)
                  if (!r || r.exitCode !== 0) await $.process.run(['xdg-open', url]).catch(() => undefined)
                }}>
                  <Text color="suggestion" underline>{url}</Text>
                </Button>
              ))}
            </Box>
          ) : null}
          {logLines(t.id)}
        </Box>
      ))}
    </Box>
  )
}
