import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropEmptyKey } from '../../src/shared/dropDiagnostics'

/**
 * 第 10 轮 E：拖进来却什么也没发生（他报的"把西装拖进 A，A 一点反应也没有"）。
 *
 * 这一份只管"该不该说话、说哪句"。真行为（高亮、计时器）在渲染层，
 * 那边测不到 —— 所以判据全放这儿钉，渲染层只钉接线（见 tests/renderer/r10-drop.spec.ts）。
 */
describe('dropEmptyKey · 拖放拿到 0 个本地路径时的口径', () => {
  it('⭐ 拿到了路径 → 无话可说（null），不许弹"没收到文件"骗人', () => {
    expect(dropEmptyKey({ files: 1, localPaths: 1 })).toBeNull()
    expect(dropEmptyKey({ files: 12, localPaths: 12 })).toBeNull()
  })

  it('⭐ 带了文件、一个路径都没解析出来 → 说"没拿到本地路径"', () => {
    /** 浏览器里的图、压缩包预览窗口里的一行、网盘占位文件都是这一类 */
    expect(dropEmptyKey({ files: 3, localPaths: 0 })).toBe('library.dropNoLocalPath')
  })

  it('⭐ 压根没有文件 → 说"这次拖拽没带上文件"（两种病不一样，话也不能一样）', () => {
    /** 拖的是文字/快捷方式，或者事件本身是空的那一种（根因未定死的那条） */
    expect(dropEmptyKey({ files: 0, localPaths: 0 })).toBe('library.dropNothing')
  })

  it('files 是 0 与"负数/NaN"不作区分 —— 只要没文件就走"没带上文件"', () => {
    expect(dropEmptyKey({ files: -1, localPaths: 0 })).toBe('library.dropNothing')
    expect(dropEmptyKey({ files: NaN, localPaths: 0 })).toBe('library.dropNothing')
  })

  it('拿到过路径就闭嘴 —— 哪怕 files 是 0（从浏览器拖 file:// 链接就是这一类）', () => {
    /** 这条是"别乱弹"的一侧：路径来自 uri-list 兜底时 `files` 确实是空的 */
    expect(dropEmptyKey({ files: 0, localPaths: 1 })).toBeNull()
  })

  it('返回的键在三份语言文件里都翻得出话（漏一种语言就是界面上一片空白）', () => {
    const ROOT = path.resolve(__dirname, '../..')
    const keys = ['library.dropNoLocalPath', 'library.dropNothing', 'library.dropHint']
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const json = JSON.parse(fs.readFileSync(path.join(ROOT, `src/renderer/i18n/${loc}.json`), 'utf8')) as Record<
        string,
        Record<string, string>
      >
      for (const k of keys) {
        const [ns, key] = k.split('.')
        const v = json[ns]?.[key]
        expect(typeof v === 'string' && v.trim().length > 0, `${loc} 缺 ${k}`).toBe(true)
      }
    }
  })
})
