import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 第 10 轮 E 的**接线**：拖文件夹"没反应"那一族。
 *
 * 判据在 `src/shared/dropDiagnostics.ts`（有独立用例），这份只钉三件事：
 *  1. 高亮的开关不再靠 enter/leave 配对记账（那是"闪一下没了"的来源）；
 *  2. 拿到 0 个本地路径时**有人接住**（以前 `if (paths.length) onPaths(paths)` 之后什么都不做）；
 *  3. 诊断计数真的会打出来（根因还没定死，下次他撞上要靠这行区分"事件没来"和"来了没路径"）。
 *
 * ⚠ 零 DOM 测试测不到 React 事件本身 —— 真行为由 `tools/live-r10-drop.cjs` 的合成 DragEvent 序列钉。
 */
const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 断言 API 存在/顺序之前先剥注释（注释里也写着旧写法长什么样） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

const do_ = stripComments(read('src/renderer/components/DropOverlay.tsx'))
const app = stripComments(read('src/renderer/App.tsx'))

/** 取某个回调本体的那段文本 */
function body(src: string, anchor: string, len: number): string {
  const at = src.indexOf(anchor)
  expect(at, `找不到锚点：${anchor}`).toBeGreaterThan(-1)
  return src.slice(at, at + len)
}

describe('E1 · 高亮不再靠 enter/leave 计数器', () => {
  it('⭐ onDragOver 里点亮（指针还在窗口里它就一直来，高亮不可能灭着）', () => {
    expect(body(do_, 'const onDragOver = useCallback', 260)).toContain('light()')
  })

  it('⭐ onDragLeave 里不再熄灭高亮（老写法在这里 setActive(false)，就是"闪一下没了"）', () => {
    const leave = body(do_, 'const onDragLeave = useCallback', 200)
    expect(leave).not.toContain('setActive(false)')
    /** 只计数 + preventDefault，别把事件吞了导致光标变成禁止符 */
    expect(leave).toContain('seen.current.leave++')
  })

  it('depth 计数器整个没了（留着就是两套熄灭逻辑并存）', () => {
    expect(do_).not.toMatch(/\bdepth\b/)
  })

  it('熄灭只看"安静了多久"，且那个窗口是 400ms 量级', () => {
    expect(do_).toContain('setTimeout')
    expect(do_).toContain('DROP_IDLE_MS')
    const m = /export const DROP_IDLE_MS = (\d+)/.exec(read('src/renderer/components/DropOverlay.tsx'))
    expect(m, 'DROP_IDLE_MS 不是字面量数字').not.toBeNull()
    const ms = Number(m?.[1])
    expect(ms, '太短会拖拽中途自己灭、太长手感发黏').toBeGreaterThan(150)
    expect(ms).toBeLessThan(1200)
  })

  it('卸载时清掉计时器（不然 React 会问"你在已卸载的组件上 setState"）', () => {
    expect(body(do_, 'useEffect(', 220)).toContain('clearTimeout')
  })
})

describe('E2 · 拿到 0 个路径不许再静默', () => {
  it('⭐ drop 的两个出口都会说话：没有 dataTransfer、以及解析完 0 个路径', () => {
    expect(do_.match(/onEmpty\?\.\(/g) ?? [], 'onEmpty 的调用点应该正好两处').toHaveLength(2)
  })

  it('拿到路径时走 onPaths，没拿到时走 onEmpty（不是"两边都调"或"两边都不调"）', () => {
    const at = do_.indexOf('if (paths.length) onPaths(paths)')
    expect(at, '两条分支的顺序变了，去看是不是把 else 删了').toBeGreaterThan(-1)
    expect(do_.slice(at, at + 200)).toContain('else onEmpty?.(')
  })

  it('⭐ App 的两个 useDropZone 调用点都把 onEmpty 递进去了（主窗口 + 小窗）', () => {
    /** 小窗（view=mini）是他日常拖放的另一扇门，只修主窗口等于没修 */
    expect(app.match(/useDropZone\(ingestPaths, onEmpty\)/g) ?? []).toHaveLength(2)
    expect(app, '还有一个调用点没接 onEmpty').not.toContain('useDropZone(ingestPaths)')
  })

  it('那个 handler 说的是判据决定的那句话，且话是 warn 不是 info（容易滑过去）', () => {
    const at = app.indexOf('function useDropEmpty')
    expect(at, 'useDropEmpty 没了').toBeGreaterThan(-1)
    const seg = app.slice(at, at + 400)
    expect(seg).toContain('dropEmptyKey(info)')
    expect(seg).toContain("toast('warn'")
    /** null（真拿到了路径）时必须一声不吭 */
    expect(seg).toContain('if (key)')
  })
})

describe('E3 · 诊断计数（根因未定死，下次要靠它分辨）', () => {
  it('drop 出口打一行 [drag] 日志，里面带四个事件计数', () => {
    const hits = do_.match(/console\.info\('\[drag\] '/g) ?? []
    expect(hits.length, '两处出口都该打日志').toBeGreaterThanOrEqual(2)
    for (const k of ['enter', 'over', 'leave', 'drop']) expect(do_, `少了 ${k} 计数`).toContain(`seen.current.${k}`)
  })

  it('日志里那四个数只在诊断用，界面不显示（避免把内部计数当产品数字）', () => {
    /** 用户能看到的只有那句 toast 文案；DropOverlay 渲染的那层只有 dropHint */
    const overlay = do_.slice(do_.indexOf('export function DropOverlay'))
    expect(overlay).toContain("t('library.dropHint')")
    expect(overlay).not.toContain('seen.current')
  })
})
