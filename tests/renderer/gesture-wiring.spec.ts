import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 2026-10-21 · 双击导入 / 长按开合集的**源码接线**。
 *
 * 本仓库渲染层是零 DOM 测试（vitest `environment:'node'`，没装 jsdom），
 * 所以这层只能钉“有没有接上、接的是不是那条路”；真正的指针时序、CDP 真输入
 * 与观感由打包版活体兜住（见 docs/VERIFY-2026-10-21-GESTURES.md）。
 *
 * 纪律：所有文本断言先剥注释 —— 注释里往往正好写着被删掉的旧写法。
 */
const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

const grid = stripComments(read('src/renderer/components/AssetGrid.tsx'))
const detail = stripComments(read('src/renderer/components/DetailPanel.tsx'))
const bundle = stripComments(read('src/renderer/components/BundleDetail.tsx'))
const app = stripComments(read('src/renderer/App.tsx'))
const chrome = stripComments(read('src/renderer/components/chrome.tsx'))
const settings = stripComments(read('src/renderer/pages/Settings.tsx'))
const types = stripComments(read('src/shared/types.ts'))
const defaults = stripComments(read('src/shared/settingsDefaults.ts'))
const hook = stripComments(read('src/renderer/lib/useLongPress.ts'))

describe('双击 / 长按的接线', () => {
  it('网格卡和列表行各挂一次长按，且只对合集卡生效', () => {
    expect(grid.match(/useLongPress\(\{/g) ?? []).toHaveLength(2)
    expect(grid).toContain('enabled: card.isBundle')
    expect(grid).toContain("onFire: () => setNav('bundle:' + card.id)")
    expect(grid).toContain("t('library.bundleTitleHint')")
  })

  it('长按进度条用 LONG_PRESS_MS，不在组件里写死 1000', () => {
    expect(grid).toContain('animationDuration: `${LONG_PRESS_MS}ms`')
    expect(grid).not.toMatch(/animationDuration:\s*['"`]1000ms/)
  })

  it('双击普通卡走 importAsset；双击合集卡走 importWhole（不是进内部）', () => {
    expect(grid).toContain('void useUi.getState().importWhole(card.id)')
    expect(grid).toContain('void useUi.getState().importAsset(card.id)')
    /** 旧的双击进入合集只允许留在长按的 onFire 里，不能再出现在 onDoubleClick 分支 */
    const dbl = grid.slice(grid.indexOf('onDoubleClick={'), grid.indexOf('title={card.isBundle'))
    expect(dbl).not.toContain("setNav('bundle:' + card.id)")
  })

  it('多选快照在第一次 click（detail===1）就存，双击时还原再批量', () => {
    expect(grid).toContain('if (e.detail === 1) pressSelection.current = useUi.getState().selection')
    expect(grid).toContain('useUi.setState({ selection: snap })')
    expect(grid).toContain('void useUi.getState().importSelected(snap)')
  })

  it('图片不许原生拖拽，卡片根也拦 dragstart（否则长按会被拖图打断）', () => {
    expect(grid).toContain('draggable={false}')
    expect(grid).toContain('onDragStart={(e) => e.preventDefault()}')
  })

  it('长按 hook 会在松手/移出/滚动/失焦/Esc/原生拖拽时取消', () => {
    expect(hook).toContain("window.addEventListener('pointerup'")
    expect(hook).toContain("window.addEventListener('scroll'")
    expect(hook).toContain("window.addEventListener('blur'")
    expect(hook).toContain("window.addEventListener('dragstart'")
    expect(hook).toContain("e.key === 'Escape'")
    expect(hook).toContain('longPressMovedTooFar')
  })

  it('App：Enter 单合集走 importWhole，Shift+Enter 打开合集', () => {
    expect(app).toContain('if (e.shiftKey)')
    expect(app).toContain("setNav('bundle:' + sel[0])")
    expect(app).toContain('if (card?.isBundle) void st.importWhole(sel[0])')
    expect(app).toContain('else void st.importAsset(sel[0])')
  })

  it('App 不抢容器内部的 Enter（容器里按一次，成员面板不许开两遍）', () => {
    const at = app.indexOf("if (e.key === 'Enter')")
    const block = app.slice(at, app.indexOf('const st = useUi.getState()', at))
    expect(block).toContain("if (nav.startsWith('bundle:')) return")
  })

  it('状态栏按页面给手势提示', () => {
    expect(chrome).toContain("t('library.gestureHint')")
    expect(chrome).toContain("t('library.bundleGestureHint')")
  })
})

describe('常驻导入按钮与双击设置必须消失', () => {
  const FORBIDDEN_KEYS = [
    'library.importToUnity',
    'library.importToProject',
    'library.importToUnityHint',
    'library.batchImport',
    'library.batchImportToProject',
    'library.bundleImportWhole',
    'library.bundleImportSelected',
    'library.bundleImportMembers',
    'library.dblclickHint',
    'common.import',
    'settings.doubleClick',
    'settings.dcImport',
    'settings.dcPreview',
    'settings.dcReveal'
  ]

  it('四个界面文件里不再引用这些 key', () => {
    for (const [name, src] of [
      ['AssetGrid', grid],
      ['DetailPanel', detail],
      ['BundleDetail', bundle],
      ['Settings', settings]
    ] as const) {
      for (const key of FORBIDDEN_KEYS) {
        expect(src, `${name} 还在引用 ${key}`).not.toContain(key)
      }
    }
  })

  it('详情面板不再调用 importAsset，只留手势提示', () => {
    expect(detail).not.toContain('importAsset(')
    expect(detail).toContain("t('library.dblclickImportHint'")
    expect(detail).toContain("t('library.dblclickImportHintNoTarget'")
    expect(detail).toContain("t('library.holdToOpen')")
  })

  it('容器内部没有导入按钮；行双击仍走 importAsset', () => {
    expect(bundle).not.toContain('importBusy')
    expect(bundle).not.toContain('importTargetName')
    expect(bundle).not.toContain("t('library.bundleImportWhole')")
    expect(bundle).not.toContain("t('library.bundleImportMembers')")
    expect(bundle).toContain('void importAsset(r.id)')
  })

  it('双击行为设置从 UI、类型、默认值里一起删除', () => {
    expect(settings).not.toContain('doubleClickAction')
    expect(types).not.toContain('doubleClickAction')
    expect(defaults).not.toContain('doubleClickAction')
    expect(grid).not.toContain('doubleClickAction')
    expect(bundle).not.toContain('doubleClickAction')
  })
})
