import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * **接线断言**：`defaultPath` 真的从界面传到了文件对话框吗？
 *
 * ## 为什么光有 `assetRootDirectory` 的用例不够
 *
 * 那个用例验的是**解析函数**（给一个素材，算出根目录），它全绿也不能证明
 * 界面点按钮时把这个目录真的**传给了对话框**。这个仓库为"实现了 ≠ 生效了"
 * 付过代价（见 `docs/CHANGE-REPORT-2026-10-06.md` §7.4：12 个真 bug 里有 5 个
 * 是单测全绿时照样存在的，包括"模块写好了但没人 import"那种死代码）。
 *
 * 2026-10-15 用户报的正是这一层：解析逻辑以前**根本不存在**，
 * 而 `system:pick-files` 从来不接 `defaultPath` —— 两处都缺，谁都没红。
 *
 * ## ⚠ 必须剥掉注释再判
 *
 * 我在修复处写了大量解释 `defaultPath` 的注释，直接用 `toContain('defaultPath')`
 * 扫源码，**即使把代码删掉、只留注释也照样通过**。
 * 这个坑在本仓库已经踩过（判"有没有调用某 API"必须剥注释），所以下面用 `strip()`。
 */

const REPO = path.resolve(__dirname, '../..')

/** 剥掉 `//` 行注释与块注释，只留代码 */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(line => {
      const i = line.indexOf('//')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

function codeOf(rel: string): string {
  return strip(fs.readFileSync(path.join(REPO, rel), 'utf8'))
}

/** 抠出一个具名函数的函数体（从 `function name(` 到下一个同级 `  }`） */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  expect(start, `没抠到 ${name} 的函数体 —— 抠取规则可能失效了`).toBeGreaterThan(-1)
  const end = src.indexOf('\n  }', start)
  return src.slice(start, end === -1 ? src.length : end)
}

/**
 * 抠出一个 `ipc.handle('<channel>', …)` 的整段。
 *
 * ⚠ 不能切成"到第一个 `})` 为止" —— 处理器的参数类型 `(opts?: { … })` 里
 * 就带着 `})`，那样切出来的片段在参数表处就断了，`defaultPath:` 那一行根本没进来
 * （写这份用例时第一次就是这么假失败的：代码明明改对了，用例却说没改）。
 * 改成切到**下一个 `ipc.handle(`** 为止。
 */
function handlerOf(src: string, channel: string): string {
  const marker = `'${channel}'`
  const start = src.indexOf(marker)
  expect(start, `没抠到 ${channel} 处理器 —— 抠取规则可能失效了`).toBeGreaterThan(-1)
  const next = src.indexOf('ipc.handle(', start + marker.length)
  return src.slice(start, next === -1 ? src.length : next)
}

describe('选择本地图片：defaultPath 的接线', () => {
  it('⭐ 界面点「选择本地图片」时，把**当前素材的根目录**传给了对话框', () => {
    const editor = codeOf('src/renderer/components/CoverEditor.tsx')
    const upload = bodyOf(editor, 'upload')
    /** 1. 真的去问当前素材的根目录（不是某个缓存/上一个素材） */
    expect(upload, 'upload() 没有调用 covers.assetRoot(assetId)').toContain('covers.assetRoot(assetId)')
    /** 2. 传的是**这个** assetId，不是别的变量 */
    expect(upload).toMatch(/assetRoot\(assetId\)/)
    /**
     * 3. `defaultPath` 的值必须**真的引用查出来的那个变量**。
     *
     * ⚠ 这里不能用宽松的 `defaultPath\s*:` —— 第一版就是这么写的，
     * 结果把 `defaultPath: root ?? undefined` 改成 `defaultPath: undefined`
     * **它照样通过**（`: ` 还在、`assetRoot` 也还在被调用，只是结果被丢掉了），
     * 只有旁边那条 `?? undefined` 的用例红了。等于没测住这条链路。
     */
    expect(upload, 'defaultPath 没有真正引用查到的根目录').toMatch(/defaultPath:\s*root\b/)
  })

  it('⭐ `system:pick-files` 主进程真的接住了 defaultPath（以前整条链路都缺这个参数）', () => {
    const handler = handlerOf(codeOf('src/main/ipc/system.ts'), 'system:pick-files')
    expect(handler, '处理器签名里没有 defaultPath').toMatch(/defaultPath/)
    expect(handler, '处理器没有把 defaultPath 放进 dialog 选项').toMatch(/defaultPath:\s*opts\?\.defaultPath/)
  })

  it('共享契约里 pickFiles 声明了 defaultPath（否则渲染进程传了也会被类型挡掉）', () => {
    const api = codeOf('src/shared/api.ts')
    const start = api.indexOf('pickFiles(')
    const decl = api.slice(start, api.indexOf('Promise<string[]>', start))
    expect(decl, 'api.ts 的 pickFiles 没有 defaultPath').toMatch(/defaultPath\?:\s*string/)
  })

  it('`covers:asset-root` 通道在共享白名单里（漏了的话 preload 会拦掉）', () => {
    const ipc = codeOf('src/shared/ipc.ts')
    expect(ipc, 'IpcInvoke 里没有 covers:asset-root').toContain("AssetRoot: 'covers:asset-root'")
    const main = codeOf('src/main/covers/ipc.ts')
    expect(main, '主进程没有注册这个通道').toContain("ipc.handle('covers:asset-root'")
    const preload = codeOf('src/preload/index.ts')
    expect(preload, 'preload 没有暴露 assetRoot').toContain("assetRoot: (assetId) => invoke('covers:asset-root'")
  })

  it('拿不到根目录时传 `undefined` 而不是编一个路径（退回系统默认行为）', () => {
    const upload = bodyOf(codeOf('src/renderer/components/CoverEditor.tsx'), 'upload')
    expect(upload, '应当有 ?? undefined 的回退').toMatch(/\?\?\s*undefined/)
  })

  it('按钮文案不再写死"加入摄取队列"（那是摄取流程的措辞，选封面时显示它很怪）', () => {
    const handler = handlerOf(codeOf('src/main/ipc/system.ts'), 'system:pick-files')
    expect(handler, '按钮文案应当可被调用方覆盖').toMatch(/opts\?\.buttonLabel/)
    const upload = bodyOf(codeOf('src/renderer/components/CoverEditor.tsx'), 'upload')
    expect(upload, '封面选图应当传自己的按钮文案').toMatch(/buttonLabel\s*:/)
  })
})
