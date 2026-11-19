import { expect, test } from 'claude-code/testing'
import { arena, arenaRuns, cellsOf, gunAt, resetArena } from '../hooks/features/arena'
import { GUNS, cfg, claudeGlyph, readOptions } from '../hooks/state/config'

test('every gun faces left: Claude ✻ at the right end, no tip or grip drawn facing right', () => {
  for (const g of GUNS) {
    expect(g.glyph.endsWith('✻')).toBe(true)
    // ╾ is thin on its right and ⌐ hooks right: both belong to a gun that fires right
    expect(g.glyph).not.toMatch(/[╾⌐]/)
  }
})

test('a gun key Settings does not know keeps the one in force', () => {
  readOptions({ gun: 'pistol' })
  expect(claudeGlyph()).toBe('╼╦¬✻')
  readOptions({ gun: 'bazooka' })
  expect(cfg.gun).toBe('pistol')
  readOptions({ gun: 'sniper' })
  expect(claudeGlyph()).toBe('─━╦✻')
})

test("the gun's wide glyphs take two cells, and the field stops before its muzzle", () => {
  expect(cellsOf('─━╦✻')).toBe(4)
  expect(cellsOf('╼━╤デ╦︻▄✻')).toBe(10)
  expect(cellsOf('💥')).toBe(2)
  const width = arena.width
  arena.width = 40
  readOptions({ gun: 'heavy' })
  expect(gunAt()).toBe(30)
  readOptions({ gun: 'sniper' })
  expect(gunAt()).toBe(36)
  arena.width = width
})

test('the 💥 flash sits right before the muzzle on the tick Claude fires, and the switch turns it off', () => {
  const width = arena.width
  resetArena()
  arena.width = 30
  readOptions({ gun: 'pistol', muzzleFlash: true })
  arena.isFiring = true
  const row = arenaRuns().map(r => r[0]).join('')
  expect(row.endsWith('💥')).toBe(true)
  expect(cellsOf(row)).toBe(gunAt())
  readOptions({ muzzleFlash: false })
  expect(arenaRuns().map(r => r[0]).join('')).not.toContain('💥')
  arena.isFiring = false
  readOptions({ gun: 'sniper', muzzleFlash: true })
  arena.width = width
})
