// The types of speak.mjs, for the plugin's tests.
export const EN_RUN: number
export function speechText(md: string): string
export type Segment = { lang: 'vi' | 'en'; text: string }
export function segments(text: string): Segment[]
export type Voice = { name: string; lang: string; default?: boolean }
export function voicesFor<V extends Voice>(voices: readonly V[], lang: 'vi' | 'en'): V[]
export function pickVoice<V extends Voice>(voices: readonly V[], lang: 'vi' | 'en', name?: string): V | null
