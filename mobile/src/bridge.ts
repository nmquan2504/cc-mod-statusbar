// The page inside the WebView is the hub's own chat page, unchanged; this script, run before its
// own, stands in for its remote/e2e.js: window.E2E keeps the page's API (isSupported, load, call,
// forget, Unpaired, b64), and each call goes to the app, which seals it with the key the Keystore
// holds (src/e2e.ts) and answers through window.__qsb. The page never sees the key. Locked in place
// so the page's own e2e.js, loaded after, cannot replace it.
//
// It also gives the page what Android's WebView lacks or the app does itself: window.QSB_NATIVE,
// the app's settings for the page's Settings to show and change (src/settings.ts), and a
// speechSynthesis that reads with the phone's voices through the app (the WebView's has none).
//
// Messages from the page: { t: 'call', id, op, a } | { t: 'forget' } | { t: 'back', isHandled } |
//   { t: 'set', key, value } | { t: 'speak', id, text, lang, voice, rate } | { t: 'hush' } |
//   { t: 'insets', top, bottom } | { t: 'update' } | { t: 'listen', id } | { t: 'rescan' } |
//   { t: 'alive', isShown } (the app's probe, src/Chat.tsx)
// Answers into it: __qsb.done(id, result) | __qsb.fail(id, kind, message) | __qsb.back() |
//   __qsb.settings(settings, note) | __qsb.voices(list) | __qsb.said(id, isOk) | __qsb.toast(title, body) |
//   __qsb.heard(id, text, error)
import type { AppSettings } from './settings'

export const bridge = (settings: AppSettings, version: string) => `(() => {
  const waiting = new Map()
  let next = 1
  const post = m => window.ReactNativeWebView.postMessage(JSON.stringify(m))
  class Unpaired extends Error {}
  const b64 = {
    enc: bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''),
    dec: str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  }
  const E2E = {
    isSupported: () => true,
    load: async () => ({ id: 'app' }),
    pair: async () => { throw new Error('The app pairs by itself.') },
    call: (op, a = {}) => new Promise((resolve, reject) => {
      const id = next++
      waiting.set(id, { resolve, reject })
      post({ t: 'call', id, op, a })
    }),
    // the page unpairs (Unpair this phone, or the hub no longer knows it): the app goes back to its start
    forget: async () => post({ t: 'forget' }),
    Unpaired,
    b64,
  }
  Object.defineProperty(window, 'E2E', { configurable: false, get: () => E2E, set: () => undefined })

  // the page knows it runs in the app: what the app does itself, its Settings set here
  const native = { platform: 'android', version: ${JSON.stringify(version)}, settings: ${JSON.stringify(settings)}, set: (key, value) => post({ t: 'set', key, value }), checkUpdate: () => post({ t: 'update' }), rescan: () => post({ t: 'rescan' }) }
  Object.defineProperty(window, 'QSB_NATIVE', { configurable: false, get: () => native, set: () => undefined })

  // read aloud with the phone's own voices: the page's utterances, said by the app in turn
  let voices = []
  const said = new Map()
  let saidNext = 1
  const fire = (u, type, extra) => {
    const e = Object.assign(new Event(type), { utterance: u }, extra)
    const on = u['on' + type]
    if (typeof on === 'function') on.call(u, e)
    u.dispatchEvent(e)
  }
  const synth = new EventTarget()
  Object.assign(synth, {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices: () => voices,
    speak(u) {
      const id = saidNext++
      said.set(id, u)
      synth.speaking = true
      post({ t: 'speak', id, text: String(u.text), lang: u.lang || '', voice: u.voice ? u.voice.voiceURI : '', rate: Number(u.rate) || 1 })
    },
    cancel() {
      const left = [...said.values()]
      said.clear()
      synth.speaking = false
      post({ t: 'hush' })
      for (const u of left) fire(u, 'error', { error: 'interrupted' })
    },
    pause() {},
    resume() {},
  })
  // in place of the WebView's own, which has no voices or none at all
  class Utterance extends EventTarget {
    constructor(text = '') {
      super()
      Object.assign(this, { text, lang: '', voice: null, rate: 1, pitch: 1, volume: 1, onstart: null, onend: null, onerror: null })
    }
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: false, get: () => Utterance, set: () => undefined })
  Object.defineProperty(window, 'speechSynthesis', { configurable: false, get: () => synth, set: () => undefined })

  // the status and navigation bars as the WebView gives them to the page's CSS: when it does, the
  // page keeps clear of them itself and the app adds no margin of its own (it would be twice).
  // Android may give them only after the page has started, so they are read again on load, on
  // resize and over the first seconds, and sent each time they change.
  let insets = ''
  const readInsets = () => {
    if (!document.body) return
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'
    document.body.appendChild(probe)
    const style = getComputedStyle(probe)
    const top = parseFloat(style.paddingTop) || 0, bottom = parseFloat(style.paddingBottom) || 0
    probe.remove()
    if (insets === top + '|' + bottom) return
    insets = top + '|' + bottom
    post({ t: 'insets', top, bottom })
  }
  addEventListener('DOMContentLoaded', readInsets)
  addEventListener('load', readInsets)
  addEventListener('resize', readInsets)
  for (const ms of [300, 1000, 2500, 5000]) setTimeout(readInsets, ms)

  // speech recognition through the phone's own voice input (Android's, in the page's language):
  // the page's mic starts it, and what was said comes back as one final result
  const hearing = new Map()
  let hearNext = 1
  class Recognition extends EventTarget {
    constructor() {
      super()
      Object.assign(this, { lang: '', interimResults: false, continuous: false, maxAlternatives: 1, onstart: null, onresult: null, onerror: null, onend: null })
    }
    start() {
      const id = hearNext++
      hearing.set(id, this)
      post({ t: 'listen', id })
      fire(this, 'start')
    }
    stop() {}
    abort() {}
  }
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
    Object.defineProperty(window, name, { configurable: false, get: () => Recognition, set: () => undefined })

  window.__qsb = {
    done(id, r) { const w = waiting.get(id); waiting.delete(id); w && w.resolve(r) },
    fail(id, kind, message) {
      const w = waiting.get(id); waiting.delete(id)
      if (w) w.reject(kind === 'unpaired' ? new Unpaired(message) : new Error(message))
      if (kind === 'unpaired') post({ t: 'forget' })
    },
    // Android's back: an open page or sheet closes, the drawer shuts; else the app goes to the background
    back() {
      const page = [...document.querySelectorAll('.page:not([hidden])')].pop()
      const close = page && page.querySelector('.page-head button')
      if (close) { close.click(); return post({ t: 'back', isHandled: true }) }
      const isLayer = document.getElementById('drawer')?.classList.contains('open') || !document.getElementById('sheet')?.hidden
      if (isLayer && typeof closeLayers === 'function') { closeLayers(); return post({ t: 'back', isHandled: true }) }
      post({ t: 'back', isHandled: false })
    },
    // the app's settings changed (from the page, or refused, as a lock with no fingerprint): note says why
    settings(s, note) {
      native.settings = s
      dispatchEvent(new CustomEvent('qsb-native', { detail: { note } }))
    },
    toast(title, body) {
      if (typeof toast === 'function') toast({ title, body })
    },
    voices(list) {
      voices = list
      const e = new Event('voiceschanged')
      if (typeof synth.onvoiceschanged === 'function') synth.onvoiceschanged(e)
      synth.dispatchEvent(e)
    },
    heard(id, text, error) {
      const r = hearing.get(id)
      if (!r) return
      hearing.delete(id)
      if (text) {
        const result = Object.assign([{ transcript: text, confidence: 1 }], { isFinal: true })
        fire(r, 'result', { results: Object.assign([result], { length: 1 }), resultIndex: 0 })
      } else if (error) fire(r, 'error', { error })
      fire(r, 'end')
    },
    said(id, isOk) {
      const u = said.get(id)
      if (!u) return
      said.delete(id)
      synth.speaking = said.size > 0
      fire(u, isOk ? 'end' : 'error', isOk ? {} : { error: 'synthesis-failed' })
    },
  }
})(); true;`
