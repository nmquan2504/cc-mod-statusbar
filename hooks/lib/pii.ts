import { maskSecrets } from './mask'

// Personal data and secrets masked out of what a tool gives Claude, with the redact guardrail on:
// an email, a phone number (Vietnamese mobile or any +country number), a Vietnamese citizen ID
// (12 digits from 0), a card number (13 to 19 digits that pass the Luhn check), and every key the
// phone's mask knows (lib/mask.ts). A number in code (a timestamp, a port, a hash) is left alone:
// the patterns ask for the shape and the edges these numbers have.
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g
const PHONE_VN = /(?<![\w.+])(?:\+84[\s.-]?|0)[35789](?:[\s.-]?\d){8}(?!\w|\.\d)/g
const PHONE_INTL = /(?<![\w.])\+\d{1,3}(?:[\s.-]?\d){7,12}(?!\w|\.\d)/g
const CITIZEN_ID = /(?<![\w.])0\d{11}(?!\w|\.\d)/g
const CARD = /(?<![\w.])\d(?:[ -]?\d){12,18}(?!\w|\.\d)/g

function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

export function redactText(text: string): string {
  if (!text) return text
  return maskSecrets(text)
    .replace(EMAIL, '[email hidden]')
    .replace(CARD, m => (luhn(m.replace(/\D/g, '')) ? '[card hidden]' : m))
    .replace(CITIZEN_ID, '[id hidden]')
    .replace(PHONE_VN, '[phone hidden]')
    .replace(PHONE_INTL, '[phone hidden]')
}

// Every string in a tool's result, its shape kept; a non-plain object is left as it is
export function redactDeep<T>(v: T): T {
  if (typeof v === 'string') return redactText(v) as T
  if (Array.isArray(v)) return v.map(redactDeep) as T
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)])) as T
  return v
}
