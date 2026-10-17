import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function extract(pick: (node: ts.Node) => ts.Node | undefined) {
  const source = ts.createSourceFile('index.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  let selected: ts.Node | undefined
  function visit(node: ts.Node): void { if (!selected) { selected = pick(node); if (!selected) ts.forEachChild(node, visit) } }
  visit(source)
  if (!selected) throw Error('Production callback missing')
  return ts.transpileModule(`(${selected.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

describe('production settings use live detection rather than persisted running flags', () => {
  it('does not resurrect a closed project from a stale DB flag when auto-connect settings change', () => {
    const live = [{ id: 'P1', running: false }], stale = [{ id: 'P1', running: true }]
    const update = vi.fn()
    const handler = vm.runInNewContext(extract(node => ts.isCallExpression(node) && node.expression.getText() === 'onSettingsChanged' ? node.arguments[0] : undefined), {
      connections: { update }, detectedProjects: live,
      getDb: () => ({}), listProjects: () => stale, toProjectInfo: (x: unknown) => x,
      refreshTray: () => {}, folderWatcher: null, hotkey: 'Control+Alt+A', DEFAULT_HOTKEY: 'Control+Alt+A'
    })
    handler({ unityAutoConnect: true, globalHotkey: 'Control+Alt+A' }, ['unityAutoConnect'])
    expect(update).toHaveBeenCalledWith(live)
  })
  it('keeps the exact detected project list for the next configuration update', () => {
    const update = vi.fn(), context = vm.createContext({ connections: { update }, detectedProjects: [] })
    const handler = vm.runInContext(extract(node => ts.isPropertyAssignment(node) && node.name.getText() === 'onDetected' ? node.initializer : undefined), context)
    const live = [{ id: 'P1', running: false }]
    handler(live)
    expect(context.detectedProjects).toBe(live)
    expect(update).toHaveBeenCalledWith(live)
  })
})
