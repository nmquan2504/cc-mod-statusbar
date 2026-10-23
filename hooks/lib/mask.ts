// What the phone is not shown: strings shaped like a secret, in the texts a session sends it (the
// transcript, the prompt, the tool running, a permission prompt). The vault's own values are
// masked by vault.ts's scrub before this; this catches those it never saw: a token a tool printed,
// a line of a .env file read out. Paths are left alone: only texts go through it.

// A key with a known prefix (GitHub, GitLab, Slack, Anthropic, OpenAI, Stripe, Figma, Google), its
// first four characters kept so you can tell which.
const PREFIXED = /\b(?:fig[a-z]_|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|sk-ant-|sk-|sk_live_|rk_live_|AIza)[A-Za-z0-9_-]{20,200}/g
// An AWS access key id
const AWS = /\bAKIA[0-9A-Z]{16}\b/g
// A JSON web token: three base64url parts, the first two JSON objects
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
// A private key, whole
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
// An environment line naming a secret: OPENAI_API_KEY=..., DB_PASSWORD: "...". Upper case only, so
// code (`const token = getToken()`) reads as written.
const ENV_LINE = /\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)(\s*[=:]\s*)(['"]?)([^\s'"]{6,})\3/g

const hidden = (s: string) => `${s.slice(0, 4)}…[hidden]`

export function maskSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(PEM, '[private key hidden]')
    .replace(ENV_LINE, (_m, name: string, sep: string, q: string) => `${name}${sep}${q}[hidden]${q}`)
    .replace(PREFIXED, hidden)
    .replace(AWS, hidden)
    .replace(JWT, hidden)
}
