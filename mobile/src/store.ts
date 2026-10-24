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
