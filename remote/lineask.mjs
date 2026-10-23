// The phone's box for asking Claude about one line of a file, its logic kept out of the page so the
// plugin's tests run it: the line a tap on the gutter lands on, the prompt sent, and what the box
// says as the session moves on. The page loads it as a module and reads it from globalThis.LineAsk.

// The line under a tap `offsetY` px down the gutter: its top padding off, one line every
// `lineHeight` px, held to the file's `count` lines.
export function lineAt(offsetY, padTop, lineHeight, count) {
  return Math.min(count, Math.max(1, Math.floor((offsetY - padTop) / lineHeight) + 1))
}

// The prompt: the file as @path, the line's number, its text in a fence longer than any run of
// backticks in it, then what was asked.
export function lineAskText(mention, line, text, ask) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${mention} line ${line}:\n${fence}\n${text}\n${fence}\n${ask}`
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

globalThis.LineAsk = { lineAt, lineAskText, lineAskPhase }
