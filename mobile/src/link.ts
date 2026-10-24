// A pairing link, as the terminal's QR code holds it: https://<host>/#k=<K>, maybe with a path, a
// query (?web=1 from the page's own fallback) or a ?s= session. Resolves the hub's origin and K, or
// null for anything else (another QR code, a link with no K).
//
// Or the page's hand over to the app, clauderemote://pair?base=<origin>&k=<K>[&t=<ticket>]: from a
// fresh QR code in Chrome (no ticket, so Allow in the terminal), or from a paired browser (its
// ticket lets the app in at once).
export type PairLink = { base: string; k: string; ticket?: string }

export function parseLink(text: string): PairLink | null {
  const handed = /^clauderemote:\/\/pair\?(.*)$/.exec(text.trim())
  if (handed) {
    const q = Object.fromEntries(handed[1].split('&').map(p => p.split('=').map(decodeURIComponent)))
    const from = parseLink(`${q.base ?? ''}/#k=${q.k ?? ''}`)
    return from && { ...from, ...(/^[\w-]{16,64}$/.test(q.t ?? '') ? { ticket: q.t } : {}) }
  }
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/.test(url.hostname))) return null
  const k = /(?:^|[#&])k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(url.hash)?.[1]
  return k ? { base: url.origin, k } : null
}
