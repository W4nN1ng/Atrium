import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const MAIN = path.join(ROOT, 'src', 'main', 'vpm')
const RENDERER = path.join(ROOT, 'src', 'renderer', 'vpm')

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

function relative(file: string): string {
  return path.relative(MAIN, file).replace(/\\/g, '/')
}

describe('VPM security static gates (P9-A)', () => {
  it('keeps all VPM network access inside http/', () => {
    const failures: string[] = []
    for (const file of walk(MAIN)) {
      const rel = relative(file)
      if (rel.startsWith('http/') || rel === 'http.ts') {
        // http/electron.ts 是唯一允许 electron.net.request 的地方。
        if (rel !== 'http/electron.ts' && /\bnet\.request\s*\(/.test(stripComments(read(file)))) {
          failures.push(`${rel} uses net.request`)
        }
        continue
      }
      const src = stripComments(read(file))
      for (const pattern of [
        /\bfetch\s*\(/,
        /\bnet\.request\s*\(/,
        /from\s+['"]node:https?['"]/,
        /from\s+['"]node:net['"]/,
        /require\(\s*['"]node:https?['"]\s*\)/
      ]) {
        if (pattern.test(src)) failures.push(`${rel} matches ${pattern}`)
      }
      if (/['"]http:\/\//.test(src)) failures.push(`${rel} contains insecure http:// literal`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps renderer/VPM free of direct network calls', () => {
    const failures: string[] = []
    for (const file of walk(RENDERER)) {
      const src = stripComments(read(file))
      for (const pattern of [/\bfetch\s*\(/, /\bnet\.request\s*\(/, /node:https?/]) {
        if (pattern.test(src)) failures.push(`${path.relative(ROOT, file)} matches ${pattern}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps certificate verification on and has no TLS bypass switch', () => {
    const failures: string[] = []
    for (const file of [...walk(MAIN), ...walk(RENDERER)]) {
      const src = stripComments(read(file))
      if (/rejectUnauthorized\s*:\s*false|ignore-certificate|NODE_TLS_REJECT_UNAUTHORIZED/i.test(src)) {
        failures.push(path.relative(ROOT, file))
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('only deletes app-owned/temp/trash files, never a bare user path', () => {
    const allowed = new Set([
      'backup/zip.ts',
      'cache/store.ts',
      'catalog/localInstall.ts',
      'config.ts',
      'db/backup.ts',
      'fsUtil.ts',
      'gate.ts',
      'http/client.ts',
      'install/journal.ts',
      'ipc/projects.ts',
      'log/index.ts',
      'unity/unitypackage.ts',
      'updater.ts',
      'vault/store.ts'
    ])
    const failures: string[] = []
    for (const file of walk(MAIN)) {
      const rel = relative(file)
      const src = stripComments(read(file))
      if (/\bfs\.(?:rmSync|unlinkSync|rm)\s*\(/.test(src) && !allowed.has(rel)) {
        failures.push(rel)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])

    // 没有回收站时的回退是“复制到 Atrium 回收站，再移除源”，不是直接删。
    const trash = read(path.join(MAIN, 'ipc', 'projects.ts'))
    expect(trash.indexOf('fs.cpSync(item.path')).toBeGreaterThan(0)
    expect(trash.indexOf('fs.cpSync(item.path')).toBeLessThan(
      trash.indexOf('fs.rmSync(item.path')
    )
  })

  it('moves a stale UnityLockfile aside and does not delete it', () => {
    const launch = stripComments(read(path.join(MAIN, 'unity', 'launch.ts')))
    expect(launch).toContain('UnityLockfile.atrium-stale-')
    expect(launch).toContain('fs.renameSync(lockfile')
    expect(launch).not.toContain('rmSync(lockfile')
  })

  it('never generates or rewrites .meta files', () => {
    const failures: string[] = []
    for (const file of walk(MAIN)) {
      const src = stripComments(read(file))
      const writeMeta = /\b(?:writeFileSync|writeFile|createWriteStream|appendFileSync)\s*\([^\n]*\.meta/.test(src)
      if (writeMeta) failures.push(relative(file))
      if (/\b(?:renameSync|copyFileSync)\s*\([^\n]*\.meta/.test(src)) {
        // 只有“原样搬 package 里的 meta”允许；其它文件出现就是生成/改写。
        const rel = relative(file)
        if (rel !== 'install/legacy.ts' && rel !== 'unity/unitypackage.ts') {
          failures.push(`${rel} moves .meta outside package/legacy whitelist`)
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
