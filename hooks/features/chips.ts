import { suggestionChips } from '../lib/suggest'
import { remote } from './remote'
import { rt } from '../state/runtime'

// The chips under Claude's last answer, while no turn runs: Claude Code's own next-prompt
// suggestion, then what the answer suggests sending (lib/suggest.ts), three at most.
export const chipsNow = () => (rt.isBusy ? [] : suggestionChips(remote.suggestion, rt.answerChips))

// A chip pressed is sent at once: a /command runs (a plugin's prompt runs none), anything else
// goes in as your prompt.
export async function sendChip($: any, text: string) {
  const m = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  rt.answerChips = []
  remote.suggestion = ''
  $.ui.invalidate('ui.render')
  if (m) return $.command.run({ command: m[1]!, args: (m[2] ?? '').trim() })
  return $.prompt.submit({ text, asUser: true })
}
