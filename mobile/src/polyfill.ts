// globalThis.crypto.getRandomValues for @noble, which Hermes lacks: from expo-crypto (the system's
// secure random). Imported first, before anything that draws a key.
import * as Crypto from 'expo-crypto'

const g = globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView | null>(a: T) => T } }
if (!g.crypto?.getRandomValues) g.crypto = { ...(g.crypto ?? {}), getRandomValues: a => Crypto.getRandomValues(a as never) as never }
