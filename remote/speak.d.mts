// The types of speak.mjs, for the plugin's tests.
export const EN_RUN: number
export function speechText(md: string): string
export type Segment = { lang: 'vi' | 'en'; text: string }
export function segments(text: string): Segment[]
