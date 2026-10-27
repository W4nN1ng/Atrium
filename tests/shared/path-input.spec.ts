import { expect, it } from 'vitest'
import { shouldCommitPath } from '../../src/shared/pathInput'

it('saves on a normal Enter after composition has ended', () => {
  expect(shouldCommitPath({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(true)
})

it.each([
  [{ key: 'Enter', isComposing: true, keyCode: 13 }, false],
  [{ key: 'Enter', isComposing: false, keyCode: 229 }, false],
  [{ key: 'Enter', keyCode: 0 }, true],
  [{ key: 'Process', isComposing: true, keyCode: 229 }, true],
  [{ key: 'Escape', keyCode: 27 }, false]
] as const)('does not save while confirming an IME candidate or on another key: %o', (event, composing) => {
  expect(shouldCommitPath(event, composing)).toBe(false)
})
