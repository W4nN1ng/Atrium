import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * P8-A · UI 收口的三条硬规矩。
 *
 * 这些不是"风格建议"，是能在代码里查出来的边界：
 * 1. 展示组件**不直接碰 IPC**（`window.a`）——一律走 `vpm/api.ts`；
 * 2. 渲染层**不 import electron**；
 * 3. 每一屏**只有一个实心主按钮**（模态框里的确认按钮不算，它是独立的一屏）。
 */

const ROOT = path.resolve(__dirname, '../..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('P8-A component boundaries', () => {
  it('vpm components never touch window.a directly', () => {
    const offenders: string[] = []
    for (const file of walk(path.join(ROOT, 'src/renderer/vpm/components'))) {
      if (/\bwindow\.a\b/.test(read(file))) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders, '这些组件直接调了 IPC，应该走 vpm/api.ts：' + offenders.join(', ')).toEqual([])
  })

  it('renderer never imports electron', () => {
    const offenders: string[] = []
    for (const file of walk(path.join(ROOT, 'src/renderer'))) {
      if (/from ['"]electron['"]/.test(read(file))) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })

  it('the project page keeps exactly one solid primary button outside dialogs', () => {
    const source = read(path.join(ROOT, 'src/renderer/vpm/components/projects/VpmProjectsSection.tsx'))
    // 只看这个组件自己的 JSX（文件前面还有 LaunchControl 之类的子组件）
    const bodyStart = source.indexOf('export function VpmProjectsSection')
    expect(bodyStart).toBeGreaterThan(0)
    const body = source.slice(bodyStart)
    const firstModal = body.indexOf('<Modal')
    expect(firstModal).toBeGreaterThan(0)
    const mainScreen = body.slice(0, firstModal)
    const accents = mainScreen.match(/variant="accent"/g) ?? []
    expect(accents, '项目页主屏只能有一个实心按钮（新建项目）').toHaveLength(1)
  })

  it('every destructive dialog asks for confirmation through a Modal', () => {
    for (const name of [
      'src/renderer/vpm/components/projects/VpmProjectsSection.tsx',
      'src/renderer/vpm/components/ReposPanel.tsx'
    ]) {
      const source = read(path.join(ROOT, name))
      expect(source, `${name} 缺少 Modal`).toContain('<Modal')
    }
  })
})
