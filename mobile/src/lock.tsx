// The app lock: after the minutes Settings picks away from the app (and at its start), the chat
// hides behind the phone's own unlock: fingerprint, face, or the screen lock's PIN or pattern. A
// change to it asks for that unlock first, so a phone left unlocked cannot turn it off.
import * as LocalAuthentication from 'expo-local-authentication'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { settings } from './settings'

type Colors = { bg: string; text: string; dim: string; claude: string; bad: string }

// the phone's own unlock, asked once; '' when it passed, else why not
export async function askUnlock(prompt: string): Promise<string> {
  if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE)
    return 'Đặt khoá màn hình (vân tay, khuôn mặt hoặc mã PIN) trong Cài đặt Android trước.'
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Huỷ' })
  return r.success ? '' : r.error === 'user_cancel' || r.error === 'system_cancel' ? 'Đã huỷ.' : `Không mở khoá được (${r.error}).`
}

// Locked or not: lock() at the start when the lock is on, and locked again after its minutes away
export function useLock(isPaired: boolean) {
  const [isLocked, setLocked] = useState(false)
  const awayAt = useRef(0)
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'background') awayAt.current = Date.now()
      else if (s === 'active' && awayAt.current) {
        const minutes = settings().lockAfter
        if (minutes > 0 && Date.now() - awayAt.current > minutes * 60_000) setLocked(true)
        awayAt.current = 0
      }
    })
    return () => sub.remove()
  }, [])
  return { isLocked: isPaired && isLocked, lock: useCallback(() => setLocked(true), []), unlock: useCallback(() => setLocked(false), []) }
}

// Over the chat while locked: the unlock asked at once, and again on the button
export function LockScreen({ c, onUnlock }: { c: Colors; onUnlock: () => void }) {
  const [note, setNote] = useState('')
  const ask = useCallback(async () => {
    setNote('')
    const why = await askUnlock('Mở khoá Claude remote')
    if (why) setNote(why)
    else onUnlock()
  }, [onUnlock])
  useEffect(() => { void ask() }, [ask])
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { BackHandler.exitApp(); return true })
    return () => sub.remove()
  }, [])
  return (
    <View style={[styles.cover, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.text }]}>Claude remote đang khoá</Text>
      <Pressable style={[styles.button, { backgroundColor: c.claude }]} onPress={() => void ask()}>
        <Text style={styles.buttonText}>Mở khoá</Text>
      </Pressable>
      {note ? <Text style={[styles.note, { color: c.dim }]}>{note}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, zIndex: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  note: { fontSize: 15, textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
