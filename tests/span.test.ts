import { expect, test } from 'claude-code/testing'
import { spanText } from '../hooks/lib/format'
import { REMOTE_IDLE_STOPS, SETTINGS, readOptions, cfg, stepped } from '../hooks/state/config'

// The remote's idle time in Settings: written in minutes, hours and days, stepped through stops
// from off to a week (hooks/state/config.ts, hooks/lib/format.ts).

test('a span of minutes as m, h and d; 0 is off', () => {
  expect(spanText(0)).toBe('off')
  expect(spanText(5)).toBe('5m')
  expect(spanText(60)).toBe('1h')
  expect(spanText(90)).toBe('1h 30m')
  expect(spanText(1440)).toBe('1d')
  expect(spanText(2160)).toBe('1d 12h')
  expect(spanText(10080)).toBe('7d')
})

test('− and + step through the stops; a value between them goes to the nearest one that way', () => {
  const row = SETTINGS.find(r => r.key === 'remoteIdleMinutes')! as Parameters<typeof stepped>[0]
  expect(row.stops).toEqual(REMOTE_IDLE_STOPS)
  expect(stepped(row, 30, 1)).toBe(60)
  expect(stepped(row, 30, -1)).toBe(15)
  expect(stepped(row, 5, -1)).toBe(0)
  expect(stepped(row, 0, -1)).toBe(0)
  expect(stepped(row, 10080, 1)).toBe(10080)
  // 45 minutes, kept from the 5-minute steps of before
  expect(stepped(row, 45, 1)).toBe(60)
  expect(stepped(row, 45, -1)).toBe(30)
  // a row with no stops keeps its step and range
  expect(stepped({ step: 5, min: 5, max: 100 }, 100, 1)).toBe(100)
  expect(stepped({ step: 5, min: 5, max: 100 }, 50, -1)).toBe(45)
})

test('off and a week are kept from the store; a value past a week is not', () => {
  readOptions({ remoteIdleMinutes: 0 })
  expect(cfg.remoteIdleMinutes).toBe(0)
  readOptions({ remoteIdleMinutes: 10080 })
  expect(cfg.remoteIdleMinutes).toBe(10080)
  readOptions({ remoteIdleMinutes: 20000 })
  expect(cfg.remoteIdleMinutes).toBe(10080)
  readOptions({ remoteIdleMinutes: 30 })
})
