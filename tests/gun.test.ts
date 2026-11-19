import { expect, test } from 'claude-code/testing'
import { arena, cellsOf, gunAt } from '../hooks/features/arena'
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
  expect(cellsOf('💥━╼᠊ᡁデᠵᡕ✻')).toBe(11)
  const width = arena.width
  arena.width = 40
  readOptions({ gun: 'heavy' })
  expect(gunAt()).toBe(30)
  readOptions({ gun: 'sniper' })
  expect(gunAt()).toBe(36)
  arena.width = width
})
