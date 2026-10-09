/**
 * M7 · 向导的**接线**（不是判据 —— 判据在 `tests/shared/wizard-state.spec.ts`）。
 *
 * 为什么单独一份：这个仓库栽过太多次"纯函数全绿但没人调用"
 * （`project/running.ts` 死代码、`autoSwitchBehavior`/`bridgeAutoInstall` 两个死设置、
 * `libraryRootOrThrow` 定义了零调用）。渲染层零 DOM 测试，能自动化的就只剩"读源码钉结构"，
 * 所以这里把四段接线各钉一条：**常量 / 主进程 / preload / 渲染层**，缺一段就红。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

/** 断言 API 存在/顺序之前先剥注释（这条规矩是被坑出来的：注释里也写着函数名） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

describe('M7 向导接在哪些地方', () => {
  it('App 真的按 wizardGate 二选一渲染，向导挂在 booted 之后', () => {
    const app = stripComments(read('src/renderer/App.tsx'))
    expect(app).toContain('wizardGate(')
    expect(app).toContain('<FirstRunWizard')
    /** 顺序：先"没 boot 就显示 loading"，再判门禁 —— 反了会先闪一下向导 */
    expect(app.indexOf('if (!booted)'), '门禁写在 booted 判定之前了').toBeLessThan(app.indexOf('wizardGate('))
    /** 小窗（拖放快捷入口）那条早退必须还在向导前面，否则小窗会被向导顶掉 */
    expect(app.indexOf("get('view') === 'mini'")).toBeLessThan(app.indexOf('wizardGate('))
  })

  it('⭐ startedHere 是 sticky 的：只有"已经是 true"或"启动时库根为空"才让它为 true', () => {
    /**
     * 这条是第 7 轮活体撞出来的：`patchSettings({libraryRoot})` 会再 boot 一次，
     * 那时库根已经不空 —— 谁把 sticky 那半边去掉，向导就会在第 ① 步之后自己关掉自己。
     */
    const ui = stripComments(read('src/renderer/stores/ui.ts'))
    expect(ui).toMatch(/wizardStartedHere:\s*get\(\)\.wizardStartedHere\s*\|\|\s*startedHereFrom\(settings\.libraryRoot\)/)
  })

  it('库根闸门与向导用的是同一个判据（不许在组件里另写一份"空不空"）', () => {
    const ui = stripComments(read('src/renderer/stores/ui.ts'))
    expect(ui).toContain('startedHereFrom(settings.libraryRoot)')
    const wizard = stripComments(read('src/renderer/components/FirstRunWizard.tsx'))
    /** 组件只做映射：所有分支判断都从 shared 来（`wizardGate` 归 App 用，上面那条已经钉了） */
    for (const fn of ['canLeaveStep', 'adoptOrFresh', 'stepDone', 'summaryLines', 'warnSystemDrive', 'warnLowFreeSpace', 'directoryUnusable']) {
      expect(wizard, `FirstRunWizard 不再走 shared 的 ${fn} 就等于把判据搬回组件里`).toContain(fn)
    }
    const chrome = stripComments(read('src/renderer/components/chrome.tsx'))
    expect(chrome).toContain('needsLibrarySetup(settings.libraryRoot)')
  })

  it('⭐ 跳过之后侧栏要留口子：入口 + 擦掉跳过痕，两段都得在', () => {
    const chrome = stripComments(read('src/renderer/components/chrome.tsx'))
    expect(chrome).toContain('library.setupNeeded')
    expect(chrome).toContain('reopenWizard()')
    const ui = stripComments(read('src/renderer/stores/ui.ts'))
    const from = ui.indexOf('async reopenWizard()')
    expect(from, 'store 里的 reopenWizard 不见了').toBeGreaterThan(-1)
    const body = ui.slice(from, from + 400)
    /** 擦掉 skip 才有机会让 wizardGate 重新往 'wizard' 走；顺手把 startedHere 拨成 true */
    expect(body).toContain('onboardingSkippedAt: null')
    expect(body).toContain('wizardStartedHere: true')
  })

  it('三语都给了这条文案（漏一种语言，界面上会退回 key 本身）', () => {
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const o = JSON.parse(read(`src/renderer/i18n/${loc}.json`)) as { library?: Record<string, string>; wizard?: Record<string, unknown> }
      expect(typeof o.library?.setupNeeded, `${loc} 缺 library.setupNeeded`).toBe('string')
      expect(o.wizard, `${loc} 整个 wizard 命名空间没了`).toBeTruthy()
    }
  })
})
