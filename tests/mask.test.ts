import { expect, test } from 'claude-code/testing'
import { SENSITIVE } from '../hooks/lib/catalog'
import { maskSecrets } from '../hooks/lib/mask'
import { SENSITIVE as HUB_SENSITIVE, maskSecrets as hubMask } from '../remote/mask.mjs'

// What the phone is not shown (hooks/lib/mask.ts): strings shaped like a secret in the texts. The
// test keys are built from parts, so no whole one sits in the source.
const fake = (prefix: string, n: number) => `${prefix}${'Ab1'.repeat(Math.ceil(n / 3)).slice(0, n)}`

test('keys with a known prefix, AWS key ids and JWTs keep four characters and hide the rest', () => {
  expect(maskSecrets(`export GH=${fake('ghp_', 36)} done`)).toBe('export GH=ghp_…[hidden] done')
  expect(maskSecrets(`key ${fake('sk-ant-', 30)} here`)).toBe('key sk-a…[hidden] here')
  expect(maskSecrets(`id ${'AKIA'}${'ABCDEFGHIJKLMNOP'}`)).toBe('id AKIA…[hidden]')
  const jwt = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fw']
  expect(maskSecrets(`Bearer ${jwt.join('.')}`)).toBe('Bearer eyJh…[hidden]')
})

test('a .env line naming a secret hides its value, quoted or not; a private key goes whole', () => {
  expect(maskSecrets('OPENAI_API_KEY=abc123xyz789\nDB_PASSWORD: "hunter22!"\nDEBUG=true')).toBe('OPENAI_API_KEY=[hidden]\nDB_PASSWORD: "[hidden]"\nDEBUG=true')
  const pem = ['-----BEGIN OPENSSH PRIVATE', 'KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----'].join(' ')
  expect(maskSecrets(`a\n${pem}\nz`)).toBe('a\n[private key hidden]\nz')
})

test('code, paths and short words read as written', () => {
  for (const text of [
    'const token = getToken()',
    'password: string',
    '/Users/me/projects/sk-learn-notes/README.md',
    'ask-ant to sort',
    'TOKEN=abc',
  ]) expect(maskSecrets(text)).toBe(text)
})

test('the hub masks and locks as the mod does: both copies of the rules agree', () => {
  const samples = [`token ${fake('ghp_', 36)}`, 'OPENAI_API_KEY=abc123xyz789', `id ${'AKIA'}${'ABCDEFGHIJKLMNOP'}`, 'plain words', 'const token = getToken()']
  for (const t of samples) expect(hubMask(t)).toBe(maskSecrets(t))
  expect(HUB_SENSITIVE.source).toBe(SENSITIVE.source)
})

test('the credentials a home folder keeps beyond keys are locked too', () => {
  const locked = ['.config/gh/hosts.yml', '.zsh_history', '.bash_history', '.cargo/credentials.toml', '.cargo/credentials', '.vault-token', '.claude/.credentials.json']
  expect(locked.filter(p => !SENSITIVE.test(p))).toEqual([])
  expect(['src/history.ts', 'docs/credentials.md', '.config/ghostty/config'].filter(p => SENSITIVE.test(p))).toEqual([])
})
