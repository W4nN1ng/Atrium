/**
 * 第 9 轮 ② · B4 存量重并的**接线**（判据与执行在 `tests/library/remerge.spec.ts`）。
 *
 * 单独一份的理由和 ① 一样，而且更硬：本轮修的那个症状，根因就是"规则修好了但没人把它
 * 作用到存量上"—— 一个只存在后端、界面上点不到的功能，等于没做。
 * 所以这里钉的是**四段链路一段都不能缺**：通道名 / 主进程 / preload / 界面挂载。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

/** 断言 API 存在/顺序之前先剥注释（注释里也写着函数名） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

describe('B4 的链路：通道 → 主进程 → preload → 界面', () => {
  it('通道名只有一处定义，两边都用常量', () => {
    const ipc = stripComments(read('src/shared/ipc.ts'))
    expect(ipc).toContain("PlanRemerge: 'health:plan-remerge'")
    expect(ipc).toContain("ApplyRemerge: 'health:apply-remerge'")
  })

  it('⭐ 主进程落地时**重扫一遍**，不信前端传来的预览', () => {
    const assets = stripComments(read('src/main/ipc/assets.ts'))
    const body = assets.slice(assets.indexOf("ipc.handle('health:apply-remerge'"))
    const seg = body.slice(0, body.indexOf('})', body.indexOf('applyRemerge(')))
    expect(seg, 'apply 里没有现扫的 planRemerge —— 拿过期预览写库等于按旧地图挪新数据').toContain('planRemerge(db, lex)')
    expect(seg).toContain('applyRemerge(db')
    /** 做完必须广播，否则界面还挂着旧的分组 */
    expect(seg).toContain("broadcast('data:changed'")
  })

  it('preload 与 api 类型都接上了（少一段就是渲染层调不到）', () => {
    const preload = stripComments(read('src/preload/index.ts'))
    expect(preload).toContain("invoke('health:plan-remerge')")
    expect(preload).toContain("invoke('health:apply-remerge'")
    const api = stripComments(read('src/shared/api.ts'))
    expect(api).toContain('planRemerge(): Promise<RemergePlanView>')
    expect(api).toContain('applyRemerge(keys: string[])')
  })

  it('⭐ 面板真的挂在设置页里（后端全通、界面上没有入口 = ① 那个毛病重演一遍）', () => {
    const settings = stripComments(read('src/renderer/pages/Settings.tsx'))
    expect(settings).toContain("import { RemergePanel } from '../components/RemergePanel'")
    expect(settings).toContain('<RemergePanel />')
  })

  it('面板的三步都在：先扫、再确认、做完能整批退回', () => {
    const panel = stripComments(read('src/renderer/components/RemergePanel.tsx'))
    expect(panel).toContain('window.a.health.planRemerge()')
    expect(panel).toContain('window.a.health.applyRemerge([])')
    /**
     * ⑥ 之后撤销**带靶子**：那颗撤的是"刚才那一次"，不是"当时最新的那一步"。
     * （面板上没有告知条那个十几秒的窗口，但用户完全可能合并完先去别处点两下再回来。）
     */
    expect(panel).toContain('window.a.journal.undoLast(lastBatch || null)')
    expect(panel).toContain('setLastBatch(r.batchId)')
    /** 文案走 messageKey：直接 toast 主进程那句中文，切了英文界面也还是中文 */
    expect(panel).toContain('msg(u.messageKey, u.messageParams')
    /** 只读预览 + 落地两段分开：不许有"打开页面就自己改库"的路径 */
    expect(panel).not.toMatch(/useEffect\([^)]*applyRemerge/)
  })

  it('⭐ 预览逐条写"从哪个键 → 到哪个键"，不是只报一个数字', () => {
    const panel = stripComments(read('src/renderer/components/RemergePanel.tsx'))
    expect(panel).toContain('r.fromKey')
    expect(panel).toContain('r.toKey')
    /** 歧义闸门挡掉的那几处也要显示出来，不显示用户会以为程序漏看 */
    expect(panel).toContain('skippedAmbiguous')
  })
})
