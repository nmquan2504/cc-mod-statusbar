// The phone's box for asking Claude about a line of a file, or a range of them, its logic kept out
// of the page so the plugin's tests run it: the line a tap on the gutter lands on, the lines picked,
// the prompt sent, and what the box says as the session moves on. The page loads it as a module and reads it from globalThis.LineAsk.

// The line under a tap `offsetY` px down the gutter: its top padding off, one line every
// `lineHeight` px, held to the file's `count` lines.
export function lineAt(offsetY, padTop, lineHeight, count) {
  return Math.min(count, Math.max(1, Math.floor((offsetY - padTop) / lineHeight) + 1))
}

// The lines picked after a tap on line `n`: one line marked and another tapped makes the range
// between them; else (nothing marked, a range marked, the same line again) line `n` alone.
export function pickLines(picked, n) {
  if (picked && picked.from === picked.to && picked.from !== n) return { from: Math.min(picked.from, n), to: Math.max(picked.from, n) }
  return { from: n, to: n }
}

// "line 12", "lines 12-20"
export const linesLabel = (from, to) => (from === to ? `line ${from}` : `lines ${from}-${to}`)

// The prompt: the file as @path, the lines' numbers, their text in a fence longer than any run of
// backticks in it, then what was asked.
export function lineAskText(mention, from, to, text, ask) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${mention} ${linesLabel(from, to)}:\n${fence}\n${text}\n${fence}\n${ask}`
}

// What the box says once sent, read again at each state from the hub: 'sending' until the hub took
// it; 'waits' while the turn it was sent during runs on; 'working' until its own turn has run;
// 'done' once it has. `ask` is { status, wasBusy, sawBusy }, updated in place.
export function lineAskPhase(ask, isBusy) {
  if (ask.status === 'sending') return 'sending'
  if (ask.wasBusy) {
    if (isBusy) return 'waits'
    ask.wasBusy = false
  }
  if (isBusy) ask.sawBusy = true
  return isBusy || !ask.sawBusy ? 'working' : 'done'
}

globalThis.LineAsk = { lineAt, pickLines, linesLabel, lineAskText, lineAskPhase }
