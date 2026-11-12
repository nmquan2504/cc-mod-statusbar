// The paired device, kept in SecureStore (encrypted with a key the Android Keystore holds): the
// hub's address, the id it gave this phone, and the AES-GCM key. Nothing else is kept.
import * as SecureStore from 'expo-secure-store'
import type { Device } from './e2e'

const KEY = 'device'

export async function loadDevice(): Promise<Device | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY)
    return v ? (JSON.parse(v) as Device) : null
  } catch {
    return null
  }
}
export const saveDevice = (d: Device) => SecureStore.setItemAsync(KEY, JSON.stringify(d))
export const forgetDevice = () => SecureStore.deleteItemAsync(KEY)

// The other Macs this app is paired with (Settings, Macs, in the page): each hub's device, its Mac's
// name once the hub said it. Kept in SecureStore beside the first, as one list.
const EXTRAS = 'extra-devices'
export type Extra = Device & { machine?: { id: string; name: string } }
export const hostOf = (d: Device) => { try { return new URL(d.base).host } catch { return d.base } }
export async function loadExtras(): Promise<Extra[]> {
  try {
    const v = await SecureStore.getItemAsync(EXTRAS)
    return v ? (JSON.parse(v) as Extra[]) : []
  } catch {
    return []
  }
}
export const saveExtras = (list: Extra[]) => SecureStore.setItemAsync(EXTRAS, JSON.stringify(list))
