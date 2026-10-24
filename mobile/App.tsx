import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ScreenCapture from 'expo-screen-capture'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { call, pair, setUserAgent, Unpaired } from './src/e2e'
import type { Device } from './src/e2e'
import { parseLink } from './src/link'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Chat } from './src/Chat'
import { LockScreen, useLock } from './src/lock'
import { clearNotices, setUpNotices, startListening, stopListening } from './src/notices'
import { loadSettings, onSettings, settings } from './src/settings'
import type { AppSettings } from './src/settings'
import { USER_AGENT } from './src/version'
import { forgetDevice, loadDevice, saveDevice } from './src/store'

// Claude remote for Android: the Self remote of cc-mod-statusbar as an app. Pairing by the
// terminal's QR code (scanned, or its link pasted) and the code to pick in the terminal; once
// paired, the chat: the hub's own page in a WebView, its calls sealed by the app (src/Chat.tsx).
const COLORS = {
  dark: { bg: '#1a1a18', panel: '#24241f', line: '#34342d', text: '#ecebe4', dim: '#9b9a90', claude: '#d97757', bad: '#e5675e' },
  light: { bg: '#f7f6f1', panel: '#ffffff', line: '#e3e1d7', text: '#23231f', dim: '#6c6b63', claude: '#d97757', bad: '#c4372d' },
}
type Colors = typeof COLORS.dark

setUserAgent(`${USER_AGENT} (${Platform.OS === 'android' ? `Android ${Platform.Version}` : Platform.OS})`)

type Phase =
  | { kind: 'loading' }
  | { kind: 'start'; error?: string }
  | { kind: 'scan' }
  | { kind: 'pairing'; device: Device; code: string; until: number }
  | { kind: 'paired'; device: Device; sessions: number | null; error?: string }

function App() {
  const c = COLORS[useColorScheme() === 'light' ? 'light' : 'dark']
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [prefs, setPrefs] = useState<AppSettings>(settings)
  useEffect(() => onSettings(setPrefs), [])
  const { isLocked, lock, unlock } = useLock(phase.kind === 'paired')

  // a device kept from before: straight to the chat, behind the lock when it is on
  useEffect(() => {
    void Promise.all([loadDevice(), loadSettings()]).then(([device, s]) => {
      setPrefs(s)
      if (s.lockAfter > 0) lock()
      setPhase(device ? { kind: 'paired', device, sessions: null } : { kind: 'start' })
    })
  }, [lock])

  // no screenshots of the chat, and nothing of it in the app switcher, while Settings says so
  const isSecure = phase.kind === 'paired' && prefs.secure
  useEffect(() => {
    void (isSecure ? ScreenCapture.preventScreenCaptureAsync() : ScreenCapture.allowScreenCaptureAsync()).catch(() => undefined)
  }, [isSecure])

  // paired: the notices' service runs (the notification, read aloud, even with the screen off)
  const unpaired = useCallback(() => {
    void stopListening()
    void forgetDevice()
    setPhase({ kind: 'start', error: 'Điện thoại này không còn ghép đôi với hub. Quét lại mã QR.' })
  }, [])
  // (with neither notifications nor reading aloud, it does not run)
  const device = phase.kind === 'paired' ? phase.device : null
  const isListening = Boolean(device) && (prefs.notify || prefs.readAloud)
  useEffect(() => {
    if (!device || !isListening) return void stopListening()
    void setUpNotices().then(() => startListening(device, unpaired)).catch(() => undefined)
  }, [device, isListening, unpaired])

  // the app in front: the notices in the shade are read
  useEffect(() => {
    if (!device) return
    void clearNotices()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void clearNotices() })
    return () => sub.remove()
  }, [device])

  // a link, scanned or pasted: pair, then wait for Allow in the terminal
  const startPairing = useCallback(async (text: string) => {
    const link = parseLink(text)
    if (!link) return setPhase({ kind: 'start', error: `Không phải link ghép đôi: ${text.trim().slice(0, 60) || '(trống)'}. Quét mã QR trong terminal (⇄, rồi Start).` })
    setPhase({ kind: 'loading' })
    try {
      await stopListening()
      const { device, code } = await pair(link.base, link.k, fetch, link.ticket)
      setPhase({ kind: 'pairing', device, code, until: Date.now() + 60_000 })
    } catch (err) {
      setPhase({ kind: 'start', error: (err as Error).message })
    }
  }, [])

  // the page's hand over (clauderemote://pair?…), opening the app or coming to it while open; the
  // service's own notification opens it with no link
  useEffect(() => {
    const open = (url?: string | null) => { if (url && /^clauderemote:\/\/pair\?/.test(url)) void startPairing(url) }
    void Linking.getInitialURL().then(open)
    const sub = Linking.addEventListener('url', e => open(e.url))
    return () => sub.remove()
  }, [startPairing])

  // Quét mã QR: Google's code scanner on Android (the same reader as Lens, sharp on a screen, no
  // camera permission); else, or when it is missing, the camera view of the app's own
  const scan = useCallback(() => {
    if (Platform.OS !== 'android' || !CameraView.isModernBarcodeScannerAvailable) return setPhase({ kind: 'scan' })
    const sub = CameraView.onModernBarcodeScanned(r => {
      sub.remove()
      void startPairing(r.data)
    })
    CameraView.launchScanner({ barcodeTypes: ['qr'] }).catch(() => {
      sub.remove()
      setPhase({ kind: 'scan' })
    })
  }, [startPairing])

  return (
    // the keyboard pushes the screen up: the pasted link's field, the chat's reply box
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: c.bg }]}>
      {phase.kind === 'loading' && <ActivityIndicator color={c.claude} />}
      {phase.kind === 'start' && <Start c={c} error={phase.error} onScan={scan} onLink={startPairing} />}
      {phase.kind === 'scan' && <Scan c={c} onLink={startPairing} onBack={() => setPhase({ kind: 'start' })} />}
      {phase.kind === 'pairing' && <Pairing c={c} phase={phase} setPhase={setPhase} />}
      {phase.kind === 'paired' && (
        <Chat c={c} device={phase.device}
          onUnpaired={unpaired}
          onRescan={() => setPhase({ kind: 'scan' })} />
      )}
      {isLocked && <LockScreen c={c} onUnlock={unlock} />}
      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  )
}

export default function Root() {
  return <SafeAreaProvider><App /></SafeAreaProvider>
}

function Start({ c, error, onScan, onLink }: { c: Colors; error?: string; onScan: () => void; onLink: (t: string) => void }) {
  const [text, setText] = useState('')
  return (
    <View style={styles.box}>
      <Text style={[styles.title, { color: c.text }]}>Claude remote</Text>
      <Text style={[styles.note, { color: c.dim }]}>Quét mã QR trong terminal (⇄ trên thanh trạng thái) để ghép đôi.</Text>
      <Pressable style={[styles.button, { backgroundColor: c.claude }]} onPress={onScan}>
        <Text style={styles.buttonText}>Quét mã QR</Text>
      </Pressable>
      <Text style={[styles.or, { color: c.dim }]}>hoặc dán link</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.panel }]}
          placeholder="https://…trycloudflare.com/#k=…" placeholderTextColor={c.dim}
          autoCapitalize="none" autoCorrect={false} value={text} onChangeText={setText}
          onSubmitEditing={() => onLink(text)} returnKeyType="go" accessibilityLabel="Link của remote"
        />
        <Pressable style={[styles.small, { borderColor: c.line }]} onPress={() => onLink(text)}>
          <Text style={{ color: c.text, fontWeight: '600' }}>Ghép</Text>
        </Pressable>
      </View>
      {error ? <Text style={[styles.error, { color: c.bad }]}>{error}</Text> : null}
    </View>
  )
}

// The camera, reading QR codes; the first that holds a pairing link goes, others are let pass
function Scan({ c, onLink, onBack }: { c: Colors; onLink: (t: string) => void; onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions()
  const isDone = useRef(false)
  const [seen, setSeen] = useState('')
  if (!permission) return <ActivityIndicator color={c.claude} />
  if (!permission.granted)
    return (
      <View style={styles.box}>
        <Text style={[styles.note, { color: c.dim }]}>Cần quyền camera để quét mã QR.</Text>
        <Pressable style={[styles.button, { backgroundColor: c.claude }]} onPress={requestPermission}>
          <Text style={styles.buttonText}>Cho phép camera</Text>
        </Pressable>
        <Pressable onPress={onBack}><Text style={[styles.link, { color: c.dim }]}>Quay lại</Text></Pressable>
      </View>
    )
  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={r => {
          if (isDone.current) return
          if (!parseLink(r.data)) return setSeen(r.data.slice(0, 60))
          isDone.current = true
          onLink(r.data)
        }}
      />
      <View style={styles.scanBar}>
        <Text style={styles.scanText}>{seen ? `Không phải mã ghép đôi: ${seen}` : 'Hướng camera vào mã QR trong terminal'}</Text>
        <Pressable onPress={onBack}><Text style={styles.scanText}>Huỷ</Text></Pressable>
      </View>
    </View>
  )
}

// The code to pick in the terminal, and the wait for it: asked again every 1.5 s, a minute at most
function Pairing({ c, phase, setPhase }: { c: Colors; phase: Extract<Phase, { kind: 'pairing' }>; setPhase: (p: Phase) => void }) {
  const [left, setLeft] = useState(60)
  useEffect(() => {
    let isGone = false
    const tick = async () => {
      if (isGone) return
      setLeft(Math.max(0, Math.ceil((phase.until - Date.now()) / 1000)))
      try {
        const r = await call(phase.device, 'paired')
        if (isGone) return
        if (r.s === 200) {
          await saveDevice(phase.device)
          return setPhase({ kind: 'paired', device: phase.device, sessions: null })
        }
        if (r.s !== 202) return setPhase({ kind: 'start', error: r.b?.error || 'Terminal đã từ chối. Quét lại mã QR.' })
      } catch (err) {
        if (err instanceof Unpaired) return setPhase({ kind: 'start', error: 'Hết thời gian chờ cho phép. Quét lại mã QR.' })
      }
      if (Date.now() > phase.until + 5000) return setPhase({ kind: 'start', error: 'Hết thời gian chờ cho phép. Quét lại mã QR.' })
      setTimeout(tick, 1500)
    }
    void tick()
    return () => { isGone = true }
  }, [phase, setPhase])
  return (
    <View style={styles.box}>
      <Text style={[styles.note, { color: c.dim }]}>Trong terminal, chọn mã này:</Text>
      <Text style={[styles.code, { color: c.claude }]}>{phase.code}</Text>
      <Text style={[styles.note, { color: left <= 15 ? c.bad : c.dim }]}>Cho phép trong vòng {left} giây</Text>
      <ActivityIndicator color={c.claude} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1, alignSelf: 'stretch' },
  box: { alignItems: 'center', padding: 24, gap: 12, alignSelf: 'stretch' },
  title: { fontSize: 24, fontWeight: '700' },
  note: { fontSize: 15, textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  or: { fontSize: 13, marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  input: { flex: 1, height: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 13 },
  small: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  error: { fontSize: 14, textAlign: 'center' },
  code: { fontSize: 44, fontWeight: '700', letterSpacing: 8 },
  link: { fontSize: 15, marginTop: 12 },
  scanBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,.55)', flexDirection: 'row', justifyContent: 'space-between' },
  scanText: { color: '#fff', fontSize: 15 },
})
