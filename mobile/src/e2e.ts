// End-to-end encryption between this app and the hub, the same protocol as the page's remote/e2e.js
// so the hub needs nothing new: Cloudflare, which carries the tunnel and ends its TLS, reads nothing.
//
// The QR link's #k= is a 256-bit key K that never leaves the phone. Pairing: the app sends an
// ECDH P-256 public key with an HMAC under a key derived from K; the hub answers with its own
// public key, the pairing code and an HMAC over both keys and the code. Each side then derives
// this phone's AES-GCM key from the ECDH secret, salted with K. Every request after that is one
// POST /x of { d: device id, iv, c }, its plaintext { op, a, ts, n }; the answer is sealed to that
// request's nonce. Pure TypeScript (@noble), so the same code runs in the app and in Node's checks;
// randomness is globalThis.crypto.getRandomValues (the app polyfills it from expo-crypto).
import { gcm } from '@noble/ciphers/aes.js'
import { p256 } from '@noble/curves/nist.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

const te = new TextEncoder()
const td = new TextDecoder()

export const b64 = {
  enc: (bytes: Uint8Array) => {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec: (str: string) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
}
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

// HKDF-SHA256 to 32 bytes, as the page's WebCrypto HKDF derives its HMAC and AES-GCM keys
const derive = (ikm: Uint8Array, salt: Uint8Array, info: string) => hkdf(sha256, ikm, salt, te.encode(info), 32)

// A device this app paired: the hub's address, the id the hub gave it, and its AES-GCM key
export type Device = { base: string; id: string; key: string }

export class Unpaired extends Error {}

// How this app names itself to the hub, which lists it as "Android, the app" among the phones
let userAgent = 'ClaudeRemote'
export const setUserAgent = (ua: string) => { userAgent = ua }

// Pairs with the hub at `base` (https://…trycloudflare.com) using the link's K; resolves the device
// and the code the terminal must allow (none, with a paired browser's ticket). `fetcher` is fetch
// (the tests give their own).
export async function pair(base: string, k: string, fetcher: typeof fetch = fetch, ticket = ''): Promise<{ device: Device; code: string }> {
  const root = b64.dec(k)
  if (root.length !== 32) throw new Error('This link is not a pairing link. Scan the QR code again.')
  const auth = derive(root, new Uint8Array(0), 'qsb/auth')
  const secretKey = p256.utils.randomSecretKey()
  const pub = b64.enc(p256.getPublicKey(secretKey, false))
  const mac = b64.enc(hmac(sha256, auth, te.encode(`hello|${pub}`)))
  const r = await fetcher(`${base}/hello`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent }, body: JSON.stringify({ pub, mac, ...(ticket ? { ticket } : {}) }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || 'The hub refused this link. Scan the QR code again.')
  // the hub proves it holds K too: no one in between can swap the keys or the code
  const expected = hmac(sha256, auth, te.encode(`welcome|${body.id}|${body.pub}|${pub}|${body.code}`))
  if (!sameBytes(expected, b64.dec(String(body.mac ?? '')))) throw new Error('The answer did not come from your hub. Do not use this link.')
  // the x coordinate of the shared point, as WebCrypto's deriveBits(ECDH, 256) gives it
  const secret = p256.getSharedSecret(secretKey, b64.dec(body.pub), true).slice(1)
  const key = derive(secret, root, `qsb/device|${pub}|${body.pub}`)
  return { device: { base, id: String(body.id), key: b64.enc(key) }, code: String(body.code) }
}

// The calls asked again and again, given up when the hub has not answered in this long (a long
// poll waits 25 s at most): a link gone quiet, as when the hub stops, fails them instead of
// holding them for ever (Android's fetch has no time limit). Others, an upload among them, wait.
const LIMIT_MS: Record<string, number> = { state: 40_000, watch: 40_000, paired: 15_000 }

// One sealed call: { s: status, b: body }. Unpaired when the hub no longer knows this device.
export async function call(dev: Device, op: string, a: Record<string, unknown> = {}, fetcher: typeof fetch = fetch): Promise<{ s: number; b: any }> {
  const limit = LIMIT_MS[op]
  if (!limit) return send(dev, op, a, fetcher)
  const stop = new AbortController()
  const t = setTimeout(() => stop.abort(), limit)
  try {
    return await send(dev, op, a, fetcher, stop.signal)
  } catch (err) {
    throw stop.signal.aborted ? new Error('The hub did not answer.') : err
  } finally {
    clearTimeout(t)
  }
}
async function send(dev: Device, op: string, a: Record<string, unknown>, fetcher: typeof fetch, signal?: AbortSignal): Promise<{ s: number; b: any }> {
  const key = b64.dec(dev.key)
  const n = b64.enc(random(12))
  const iv = random(12)
  const plain = te.encode(JSON.stringify({ op, a, ts: Date.now(), n }))
  const c = gcm(key, iv, te.encode(`req|${dev.id}`)).encrypt(plain)
  const r = await fetcher(`${dev.base}/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ d: dev.id, iv: b64.enc(iv), c: b64.enc(c) }), signal })
  if (r.status === 401) throw new Unpaired('This phone is not paired with the hub now.')
  const sealed = await r.json().catch(() => null)
  if (!sealed || !sealed.c) throw new Error(`The hub answered ${r.status}.`)
  const open = gcm(key, b64.dec(sealed.iv), te.encode(`res|${dev.id}|${n}`)).decrypt(b64.dec(sealed.c))
  return JSON.parse(td.decode(open))
}
