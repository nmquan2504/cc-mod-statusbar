// Just paired by a QR code: the browsers still getting the hub's notifications, listed so their
// notifications can go off (their pairing kept) and a notice comes once, from the app. An Android
// browser is picked to go off at first, likely this phone's own; any other (an iPhone, a desktop)
// stays unless picked. With none, it says nothing and goes straight on.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { call } from './e2e'
import type { Device } from './e2e'

type Colors = { bg: string; text: string; dim: string; claude: string; line: string; panel: string }
type Phone = { id: string; name: string; seenAt: number; isThis: boolean; hasPush: boolean }

const ago = (at: number) => {
  const m = Math.floor((Date.now() - at) / 60_000)
  return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.floor(m / 60)} giờ trước` : `${Math.floor(m / 1440)} ngày trước`
}

export function PushOff({ c, device, onDone }: { c: Colors; device: Device; onDone: () => void }) {
  const [phones, setPhones] = useState<Phone[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [isBusy, setBusy] = useState(false)

  useEffect(() => {
    void call(device, 'devices').then(r => {
      const list = ((r.s === 200 ? r.b.devices : []) as Phone[]).filter(p => !p.isThis && p.hasPush)
      if (!list.length) return onDone()
      setPhones(list)
      setPicked(new Set(list.filter(p => /^Android/.test(p.name)).map(p => p.id)))
    }).catch(onDone)
  }, [device, onDone])

  const turnOff = async () => {
    setBusy(true)
    for (const id of picked) await call(device, 'push-off', { id }).catch(() => undefined)
    onDone()
  }

  if (!phones)
    return (
      <View style={[styles.cover, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.claude} />
        <Text style={[styles.note, { color: c.dim }]}>Đang kết nối…</Text>
      </View>
    )
  return (
    <View style={[styles.cover, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.text }]}>Thông báo trùng</Text>
      <Text style={[styles.note, { color: c.dim }]}>
        Các trình duyệt này vẫn nhận thông báo của hub. Tắt ở trình duyệt trên điện thoại này để mỗi thông báo chỉ đến một lần, từ app. Trình duyệt vẫn ghép đôi.
      </Text>
      <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
        {phones.map(p => (
          <View key={p.id} style={[styles.row, { borderColor: c.line, backgroundColor: c.panel }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{p.name}</Text>
              <Text style={{ color: c.dim, fontSize: 13 }}>Thấy {ago(p.seenAt)}</Text>
            </View>
            <Switch
              value={picked.has(p.id)}
              onValueChange={isOn => setPicked(s => { const next = new Set(s); if (isOn) next.add(p.id); else next.delete(p.id); return next })}
              trackColor={{ true: c.claude }}
              accessibilityLabel={`Tắt thông báo của ${p.name}`}
            />
          </View>
        ))}
      </ScrollView>
      <Pressable style={[styles.button, { backgroundColor: c.claude, opacity: isBusy || !picked.size ? 0.5 : 1 }]} disabled={isBusy || !picked.size} onPress={() => void turnOff()}>
        <Text style={styles.buttonText}>{isBusy ? 'Đang tắt…' : `Tắt thông báo (${picked.size})`}</Text>
      </Pressable>
      <Pressable onPress={onDone} disabled={isBusy}><Text style={[styles.link, { color: c.dim }]}>Để nguyên</Text></Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, zIndex: 5 },
  title: { fontSize: 20, fontWeight: '700' },
  note: { fontSize: 15, textAlign: 'center' },
  list: { alignSelf: 'stretch', maxHeight: 280, flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 12, gap: 12 },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32, marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { fontSize: 15, marginTop: 8 },
})
