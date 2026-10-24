import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest, WebViewErrorEvent, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes'
import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'
import { bridge } from './bridge'
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

// The chat: the hub's own page in a WebView, its E2E calls sealed here (src/bridge.ts). Links that
// lead away from the hub open in the browser; Android's back closes the page's open layer first.
export function Chat({ c, device, onUnpaired, onRescan }: { c: Colors; device: Device; onUnpaired: () => void; onRescan: () => void }) {
  const web = useRef<WebViewHandle>(null)
  const insets = useSafeAreaInsets()
  const [isLoading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')
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
  }, [device, onUnpaired, reply, sendSettings])

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
        <Pressable style={[styles.button, { backgroundColor: c.claude }]} onPress={() => { setFailed(''); setLoading(true) }}>
          <Text style={styles.buttonText}>Thử lại</Text>
        </Pressable>
        <Pressable onPress={onRescan}><Text style={[styles.link, { color: c.dim }]}>Quét lại mã QR</Text></Pressable>
      </View>
    )

  return (
    <View style={[styles.fill, { backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <WebView
        ref={web as never}
        source={{ uri: `${device.base}/` }}
        style={[styles.fill, { backgroundColor: c.bg }]}
        injectedJavaScriptBeforeContentLoaded={script}
        onMessage={onMessage}
        applicationNameForUserAgent={USER_AGENT}
        originWhitelist={[device.base]}
        onShouldStartLoadWithRequest={(r: ShouldStartLoadRequest): boolean => {
          if (r.url.startsWith(device.base) || r.url.startsWith('blob:') || r.url === 'about:blank') return true
          void Linking.openURL(r.url)
          return false
        }}
        setSupportMultipleWindows={false}
        onLoadEnd={(): void => {
          setLoading(false)
          void sendVoices()
        }}
        onError={(e: WebViewErrorEvent): void => setFailed(e.nativeEvent.description || 'Lỗi mạng')}
        onHttpError={(e: WebViewHttpErrorEvent): void => { if (e.nativeEvent.statusCode >= 500) setFailed(`Hub trả lời ${e.nativeEvent.statusCode}`) }}
        allowsBackForwardNavigationGestures={false}
        pullToRefreshEnabled={false}
        overScrollMode="never"
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
