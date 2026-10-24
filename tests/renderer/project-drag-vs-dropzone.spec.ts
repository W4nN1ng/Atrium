import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 项目行拖拽 vs 全窗口「拖文件即自动分类」的串台（2026-10-24 用户实机撞到）。
 *
 * 那次的现象：按着项目行拖，屏幕上亮起「松手即自动分类」，松手顺序一点没变。
 * 两个原因叠在一起，都是能在源码里钉住的：
 *  1. 只有 ⠿ 手柄 `draggable`，按着行标题拖 = 浏览器在拖文本，项目行根本没收事件；
 *  2. 全窗口接收层来者不拒，任何 dragover 都点亮遮罩、任何 drop 都走摄取流程。
 *
 * 这条用例只查"两条约定还在"，不模拟浏览器 DnD（真拖拽已经用 CDP 在安装版上点过）。
 */
const ROOT = path.resolve(__dirname, '../..')

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

describe('项目列表拖拽不与全局拖放遮罩冲突', () => {
  const section = read('src/renderer/vpm/components/projects/VpmProjectsSection.tsx')
  const overlay = read('src/renderer/components/DropOverlay.tsx')

  it('整行都是拖拽源（不再只靠 ⠿ 手柄）', () => {
    expect(section).toMatch(/draggable=\{!query\.trim\(\)\}/)
    expect(section).toContain('onDragStart={')
    expect(section).toContain('onDrop={')
  })

  it('内部拖动带上专属 MIME 标记', () => {
    expect(section).toContain('PROJECT_DRAG_MIME')
    expect(section).toMatch(/dataTransfer\.setData\(PROJECT_DRAG_MIME/)
  })

  it('全窗口接收层认出内部拖动后不点亮、不摄取', () => {
    expect(overlay).toContain('isInternalDrag')
    expect(overlay).toContain('PROJECT_DRAG_MIME')
    /** dragover / dragenter / drop 三条入口都要先判 */
    const guards = overlay.match(/if \(isInternalDrag\(e\.dataTransfer\)\) return/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(3)
  })

  it('按在行内按钮上不会变成拖动（否则「打开」会变成拖这一行）', () => {
    expect(section).toMatch(/closest\('button, input, textarea, select, a'\)/)
  })
})
