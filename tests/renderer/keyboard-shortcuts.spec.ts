import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

/** Execute original callbacks, mocking only external side effects. */
function callback(file: string, pick: (node: ts.Node, source: ts.SourceFile) => ts.Node | undefined, globals: object) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  function visit(node: ts.Node): void {
    if (found) return
    found = pick(node, source)
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found) throw new Error(`Callback not found in ${file}`)
  const compiled = ts.transpileModule(`(${found.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  return vm.runInNewContext(compiled, globals, { timeout: 1000 })
}

const keyCallback = (globals: object) => callback('src/renderer/App.tsx', n =>
  ts.isVariableDeclaration(n) && n.name.getText() === 'onKey' && n.initializer?.getText().includes('undoLast') ? n.initializer : undefined, globals)

describe('keyboard shortcuts preserve text editing', () => {
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
    it(`Ctrl+Z in ${target.tagName} leaves the text undo to the editor`, () => {
      const undoLast = vi.fn()
      const preventDefault = vi.fn()
      keyCallback({ undoLast })({ target, key: 'z', ctrlKey: true, preventDefault })
      expect(undoLast).not.toHaveBeenCalled()
      expect(preventDefault).not.toHaveBeenCalled()
    })
  }
  it('Ctrl+Shift+Z does not accidentally undo the library', () => {
    const undoLast = vi.fn()
    keyCallback({ undoLast })({ target: null, key: 'z', ctrlKey: true, shiftKey: true, preventDefault: vi.fn() })
    expect(undoLast).not.toHaveBeenCalled()
  })
  it('Ctrl+Z outside text inputs still undoes the library', () => {
    const undoLast = vi.fn()
    const preventDefault = vi.fn()
    keyCallback({ undoLast })({ target: null, key: 'z', ctrlKey: true, preventDefault })
    expect(undoLast).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})

describe('global hotkey follows the current settings', () => {
  it.each(['occupied', 'invalid'])('registration %s restores the previous shortcut', (failure) => {
    let registered = 'Control+Alt+A'
    const handler = callback('src/main/index.ts', (n, source) =>
      ts.isCallExpression(n) && n.expression.getText(source) === 'onSettingsChanged' ? n.arguments[0] : undefined, {
      hotkey: registered, refreshTray: vi.fn(), folderWatcher: null, showMiniDropAtCursor: vi.fn(),
      DEFAULT_HOTKEY: 'Control+Alt+A', log: { warn: vi.fn() },
      globalShortcut: { unregisterAll: () => { registered = '' }, register: (key: string) => {
        if (key === 'bad') { if (failure === 'invalid') throw new Error('Invalid accelerator'); return false }
        registered = key; return true
      } }
    })
    expect(() => handler({ globalHotkey: 'bad' }, ['globalHotkey'])).not.toThrow()
    expect(registered).toBe('Control+Alt+A')
  })
  it('A → B → A restores A, and unrelated settings do not register again', () => {
    let registered = 'Control+Alt+A'
    const register = vi.fn((key: string) => { registered = key; return true })
    const handler = callback('src/main/index.ts', (n, source) =>
      ts.isCallExpression(n) && n.expression.getText(source) === 'onSettingsChanged' ? n.arguments[0] : undefined, {
      hotkey: registered, refreshTray: vi.fn(), folderWatcher: null, showMiniDropAtCursor: vi.fn(),
      DEFAULT_HOTKEY: 'Control+Alt+A', getMainWindow: () => null, log: { warn: vi.fn() },
      globalShortcut: { register, unregisterAll: () => { registered = '' } }
    })
    handler({ globalHotkey: 'Control+Alt+B' }, ['globalHotkey'])
    handler({ globalHotkey: 'Control+Alt+A' }, ['globalHotkey'])
    expect(registered).toBe('Control+Alt+A')
    const count = register.mock.calls.length
    handler({ globalHotkey: 'Control+Alt+A', language: 'en' }, ['language'])
    expect(register).toHaveBeenCalledTimes(count)
  })
})
