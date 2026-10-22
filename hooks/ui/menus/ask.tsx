import { answersOf, ask, isOneTap, pick, settleAsk } from '../../features/ask'
import type { AskQuestion } from '../../features/ask'
import type { Entry } from './entry'

const PREVIEW_ROWS = 16

// Claude's questions, all at once: each with its options (a digit picks the first nine), the
// preview of the option picked, and an Other box; then Submit, or Dismiss.
export async function drawAskMenu($: any, els: any, _isTerminal: boolean, _entry: Entry) {
  const { Box, Button, Text, Input } = els
  const p = ask.pending
  if (!p) return <Text dimColor>No question waits for you.</Text>
  const redraw = () => $.ui.invalidate('ui.render')
  const answered = Object.keys(answersOf(p.questions, p.draft)).length
  let digit = 0
  const optionRow = (q: AskQuestion, i: number, label: string, description: string | undefined, j: number) => {
    const isOn = (p.draft.picks[i] ?? []).includes(label)
    const mark = q.multiSelect ? (isOn ? '[x]' : '[ ]') : isOn ? '(•)' : '( )'
    const hotkey = ++digit <= 9 ? String(digit) : undefined
    return (
      <Box key={`askrow:${i}:${j}`} paddingLeft={2}>
        <Button key={`ask:${i}:${j}`} plain hotkey={hotkey} onPress={() => {
          pick(p.draft, q, i, label)
          if (isOneTap(p.questions) && p.draft.picks[i]?.length) settleAsk(p.id, { answers: answersOf(p.questions, p.draft) }, 'mac')
          redraw()
        }}>
          <Text color={isOn ? 'claude' : 'inactive'} bold>{mark}</Text>
          {' '}<Text bold={isOn}>{label}</Text>
          {description ? <Text dimColor>{`  ${description}`}</Text> : ''}
        </Button>
      </Box>
    )
  }
  const questionBlock = (q: AskQuestion, i: number) => {
    const options = q.kind === 'text' || q.kind === 'number' ? [] : q.options ?? []
    const picked = options.filter(o => (p.draft.picks[i] ?? []).includes(o.label))
    const preview = [...picked].reverse().find(o => o.preview)?.preview
    const hasPreviews = options.some(o => o.preview)
    const n = Number(p.draft.other[i] ?? q.defaultValue ?? q.min ?? 0)
    return (
      <Box key={`askq:${i}`} flexDirection="column" marginBottom={1}>
        <Text>
          {q.header ? <Text backgroundColor="claude" color="inverseText" bold>{` ${q.header} `}</Text> : null}
          {q.header ? ' ' : ''}<Text bold>{q.question}</Text>
        </Text>
        {q.description ? <Text dimColor>{q.description}</Text> : null}
        {options.map((o, j) => optionRow(q, i, o.label, o.description, j))}
        {preview ? (
          <Box key={`askprev:${i}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginLeft={2}>
            {preview.split('\n').slice(0, PREVIEW_ROWS).map((line, k) => <Text key={`pv:${i}:${k}`}>{line || ' '}</Text>)}
            {preview.split('\n').length > PREVIEW_ROWS ? <Text dimColor>{`… ${preview.split('\n').length - PREVIEW_ROWS} more lines (the phone shows them all)`}</Text> : null}
          </Box>
        ) : hasPreviews ? <Text dimColor>{'  pick an option to see its preview'}</Text> : null}
        {q.kind === 'number' ? (
          <Box key={`asknum:${i}`} flexDirection="row" gap={1} paddingLeft={2}>
            <Button key={`askdec:${i}`} plain onPress={() => {
              p.draft.other[i] = String(Math.max(q.min ?? -Infinity, n - (q.step ?? 1)))
              redraw()
            }}>
              <Text backgroundColor="subtle" color="inverseText" bold>{' − '}</Text>
            </Button>
            <Text color="claude" bold>{`${n}${q.unit ? ` ${q.unit}` : ''}`}</Text>
            <Button key={`askinc:${i}`} plain onPress={() => {
              p.draft.other[i] = String(Math.min(q.max ?? Infinity, n + (q.step ?? 1)))
              redraw()
            }}>
              <Text backgroundColor="subtle" color="inverseText" bold>{' + '}</Text>
            </Button>
          </Box>
        ) : Input ? (
          <Box key={`askother:${i}`} paddingLeft={2}>
            <Input key={`ask-other:${i}`} label={q.kind === 'text' ? '›' : 'Other'} value={p.draft.other[i] ?? ''}
              placeholder={q.kind === 'text' ? q.placeholder ?? 'type your answer' : 'type your own answer'} submitLabel="keep"
              onInput={(value: string) => { p.draft.other[i] = value }}
              onSubmit={(value: string) => {
                p.draft.other[i] = value
                redraw()
              }} />
          </Box>
        ) : null}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {p.questions.map(questionBlock)}
      <Box key="ask-actions" flexDirection="row" gap={2}>
        <Button key="ask-submit" plain hotkey="s" onPress={() => {
          const answers = answersOf(p.questions, p.draft)
          if (!Object.keys(answers).length) return $.ui.toast('statusbar: answer at least one question, or Dismiss')
          settleAsk(p.id, { answers }, 'mac')
          redraw()
        }}>
          <Text backgroundColor={answered ? 'claude' : 'subtle'} color="inverseText" bold>{` Submit ${answered}/${p.questions.length} `}</Text>
        </Button>
        <Button key="ask-dismiss" plain hotkey="d" onPress={() => {
          settleAsk(p.id, 'dismissed', 'mac')
          redraw()
        }}>
          <Text backgroundColor="subtle" color="inverseText" bold>{' Dismiss '}</Text>
        </Button>
        <Text dimColor>a blank question is left out; the phone can answer too</Text>
      </Box>
    </Box>
  )
}
