// End-to-end encryption between the phone and the hub, so Cloudflare, which carries the tunnel and
// ends its TLS, reads nothing: shared by the page and the service worker (importScripts).
//
// The QR link's #k= is a 256-bit key K that never leaves the phone. Pairing: the phone sends an
// ECDH P-256 public key with an HMAC under a key derived from K; the hub answers with its own
// public key, the pairing code and an HMAC over both keys and the code. Each side then derives
// this phone's AES-GCM key from the ECDH secret, salted with K. Every request after that is one
// POST /x of { d: device id, iv, c }, its plaintext { op, a, ts, n }; the answer is sealed to that
// request's nonce. The device key is kept in IndexedDB as a key the page cannot export.
;(() => {
  const subtle = self.crypto && self.crypto.subtle
  const te = new TextEncoder(), td = new TextDecoder()
  const b64 = {
    enc: bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  }
  const isSupported = () => Boolean(subtle && self.indexedDB)

  async function hkdf(ikm, salt, info, usage) {
    const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
    const algo = usage === 'hmac' ? { name: 'HMAC', hash: 'SHA-256', length: 256 } : { name: 'AES-GCM', length: 256 }
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, base, algo, false, usage === 'hmac' ? ['sign', 'verify'] : ['encrypt', 'decrypt'])
  }

  // ---- this phone's device: { id, key } per origin, kept in IndexedDB ----------------------------
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('qsb-e2e', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('devices')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  }
  async function store(mode, run) {
    const d = await db()
    return new Promise((resolve, reject) => {
      const tx = d.transaction('devices', mode)
      const req = run(tx.objectStore('devices'))
      tx.oncomplete = () => resolve(req && req.result)
      tx.onerror = () => reject(tx.error)
    })
  }
  // The hubs this browser is paired with, by host: this page's own (its origin) and the other Macs'
  // a person added (Settings, Macs). Each record: { id, key, base, machine? }. `hub` in the calls
  // below is a host; none means this page's own.
  const OWN = self.location.host
  const devices = new Map()
  const hostOf = hub => hub || OWN
  async function load(hub) {
    const host = hostOf(hub)
    if (!devices.has(host)) devices.set(host, (await store('readonly', s => s.get(host))) || null)
    return devices.get(host)
  }
  async function forget(hub) {
    const host = hostOf(hub)
    devices.set(host, null)
    await store('readwrite', s => s.delete(host))
  }
  // every hub paired: { hub (host, '' for this page's own), base, machine }
  async function hubs() {
    const keys = (await store('readonly', s => s.getAllKeys())) || []
    const out = []
    for (const host of keys) {
      const d = await load(host)
      if (d) out.push({ hub: host === OWN ? '' : host, base: d.base || `${self.location.protocol}//${host}`, machine: d.machine || null })
    }
    return out
  }
  // the Mac a hub said it is (the paired op's answer): kept with its key, and an older pairing with
  // the same Mac (a link from before its remote started again) let go
  async function setMachine(hub, machine) {
    const host = hostOf(hub)
    const d = await load(host)
    if (!d || !machine?.id) return
    d.machine = { id: String(machine.id), name: String(machine.name || '') }
    await store('readwrite', s => s.put(d, host))
    for (const other of (await store('readonly', s => s.getAllKeys())) || []) {
      // this page's own pairing is never let go from here: the page runs on it
      if (other === host || other === OWN) continue
      const o = await load(other)
      if (o?.machine?.id === d.machine.id) await forget(other === OWN ? '' : other)
    }
  }

  // ---- pairing ---------------------------------------------------------------------------------
  // Returns { code, hub } once the hub knows this phone; the terminal must then allow it. `base`: another
  // Mac's hub (its link's origin); none, this page's own.
  async function pair(k, base) {
    const root = b64.dec(k)
    if (root.length !== 32) throw new Error('This link is not a pairing link. Scan the QR code again.')
    const at = base ? new URL(base) : self.location
    const host = at.host
    const origin = `${at.protocol}//${host}`
    const auth = await hkdf(root, new Uint8Array(0), 'qsb/auth', 'hmac')
    const mine = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    const pub = b64.enc(await subtle.exportKey('raw', mine.publicKey))
    const mac = b64.enc(await subtle.sign('HMAC', auth, te.encode(`hello|${pub}`)))
    const r = await fetch(`${origin}/hello`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pub, mac }) })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(body.error || 'The hub refused this link. Scan the QR code again.')
    // the hub proves it holds K too: no one in between can swap the keys or the code
    const isHub = await subtle.verify('HMAC', auth, b64.dec(body.mac), te.encode(`welcome|${body.id}|${body.pub}|${pub}|${body.code}`))
    if (!isHub) throw new Error('The answer did not come from your hub. Do not use this link.')
    const theirs = await subtle.importKey('raw', b64.dec(body.pub), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const secret = await subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256)
    const key = await hkdf(secret, root, `qsb/device|${pub}|${body.pub}`, 'aes')
    const device = { id: body.id, key, base: origin }
    devices.set(host, device)
    await store('readwrite', s => s.put(device, host))
    return { code: body.code, hub: host === OWN ? '' : host }
  }

  // ---- one sealed call -------------------------------------------------------------------------
  class Unpaired extends Error {}
  async function call(op, a = {}, hub) {
    const dev = await load(hub)
    if (!dev) throw new Unpaired('Not paired.')
    const base = dev.base || ''
    const n = b64.enc(self.crypto.getRandomValues(new Uint8Array(12)))
    const iv = self.crypto.getRandomValues(new Uint8Array(12))
    const plain = te.encode(JSON.stringify({ op, a, ts: Date.now(), n }))
    const c = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`req|${dev.id}`) }, dev.key, plain)
    const r = await fetch(`${hub ? base : ''}/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ d: dev.id, iv: b64.enc(iv), c: b64.enc(c) }) })
    if (r.status === 401) throw new Unpaired('This phone is not paired with the hub now.')
    const sealed = await r.json().catch(() => null)
    if (!sealed || !sealed.c) throw new Error(`The hub answered ${r.status}.`)
    const open = await subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(sealed.iv), additionalData: te.encode(`res|${dev.id}|${n}`) }, dev.key, b64.dec(sealed.c))
    return JSON.parse(td.decode(open)) // { s: status, b: body }
  }

  self.E2E = { isSupported, pair, call, load, forget, hubs, setMachine, Unpaired, b64 }
})()
