/**
 * 第 9 轮 ① · 复核出口的**接线**（判据在 `tests/shared/review-state.spec.ts`，那份管"该不该出按钮"，
 * 这份管"按钮有没有真长出来、点下去有没有真接到后端"）。
 *
 * ## 为什么这份特别重要
 *
 * 本轮修的那个缺陷本身就是"接线断了"：`assets:set-review` 从主进程到 preload 到 api **全通**，
 * 渲染层却只有合集详情那一处在调它 —— 于是单卡根本没有出口。
 * 判据用例写得再满，也防不住"没人调用"。这个仓库为同一件事栽过四次
 * （`project/running.ts` 死代码、两个死设置、`libraryRootOrThrow` 零调用），
 * 所以这里把四处接线各钉一条。
 *
 * ## 零 DOM 测试，只能读源码钉结构
 *
 * 结构级断言有个天生的毛病：**改个写法（比如把 `attachment:` 换成展开运算符）就会红**。
 * 这是故意的 —— 这几处的形状就是语义本身，要换写法的人必须先在判据层把新形状解释清楚。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

/** 断言 API 存在/顺序之前先剥注释（注释里也写着函数名，不剥就是假绿） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

describe('A1 · 单卡详情面板那颗按钮', () => {
  const panel = stripComments(read('src/renderer/components/DetailPanel.tsx'))

  it('判据走 shared，不在组件里另写一份"该不该出"', () => {
    expect(panel).toContain('singleReviewAction(')
  })

  it('⭐ 三种形状都接上了：主按钮、次要链接、改完分类那句提示', () => {
    expect(panel).toContain('rv.prominent')
    expect(panel).toContain("t('library.markReviewed')")
    expect(panel).toContain("t('library.markUnreviewed')")
    expect(panel).toContain("t('library.reviewAfterEditHint')")
  })

  it('⭐ 附属那条判据真的喂给了函数（漏了就等于附属又能单独复核）', () => {
    expect(panel).toMatch(/attachment:\s*Boolean\(asset\.attachment_kind\)/)
  })

  it('点下去走 store 那颗（只有直接摸 IPC 就会漏掉刷新，侧栏那个数不动）', () => {
    expect(panel).toMatch(/setReview\(\[asset\.id\],\s*(false|true)\)/)
    expect(panel).not.toContain('window.a.assets.setReview')
  })
})

describe('A2 · 待复核视图的批量出口', () => {
  const grid = stripComments(read('src/renderer/components/AssetGrid.tsx'))

  it('四道判据都从 shared 来', () => {
    for (const fn of ['reviewTargets', 'reviewConfirmCount', 'showBatchReview', 'showReviewAllOnScreen']) {
      expect(grid, `AssetGrid 不再用 shared 的 ${fn}`).toContain(fn)
    }
  })

  it('⭐ 绑的是"当前在待复核视图"，不是"选中了几张"', () => {
    expect(grid).toContain("const onReviewScreen = nav === 'review'")
  })

  it('⭐ 确认框里的条数来自 reviewConfirmCount，不是 selection.length（Q2 甲）', () => {
    /**
     * 两处都得钉死。原来这里只写了一条 `/n:\s*reviewConfirmCount\(/`，
     * 变异回扫（B4）把它抓成**假绿**：把"选中那批"的条数换成 `selection.length`，
     * 正则照样命中 —— 因为旁边"这一屏全部"那颗也写着 `reviewConfirmCount(`。
     * 一个能同时匹配两颗按钮的断言，等于只钉了"至少有一颗是对的"。
     */
    expect(grid).toMatch(/n:\s*reviewConfirmCount\(selectedReview\.length\)/)
    expect(grid).toMatch(/n:\s*reviewConfirmCount\(screenReview\.length\)/)
    /** 正文那句的 count 也必须来自那份数据，不然"说好的 2 条、实际改了 3 条" */
    expect(grid).toMatch(/reviewConfirmBody',\s*\{\s*count:\s*reviewAsk\?\.n/)
  })

  it('二次确认用的是真 Modal，确认那颗真的调 setReview', () => {
    expect(grid).toContain('<Modal')
    expect(grid).toMatch(/if \(a\) void setReview\(a\.ids, false\)/)
  })
})

describe('合集那条出口（本轮查出来的第二个死账）', () => {
  const bundle = stripComments(read('src/renderer/components/BundleDetail.tsx'))

  it('⭐ 容器那一行跟着一起清 —— 只清成员会让合集卡永远留在待复核里', () => {
    expect(bundle).toMatch(/setReview\(\[\.\.\.picked,\s*bundleId\],\s*false\)/)
  })

  it('改走 store 那颗，不再直接摸 IPC（直接摸就不刷侧栏的数）', () => {
    expect(bundle).not.toContain('window.a.assets.setReview')
  })
})

describe('store 里那颗 setReview', () => {
  const ui = stripComments(read('src/renderer/stores/ui.ts'))

  it('调 IPC、刷列表、刷统计，三样一件不缺', () => {
    const body = ui.slice(ui.indexOf('async setReview('))
    const seg = body.slice(0, body.indexOf('\n    },'))
    for (const call of ['window.a.assets.setReview', 'refreshList()', 'refreshMeta()']) {
      expect(seg, `setReview 少了 ${call}`).toContain(call)
    }
  })

  it('⭐ 清掉选中与详情（刚标完的卡会从这一屏消失，不清就留"选中 3 张、屏上 0 张"的鬼状态）', () => {
    expect(ui).toMatch(/set\(\{\s*selection:\s*\[\],\s*detail:\s*null,\s*detailId:\s*null\s*\}\)/)
  })

  it('不进 journal（Q3 乙：它只改一列元数据，反悔的方式是再点一次）', () => {
    const body = ui.slice(ui.indexOf('async setReview('))
    expect(body.slice(0, body.indexOf('\n    },'))).not.toContain('register(')
  })
})
