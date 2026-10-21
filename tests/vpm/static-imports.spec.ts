import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
}

function staticSpecifiers(src: string): string[] {
  const clean = stripComments(src)
  const out: string[] = []
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const re of patterns) for (const m of clean.matchAll(re)) out.push(m[1])
  return out
}

function networkCalls(src: string): string[] {
  const clean = stripComments(src)
  return [
    ...clean.matchAll(/\bfetch\s*\(/g),
    ...clean.matchAll(/\b(?:http|https|net)\.request\s*\(/g),
    ...clean.matchAll(/\bnew\s+WebSocket\s*\(/g)
  ].map((m) => m[0])
}

/** 规则集中在一处，方便用合成源码做“闸会不会真的红”的对照。 */
function violationsFor(relative: string, src: string): string[] {
  const file = relative.replace(/\\/g, '/')
  const specs = staticSpecifiers(src)
  const out: string[] = []

  if (file.startsWith('src/main/') && !file.startsWith('src/main/vpm/')) {
    for (const spec of specs) {
      if (!spec.includes('vpm/')) continue
      if (file === 'src/main/index.ts' && spec === './vpm/gate') continue
      out.push(`main-static-vpm:${relative} -> ${spec}`)
    }
  }

  if (file === 'src/main/vpm/gate.ts') {
    for (const spec of specs) {
      if (/^(?:node:)?(?:http|https|net)$/.test(spec) || /(?:^|\/)vpm\/(?:db|cache)(?:$|\/)/.test(spec)) {
        out.push(`gate-forbidden-import:${spec}`)
      }
    }
  }

  if (file.startsWith('src/main/vpm/')) {
    for (const call of networkCalls(src)) out.push(`vpm-network-call:${relative}:${call}`)
  }

  if (file.startsWith('src/renderer/')) {
    for (const spec of specs) {
      // shared/vpm 是纯类型/纯函数，允许；renderer/vpm 只能动态加载。
      if (/(?:^|\/)renderer\/vpm\/|^\.\.?\/vpm\//.test(spec)) {
        out.push(`renderer-static-vpm:${relative} -> ${spec}`)
      }
    }
  }

  return out
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(path.relative(ROOT, full).replace(/\\/g, '/'))
  }
  return acc
}

describe('VPM static import guard', () => {
  it('keeps the gate as the only statically imported VPM module outside vpm/', () => {
    const files = [...walk(path.join(ROOT, 'src/main')), ...walk(path.join(ROOT, 'src/renderer'))]
    const all = files.flatMap((file) => violationsFor(file, fs.readFileSync(path.join(ROOT, file), 'utf8')))
    expect(all, all.join('\n')).toEqual([])
  })

  it('loads the settings panel dynamically from Settings.tsx', () => {
    const settings = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/Settings.tsx'), 'utf8')
    expect(settings).toContain("import('../vpm/VpmSettings')")
    expect(staticSpecifiers(settings).some((spec) => spec.includes('/vpm/'))).toBe(false)
  })

  it('keeps VPM fields out of the core settings defaults (rollback stays clean)', () => {
    const defaults = fs.readFileSync(path.join(ROOT, 'src/shared/settingsDefaults.ts'), 'utf8')
    expect(defaults).not.toMatch(/vpm/i)
  })

  it('would catch a core file statically importing a future VPM module', () => {
    expect(violationsFor('src/main/ipc/settings.ts', "import { x } from '../vpm/cache'")).toEqual([
      'main-static-vpm:src/main/ipc/settings.ts -> ../vpm/cache'
    ])
    expect(violationsFor('src/main/index.ts', "import { gate } from './vpm/gate'")).toEqual([])
  })

  it('would catch network imports/calls inside the gate', () => {
    expect(violationsFor('src/main/vpm/gate.ts', "import https from 'node:https'")).toEqual([
      'gate-forbidden-import:node:https'
    ])
    expect(violationsFor('src/main/vpm/gate.ts', 'export async function f(){ return fetch("x") }')).toEqual([
      'vpm-network-call:src/main/vpm/gate.ts:fetch('
    ])
  })

  it('would catch a renderer static VPM import, while allowing lazy import()', () => {
    expect(violationsFor('src/renderer/pages/Settings.tsx', "import { VpmSettings } from '../vpm/VpmSettings'")).toEqual([
      'renderer-static-vpm:src/renderer/pages/Settings.tsx -> ../vpm/VpmSettings'
    ])
    expect(
      violationsFor('src/renderer/pages/Settings.tsx', "const X = lazy(() => import('../vpm/VpmSettings'))")
    ).toEqual([])
  })
})
