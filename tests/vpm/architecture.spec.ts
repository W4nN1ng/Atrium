import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const SHARED = path.join(ROOT, 'src/shared/vpm')
const MAIN = path.join(ROOT, 'src/main/vpm')
const RENDERER = path.join(ROOT, 'src/renderer/vpm')

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

function rel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

/** 和 static-imports.spec.ts 同款：先剥注释，避免注释里的示例把闸门骗绿。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
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

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function isUnder(file: string, dir: string): boolean {
  const r = path.relative(dir, file)
  return !!r && !r.startsWith('..') && !path.isAbsolute(r)
}

/** 解析相对 import 到真实文件；只用于本仓库的 src 内相对路径。 */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null
}

/** main/vpm 下的文件夹模块名；顶层单文件返回 null。 */
function moduleOf(file: string): string | null {
  if (!isUnder(file, MAIN)) return null
  const parts = path.relative(MAIN, file).split(path.sep)
  return parts.length > 1 ? parts[0] : null
}

function mainFiles(): string[] {
  return walk(MAIN)
}

describe('VPM architecture boundaries', () => {
  it('keeps a README with the module contract for every VPM layer', () => {
    const required = ['## 职责', '## 不负责什么', '## 公开 API', '## 数据 / 写入', '## 失败模式', '## 测试入口']
    for (const dir of [SHARED, MAIN, RENDERER]) {
      const file = path.join(dir, 'README.md')
      expect(fs.existsSync(file), `缺少 ${rel(file)}`).toBe(true)
      const text = read(file)
      for (const heading of required) expect(text, `${rel(file)} 缺 ${heading}`).toContain(heading)
    }
  })

  it('keeps shared/vpm pure: no Electron, Node IO, SQLite, main or renderer', () => {
    const failures: string[] = []
    for (const file of walk(SHARED)) {
      for (const spec of staticSpecifiers(read(file))) {
        // P0 的 dataRoot.ts 用 node:path 做 Windows 路径校验，是唯一例外。
        if (spec === 'node:path' && path.basename(file) === 'dataRoot.ts') continue
        if (spec === 'electron' || spec === 'better-sqlite3' || spec.startsWith('node:')) {
          failures.push(`${rel(file)} -> ${spec}`)
        }
        if (/(^|\/)(main|renderer)\//.test(spec)) failures.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps main/vpm from importing renderer code', () => {
    const failures: string[] = []
    for (const file of mainFiles()) {
      for (const spec of staticSpecifiers(read(file))) {
        if (/(^|\/)renderer\//.test(spec) || spec === '../../renderer') failures.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps renderer/vpm free of main, Electron and Node internals', () => {
    const failures: string[] = []
    for (const file of walk(RENDERER)) {
      for (const spec of staticSpecifiers(read(file))) {
        if (spec === 'electron' || spec.startsWith('node:') || /(^|\/)main\//.test(spec)) {
          failures.push(`${rel(file)} -> ${spec}`)
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('routes renderer VPM IPC through renderer/vpm/api.ts only', () => {
    const failures: string[] = []
    for (const file of walk(RENDERER)) {
      if (path.basename(file) === 'api.ts') continue
      if (/window\s*\.\s*a\s*\.\s*vpm\b/.test(stripComments(read(file)))) {
        failures.push(rel(file))
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('allows network only in main/vpm/http', () => {
    const failures: string[] = []
    for (const file of mainFiles()) {
      const relative = path.relative(MAIN, file).replace(/\\/g, '/')
      const isHttpModule = relative === 'http.ts' || relative.startsWith('http/')
      if (isHttpModule) continue
      for (const spec of staticSpecifiers(read(file))) {
        if (spec === 'node:http' || spec === 'node:https' || spec === 'node:net') {
          failures.push(`${rel(file)} -> ${spec}`)
        }
      }
      for (const call of networkCalls(read(file))) failures.push(`${rel(file)} -> ${call}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('allows SQLite only in main/vpm/db or repos (gate snapshot check is the P0 exception)', () => {
    const failures: string[] = []
    for (const file of mainFiles()) {
      const relative = path.relative(MAIN, file).replace(/\\/g, '/')
      const allowed =
        relative === 'gate.ts' ||
        relative === 'db.ts' ||
        relative === 'repos.ts' ||
        relative.startsWith('db/') ||
        relative.startsWith('repos/')
      if (allowed) continue
      for (const spec of staticSpecifiers(read(file))) {
        if (spec === 'better-sqlite3') failures.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps cross-module imports on a folder module public index', () => {
    const failures: string[] = []
    for (const file of mainFiles()) {
      const sourceModule = moduleOf(file)
      for (const spec of staticSpecifiers(read(file))) {
        const target = resolveImport(file, spec)
        if (!target || !isUnder(target, MAIN)) continue
        const targetModule = moduleOf(target)
        if (!targetModule || targetModule === sourceModule) continue
        const base = path.basename(target).replace(/\.(ts|tsx)$/, '')
        if (base !== 'index') failures.push(`${rel(file)} -> ${rel(target)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps vpm/gate as the only VPM module statically imported by core', () => {
    const failures: string[] = []
    for (const file of walk(path.join(ROOT, 'src/main'))) {
      if (isUnder(file, MAIN)) continue
      for (const spec of staticSpecifiers(read(file))) {
        if (!spec.includes('vpm/')) continue
        if (rel(file) === 'src/main/index.ts' && spec === './vpm/gate') continue
        failures.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps the settings and project VPM panels lazy and statically VPM-free', () => {
    const settings = read(path.join(ROOT, 'src/renderer/pages/Settings.tsx'))
    expect(settings).toContain("import('../vpm/VpmSettings')")
    expect(staticSpecifiers(settings).some((spec) => spec.includes('/vpm/'))).toBe(false)

    const project = read(path.join(ROOT, 'src/renderer/pages/Project.tsx'))
    expect(project).toContain("import('../vpm/components/projects/VpmProjectsSection')")
    expect(staticSpecifiers(project).some((spec) => spec.includes('/vpm/'))).toBe(false)
  })
})
