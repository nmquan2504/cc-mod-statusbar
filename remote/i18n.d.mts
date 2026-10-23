// The types of i18n.mjs, for the plugin's tests.
export const LANGS: readonly ['en', 'vi']
export const VI: Record<string, string>
export const SAMPLES: { vi: string; en: string }
export const WORKING_VI: readonly string[]
export function translate(lang: string, text: string, values?: Record<string, string | number>): string
export function langOf(navLang?: string): 'en' | 'vi'
