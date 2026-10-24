// The app's ear for the hub while the phone is in a pocket: a foreground service (its own quiet
// notification, "Claude remote · đã kết nối") keeps the app's JavaScript running, and asks the hub's
// watch op for the next notice, a long poll of a few hundred bytes. Each notice: a notification of
// its own (shown while the app is not in front; its content kept off the lock screen), and read
// aloud: ZeroTTS from the Mac when the hub has it, else the phone's own voice.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'
import { AppState } from 'react-native'
import BackgroundService from 'react-native-background-actions'
import { b64, call, Unpaired } from './e2e'
import type { Device } from './e2e'
import { settings } from './settings'

const CHANNEL = 'notices'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// A notice as the hub sends it, and the words read and shown for it
export type Notice = { title: string; body: string; at: number; session: string }
const isDone = (n: Notice) => /^Done\b/.test(n.title)
const WORDS = { vi: ['Claude đã trả lời', 'Claude cần bạn'], en: ['Claude has responded', 'Claude needs you'] }
export const statusOf = (n: Notice, folder: string, lang: 'vi' | 'en' = 'vi') => `${WORDS[lang][isDone(n) ? 0 : 1]}${folder ? `, ${folder}` : ''}`

// Once, at the start: the notices' channel (high importance, its content private on the lock
// screen), the permission (asked on Android 13 and later), and audio that plays in the background
// and lowers other apps' sound while it speaks
export async function setUpNotices() {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Claude trả lời / cần bạn',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    vibrationPattern: [0, 120, 80, 120],
  })
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  })
  await Notifications.requestPermissionsAsync().catch(() => undefined)
  await setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: 'duckOthers' }).catch(() => undefined)
}

// ZeroTTS's WAV for `text` from the Mac, played to its end; false when the Mac has none (not
// installed, an older hub) or it does not answer in 20 s
async function sayZero(device: Device, text: string, lang: 'vi' | 'en'): Promise<boolean> {
  const r = await Promise.race([call(device, 'tts', { text, voice: 'maichi', lang }), sleep(20_000).then(() => null)]).catch(() => null)
  if (!r || r.s !== 200 || !r.b?.b64) return false
  const file = new File(Paths.cache, `notice-${Date.now()}.wav`)
  file.write(b64.dec(String(r.b.b64).replace(/\+/g, '-').replace(/\//g, '_')))
  const player = createAudioPlayer(file.uri)
  await new Promise<void>(resolve => {
    const done = setTimeout(resolve, 30_000)
    player.addListener('playbackStatusUpdate', s => { if (s.didJustFinish) { clearTimeout(done); resolve() } })
    player.play()
  })
  player.remove()
  try { file.delete() } catch {}
  return true
}
const sayPhone = (text: string, lang: 'vi' | 'en') => new Promise<void>(resolve => Speech.speak(text, { language: lang === 'vi' ? 'vi-VN' : 'en-US', onDone: resolve, onError: () => resolve(), onStopped: resolve }))

// One notice, as Settings says: shown (unless the app is in front, where the page shows it), its
// words kept out of the shade when private, and read aloud
async function announce(device: Device, n: Notice, folder: string) {
  const { notify, readAloud, privateNotices, lang } = settings()
  const status = statusOf(n, folder, lang)
  if (notify && AppState.currentState !== 'active')
    await Notifications.scheduleNotificationAsync({
      content: { title: status, body: privateNotices ? '' : n.body || '', data: { session: n.session }, ...({ channelId: CHANNEL } as object) },
      trigger: null,
    }).catch(() => undefined)
  if (readAloud && !(await sayZero(device, status, lang))) await sayPhone(status, lang)
}

// The service's loop: the next notice after the one last seen, again and again, while it runs.
// A hub that has gone (the remote stopped, a new link) is asked again every 15 s; an unpairing
// stops it.
// (each start its own run: an older loop still waiting on the hub ends when it answers)
let run = 0
async function listen(device: Device, onUnpaired: () => void) {
  const mine = ++run
  let since = Date.now()
  while (mine === run && BackgroundService.isRunning()) {
    try {
      const r = await call(device, 'watch', { since })
      if (mine !== run) break
      const n = r.b?.notice as Notice | undefined
      if (r.s === 200 && n && n.at > since) {
        since = n.at
        await announce(device, n, String(r.b.folder ?? ''))
      } else if (r.s !== 200) await sleep(15_000)
    } catch (err) {
      if (err instanceof Unpaired) {
        onUnpaired()
        break
      }
      await sleep(15_000)
    }
  }
  // a loop a newer run replaced: it never ends, as the service stops when its task does
  if (mine !== run) await new Promise<never>(() => undefined)
}

// The service, started once the app is paired, and again for a new pairing
export async function startListening(device: Device, onUnpaired: () => void) {
  await stopListening()
  await BackgroundService.start(() => listen(device, onUnpaired), {
    taskName: 'claude-remote',
    taskTitle: 'Claude remote',
    taskDesc: 'Đã kết nối · đọc to khi Claude trả lời',
    taskIcon: { name: 'ic_launcher', type: 'mipmap' },
    color: '#d97757',
    linkingURI: 'clauderemote://',
    foregroundServiceType: ['remoteMessaging'],
  })
}
export async function stopListening() {
  run++
  if (BackgroundService.isRunning()) await BackgroundService.stop()
}

// The app in front: its notices read there, the shade cleared of them (the service's own stays)
export async function clearNotices() {
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => [])
  for (const n of shown) if ((n.request.content.data as { session?: string } | undefined)?.session !== undefined) await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined)
}

// A notification tapped: the session it came from, for the chat to open
export function onNoticeOpened(open: (session: string) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener(r => {
    const session = String((r.notification.request.content.data as { session?: string })?.session ?? '')
    if (session) open(session)
  })
  return () => sub.remove()
}
