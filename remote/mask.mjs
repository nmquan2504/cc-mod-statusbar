// The hub's copy of what the phone is never shown: the secrets rule for paths and the masking of
// strings shaped like a secret. The mod keeps the same two in hooks/lib/catalog.ts (SENSITIVE) and
// hooks/lib/mask.ts (maskSecrets); tests/mask.test.ts checks both copies agree.

// A path the phone never opens, lists by name or searches: a project's secrets and the credentials
// a home folder keeps.
export const SENSITIVE = /(^|\/)(\.env(\..*)?|\.envrc|secrets|exports|\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.config\/gcloud|\.config\/gh|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.vault-token|\.credentials\.json|\.cargo\/credentials(\.toml)?|\.(zsh|bash)_history|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|tfvars|tfstate))(\/|$)/i

const PREFIXED = /\b(?:fig[a-z]_|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|sk-ant-|sk-|sk_live_|rk_live_|AIza)[A-Za-z0-9_-]{20,200}/g
const AWS = /\bAKIA[0-9A-Z]{16}\b/g
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const ENV_LINE = /\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)(\s*[=:]\s*)(['"]?)([^\s'"]{6,})\3/g

const hidden = s => `${s.slice(0, 4)}…[hidden]`

export function maskSecrets(text) {
  if (!text) return text
  return String(text)
    .replace(PEM, '[private key hidden]')
    .replace(ENV_LINE, (_m, name, sep, q) => `${name}${sep}${q}[hidden]${q}`)
    .replace(PREFIXED, hidden)
    .replace(AWS, hidden)
    .replace(JWT, hidden)
}
