import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest, WebViewErrorEvent } from 'react-native-webview/lib/WebViewTypes'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'
import { bridge } from './bridge'
import { handFile } from './files'
import { askUnlock } from './lock'
import { onNoticeOpened } from './notices'
import { onSettings, saveSettings, settings } from './settings'
import type { AppSettings } from './settings'
import { call, Unpaired } from './e2e'
import { USER_AGENT, VERSION } from './version'
import type { Device } from './e2e'

// what the app asks of the WebView it holds
type WebViewHandle = { injectJavaScript: (js: string) => void }

type Colors = { bg: string; text: string; dim: string; claude: string; bad: string; line: string; panel: string }

// The chat: the hub's page, carried in the APK (scripts/page.js) and loaded from the phone, in a
// WebView; its E2E calls sealed here (src/bridge.ts), the only thing that crosses the tunnel. Links
// that lead away from it open in the browser; Android's back closes the page's open layer first.
const PAGE = 'file:///android_asset/page/'
export function Chat({ c, device, onUnpaired, onRescan, onCheckUpdate, onReady }: { c: Colors; device: Device; onUnpaired: () => void; onRescan: () => void; onCheckUpdate: () => Promise<unknown>; onReady: () => void }) {
  const web = useRef<WebViewHandle>(null)
  const insets = useSafeAreaInsets()
  // the cover (Đang kết nối…) stays until the page says it shows something: never a blank screen
  const [isLoading, setLoading] = useState(true)
  const [isLoaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState('')
  // the WebView's renderer ended (Android frees it while the app is in the background), or the
  // page shows nothing: a new one, loaded again
  const [life, setLife] = useState(0)
  const restart = useCallback(() => {
    setLoading(true)
    setLoaded(false)
    setLife(n => n + 1)
  }, [])
  const shownAt = useRef(0)
  const loadAt = useRef(Date.now())
  const blankRestarts = useRef(0)
  // the page keeps clear of the system bars by itself (the WebView gives it their size): no margin here
  const [isInsetByPage, setInsetByPage] = useState(false)
  // the bridge as the page first loads, the settings as they were then; later ones are sent in
  const [script] = useState(() => bridge(settings(), VERSION))
  const reply = useCallback((js: string) => web.current?.injectJavaScript(`${js}; true;`), [])
  const sendSettings = useCallback((s: AppSettings, note = '') => reply(`window.__qsb.settings(${JSON.stringify(s)}, ${JSON.stringify(note)})`), [reply])
  useEffect(() => onSettings(s => sendSettings(s)), [sendSettings])

  // the page's messages: a call to seal, an unpairing, the answer to back, a setting, words to say
  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let m: any
    try { m = JSON.parse(e.nativeEvent.data) } catch { return }
    if (m.t === 'call') {
      try {
        const r = await call(device, String(m.op), m.a && typeof m.a === 'object' ? m.a : {})
        reply(`window.__qsb.done(${Number(m.id)}, ${JSON.stringify(r)})`)
      } catch (err) {
        reply(`window.__qsb.fail(${Number(m.id)}, ${JSON.stringify(err instanceof Unpaired ? 'unpaired' : 'error')}, ${JSON.stringify((err as Error).message)})`)
      }
    } else if (m.t === 'forget') onUnpaired()
    else if (m.t === 'back' && !m.isHandled) BackHandler.exitApp()
    else if (m.t === 'set') {
      const key = String(m.key) as keyof AppSettings
      // the lock changes only for the phone's owner
      const why = key === 'lockAfter' && Number(m.value) !== settings().lockAfter ? await askUnlock('Đổi khoá ứng dụng') : ''
      if (why) sendSettings(settings(), why)
      else await saveSettings({ [key]: m.value })
    } else if (m.t === 'speak') {
      const said = (isOk: boolean) => reply(`window.__qsb.said(${Number(m.id)}, ${isOk})`)
      Speech.speak(String(m.text ?? ''), {
        language: m.lang ? String(m.lang) : undefined,
        voice: m.voice ? String(m.voice) : undefined,
        rate: Number(m.rate) || 1,
        onDone: () => said(true),
        onStopped: () => said(false),
        onError: () => said(false),
      })
    } else if (m.t === 'hush') void Speech.stop()
    else if (m.t === 'file') {
      const filed = (name: string, error = '') => reply(`window.__qsb.filed(${Number(m.id)}, ${JSON.stringify(name)}, ${JSON.stringify(error)})`)
      handFile(device, m.how === 'save' ? 'save' : 'open', m.a && typeof m.a === 'object' ? m.a : {})
        .then(name => filed(name), (e: unknown) => filed('', e instanceof Error ? e.message : String(e)))
    }
    else if (m.t === 'update') {
      // Check for update in Settings: the card when there is one, else a toast saying why not
      const toast = (title: string, body = '') => reply(`window.__qsb.toast(${JSON.stringify(title)}, ${JSON.stringify(body)})`)
      try {
        if (!(await onCheckUpdate())) toast('Đã là bản mới nhất', `Claude remote ${VERSION}`)
      } catch (err) {
        toast('Chưa kiểm tra được', (err as Error).message)
      }
    }
    else if (m.t === 'listen') {
      // the mic: Android's own voice input (its dialog, its microphone), in the page's language
      const heard = (text: string, error = '') => reply(`window.__qsb.heard(${Number(m.id)}, ${JSON.stringify(text)}, ${JSON.stringify(error)})`)
      const isVi = settings().lang === 'vi'
      try {
        const r = await IntentLauncher.startActivityAsync('android.speech.action.RECOGNIZE_SPEECH', {
          extra: {
            'android.speech.extra.LANGUAGE_MODEL': 'free_form',
            'android.speech.extra.LANGUAGE': isVi ? 'vi-VN' : 'en-US',
            'android.speech.extra.PROMPT': isVi ? 'Nói với Claude' : 'Speak to Claude',
            'android.speech.extra.MAX_RESULTS': 1,
          },
        })
        const said = (r.extra as Record<string, unknown> | undefined)?.['android.speech.extra.RESULTS']
        const text = Array.isArray(said) ? String(said[0] ?? '') : ''
        heard(r.resultCode === IntentLauncher.ResultCode.Success ? text : '', text ? '' : 'no-speech')
      } catch {
        heard('', isVi ? 'Điện thoại này không có nhập giọng nói' : 'This phone has no voice input')
      }
    }
    else if (m.t === 'rescan') onRescan()
    else if (m.t === 'insets') setInsetByPage(Number(m.top) > 0 || Number(m.bottom) > 0)
    else if (m.t === 'alive' && m.isShown) {
      shownAt.current = Date.now()
      blankRestarts.current = 0
      setLoading(false)
    }
  }, [device, onUnpaired, onRescan, onCheckUpdate, reply, sendSettings])

  // the phone's voices, for the page's Read aloud voices
  const sendVoices = useCallback(async () => {
    const voices = await Speech.getAvailableVoicesAsync().catch(() => [])
    const list = voices.map(v => ({ name: v.name, lang: v.language, voiceURI: v.identifier, localService: !/network/.test(v.identifier), default: false }))
    reply(`window.__qsb.voices(${JSON.stringify(list)})`)
  }, [reply])

  // a notification tapped, now or to open the app: its session, once the page is up
  const openSession = useCallback((session: string) => {
    web.current?.injectJavaScript(`typeof openSession === 'function' && openSession(${JSON.stringify(session)}); true;`)
  }, [])
  useEffect(() => onNoticeOpened(openSession), [openSession])
  useEffect(() => {
    if (isLoading) return
    void Notifications.getLastNotificationResponseAsync().then(r => {
      const session = String((r?.notification.request.content.data as { session?: string } | undefined)?.session ?? '')
      if (session) setTimeout(() => openSession(session), 1500)
      void Notifications.clearLastNotificationResponseAsync?.()
    })
  }, [isLoading, openSession])

  // The page says when it shows its start screen or the chat, drawn (a WebView that thinks itself
  // hidden draws nothing), and answers when asked, as the app comes back to the front. Not shown 4 s
  // after it loaded, or no answer in 2.5 s: loaded again, twice at most in a row, then the screen
  // that offers Thử lại. (The page shows its start screen within 2 s of a hub slow to answer.)
  useEffect(() => {
    if (!isLoaded) return
    let wait: ReturnType<typeof setTimeout> | undefined
    const expect = (since: number, ms: number) => {
      clearTimeout(wait)
      wait = setTimeout(() => {
        if (shownAt.current >= since) return
        if (++blankRestarts.current > 2) return setFailed('Trang không hiện gì.')
        restart()
      }, ms)
    }
    expect(loadAt.current, 4000)
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return
      const asked = Date.now()
      reply('window.__qsb && window.__qsb.alive()')
      expect(asked, 2500)
    })
    return () => {
      clearTimeout(wait)
      sub.remove()
    }
  }, [isLoaded, reply, restart])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      web.current?.injectJavaScript('window.__qsb && window.__qsb.back(); true;')
      return true
    })
    return () => sub.remove()
  }, [])

  if (failed)
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.note, { color: c.text }]}>Không mở được hub.</Text>
        <Text style={[styles.note, { color: c.dim }]}>{failed}</Text>
        <Text style={[styles.note, { color: c.dim }]}>Remote có thể đã dừng, hoặc link đã đổi.</Text>
        <Pressable style={[styles.button, { backgroundColor: c.claude }]} onPress={() => { setFailed(''); blankRestarts.current = 0; restart() }}>
          <Text style={styles.buttonText}>Thử lại</Text>
        </Pressable>
        <Pressable onPress={onRescan}><Text style={[styles.link, { color: c.dim }]}>Quét lại mã QR</Text></Pressable>
      </View>
    )

  return (
    <View style={[styles.fill, { backgroundColor: c.bg, paddingTop: isInsetByPage ? 0 : insets.top, paddingBottom: isInsetByPage ? 0 : insets.bottom }]}>
      <WebView
        key={life}
        ref={web as never}
        source={{ uri: `${PAGE}app.html` }}
        allowFileAccess
        style={[styles.fill, { backgroundColor: c.bg }]}
        injectedJavaScriptBeforeContentLoaded={script}
        onMessage={onMessage}
        applicationNameForUserAgent={USER_AGENT}
        originWhitelist={['file://*']}
        onShouldStartLoadWithRequest={(r: ShouldStartLoadRequest): boolean => {
          if (r.url.startsWith(PAGE) || r.url.startsWith('blob:') || r.url.startsWith('data:') || r.url === 'about:blank') return true
          void Linking.openURL(r.url)
          return false
        }}
        setSupportMultipleWindows={false}
        onLoadStart={(): void => { loadAt.current = Date.now() }}
        onLoadEnd={(): void => {
          setLoaded(true)
          onReady()
          void sendVoices()
        }}
        onRenderProcessGone={restart}
        onError={(e: WebViewErrorEvent): void => {
          setFailed(e.nativeEvent.description || 'Lỗi mạng')
          onReady()
        }}
        allowsBackForwardNavigationGestures={false}
        pullToRefreshEnabled={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        mediaPlaybackRequiresUserAction={false}
        webviewDebuggingEnabled={__DEV__}
      />
      {isLoading && (
        <View style={[styles.cover, { backgroundColor: c.bg }]}>
          <ActivityIndicator color={c.claude} />
          <Text style={[styles.note, { color: c.dim, marginTop: 12 }]}>Đang kết nối…</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignSelf: 'stretch' },
  center: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  cover: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 15, textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { fontSize: 15, marginTop: 12 },
})
