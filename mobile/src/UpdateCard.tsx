// A newer app is out: what it is, and Update (downloaded, checked, then Android's installer), Later,
// or Skip this version (asked again only for a newer one, or from Settings)
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { install, skip } from './update'
import type { Release } from './update'
import { VERSION } from './version'

type Colors = { bg: string; text: string; dim: string; claude: string; bad: string; line: string; panel: string }

export function UpdateCard({ c, release, onClose }: { c: Colors; release: Release; onClose: () => void }) {
  const [part, setPart] = useState<number | null>(null)
  const [error, setError] = useState('')

  const update = async () => {
    setError('')
    setPart(0)
    try {
      await install(release, setPart)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setPart(null)
    }
  }

  const isBusy = part !== null
  return (
    <View style={[styles.scrim]}>
      <View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
        <Text style={[styles.title, { color: c.text }]}>Có bản mới: {release.version}</Text>
        <Text style={[styles.note, { color: c.dim }]}>Đang dùng {VERSION}. Bản mới tải từ GitHub, được kiểm SHA-256 rồi mở trình cài đặt của Android; app vẫn giữ ghép đôi.</Text>
        {isBusy ? (
          <View style={[styles.bar, { backgroundColor: c.line }]}>
            <View style={[styles.fill, { backgroundColor: c.claude, width: `${Math.round(part * 100)}%` }]} />
          </View>
        ) : null}
        {error ? <Text style={[styles.note, { color: c.bad }]}>{error}</Text> : null}
        <Pressable style={[styles.button, { backgroundColor: c.claude, opacity: isBusy ? 0.6 : 1 }]} disabled={isBusy} onPress={() => void update()}>
          <Text style={styles.buttonText}>{isBusy ? `Đang tải… ${Math.round(part * 100)}%` : 'Cập nhật'}</Text>
        </Pressable>
        <View style={styles.row}>
          <Pressable disabled={isBusy} onPress={onClose}><Text style={[styles.link, { color: c.dim }]}>Để sau</Text></Pressable>
          <Pressable disabled={isBusy} onPress={() => { void skip(release); onClose() }}><Text style={[styles.link, { color: c.dim }]}>Bỏ qua bản này</Text></Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,.5)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 8 },
  card: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 16, padding: 20, gap: 12 },
  title: { fontSize: 19, fontWeight: '700' },
  note: { fontSize: 14 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
  button: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  link: { fontSize: 15 },
})
