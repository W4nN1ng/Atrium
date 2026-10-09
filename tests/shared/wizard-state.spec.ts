/**
 * M7 · 首启向导判据（`src/shared/wizardState.ts`）。
 *
 * 本仓渲染层零 DOM 测试，所以向导所有分支都必须在这份纯函数层被钉住。
 * 最值得钉的三件事（都是设计里点过名的）：
 *  1. **老用户升级不许被拦**（Q2）—— `libraryRoot` 有值就必须直接放行，
 *     哪怕 `onboardingDone` 因为升级缺省是 false。
 *  2. **「稍后配置」≠「已完成」**（文件头那条口径）—— skip 之后不再拦人，
 *     但"库还没配好"的提示必须还在。写成 done 的话用户会拿到一个"看着配好了、拖什么都报错"的软件。
 *  3. **接管分支必须关掉高置信度自动归档**（Q3）—— 这条以前只写在 README §收编 第一句里靠人自觉，
 *     现在由代码代劳；`libraryChoicePatch` 改成 `autoArchive: true` 必须有用例红。
 */
import { describe, expect, it } from 'vitest'
import {
  LOW_FREE_BYTES,
  adoptOrFresh,
  autoLaunchAnswerPatch,
  canLeaveStep,
  clampStep,
  directoryUnusable,
  finishPatch,
  libraryChoicePatch,
  needsLibrarySetup,
  skipPatch,
  stepDone,
  stepPatch,
  startedHereFrom,
  summaryLines,
  warnLowFreeSpace,
  warnSystemDrive,
  wizardGate,
  wizardProgress,
  type DirectoryFacts,
  type StepFacts,
  type WizardInput
} from '../../src/shared/wizardState'

/** 一个"什么都没配过"的干净输入，逐条测试只改自己关心的那个字段 */
function input(over: Partial<WizardInput> = {}): WizardInput {
  return {
    onboardingDone: false,
    onboardingSkippedAt: null,
    startedHere: true,
    booted: true,
    ...over
  }
}

function facts(over: Partial<StepFacts> = {}): StepFacts {
  return {
    libraryRoot: null,
    libraryRootForbidden: false,
    libraryChoice: null,
    watchedFolders: [],
    bridgesInstalled: 0,
    autoLaunchAsked: false,
    ...over
  }
}

function dir(over: Partial<DirectoryFacts> = {}): DirectoryFacts {
  return { exists: true, dirCount: 0, supportedFileCount: 0, drive: 'e', freeBytes: 100 * 1024 * 1024 * 1024, ...over }
}

/** 第 ① 步"能走"的那三样齐了没 —— 下面几步的输入都基于它 */
const step1Ok = { libraryRoot: 'E:\\vrc\\A', libraryChoice: 'adopt' as const }

describe('wizardGate · 该不该画向导', () => {
  it('全新安装（启动时库根是空的）→ 画向导', () => {
    expect(wizardGate(input())).toBe('wizard')
  })

  it('⭐ Q2：老用户（启动时就有库根）即使 onboardingDone=false 也直接放行', () => {
    /** 升级上来的实例正是这个形状：库里早就有库根，而 onboardingDone 这个新键缺省是 false */
    expect(wizardGate(input({ startedHere: false }))).toBe('main')
  })

  it('⭐ 第 ① 步刚落库根、向导还没走完 → 必须继续画（第 7 轮活体第一次真点撞到的）', () => {
    /**
     * 判据要是写成"看当前 libraryRoot 空不空"，用户点完「接管这个库」的那一瞬间
     * 库根就不空了 → 向导当场把自己关掉，第 ②③④ 步永远走不到。
     * 活体里看到的就是这个：点完接管直接落到主界面收件箱。
     */
    expect(wizardGate(input({ startedHere: true }))).toBe('wizard')
  })

  it('走完向导 → 主界面', () => {
    expect(wizardGate(input({ onboardingDone: true, startedHere: false }))).toBe('main')
  })

  it('点了「稍后配置」→ 主界面（不再拦人）', () => {
    expect(wizardGate(input({ onboardingSkippedAt: '2026-10-08T12:00:00Z' }))).toBe('main')
  })

  it('设置还没读回来那一拍不许画向导（否则会闪一下再消失）', () => {
    expect(wizardGate(input({ booted: false }))).toBe('main')
  })

  it('脏状态（done=true 但库根空）走主界面，而不是把向导再弹一遍', () => {
    /** 拦在向导里只会让人以为"软件坏了又回到第一步"；这条由 needsLibrarySetup 负责提示 */
    expect(wizardGate(input({ onboardingDone: true }))).toBe('main')
  })
})

describe('clampStep · 从设置里读回来的步数可能是脏的', () => {
  it('1–4 原样收下', () => {
    for (const n of [1, 2, 3, 4]) expect(clampStep(n), String(n)).toBe(n)
  })

  it('手改过的 settings.json / 老版本没这个键 → 一律回到第 ① 步，不许停在第 9 步或 NaN', () => {
    for (const n of [0, -3, 5, 99, 1.5, NaN, Infinity, '2', undefined, null]) expect(clampStep(n), JSON.stringify(n) ?? 'undefined').toBe(1)
  })
})

describe('startedHereFrom · "全新安装"怎么算', () => {
  it('null / 空串 / 只有空格 都算没配过', () => {
    for (const v of [null, '', '   ', '\t']) {
      expect(startedHereFrom(v), JSON.stringify(v)).toBe(true)
    }
  })

  it('有值就不算（老用户不许被拦）', () => {
    expect(startedHereFrom('E:\\vrc\\A')).toBe(false)
  })
})

describe('needsLibrarySetup · 拦不拦和提不提是两件事', () => {
  it('⭐ 「稍后配置」之后不再拦人，但仍然提示"库还没配好"（skip 不等于 done）', () => {
    const skipped = input({ onboardingSkippedAt: '2026-10-08T12:00:00Z' })
    expect(wizardGate(skipped)).toBe('main')
    expect(needsLibrarySetup(null)).toBe(true)
  })

  it('配好库根之后提示消失', () => {
    expect(needsLibrarySetup('E:\\vrc\\A')).toBe(false)
  })
})

describe('canLeaveStep · 只有第 ① 步是硬的', () => {
  it('第 ① 步：没库根不能走', () => {
    expect(canLeaveStep(1, facts({ ...step1Ok, libraryRoot: null }))).toBe(false)
  })

  it('第 ① 步：库根被主进程禁列闸判不过，不能走', () => {
    expect(canLeaveStep(1, facts({ ...step1Ok, libraryRootForbidden: true }))).toBe(false)
  })

  it('第 ① 步：探测到了"像已有素材"但还没选接管/建空库，不能走', () => {
    expect(canLeaveStep(1, facts({ libraryRoot: 'E:\\vrc\\A', libraryChoice: null }))).toBe(false)
  })

  it('第 ① 步：三样齐了才能走', () => {
    expect(canLeaveStep(1, facts(step1Ok))).toBe(true)
  })

  it('第 ②③④ 步都能跳过（规格 01§8 明写第 ③ 步可跳过，②④ 本来就有默认值）', () => {
    for (const s of [2, 3, 4] as const) {
      expect(canLeaveStep(s, facts()), `第 ${s} 步应该能跳过`).toBe(true)
    }
  })
})

describe('stepDone / wizardProgress · 断点续填', () => {
  it('全新 → 停在第 ① 步', () => {
    expect(wizardProgress(facts()).step).toBe(1)
  })

  it('配好库根、没加监视目录 → 停在第 ② 步', () => {
    expect(wizardProgress(facts(step1Ok)).step).toBe(2)
  })

  it('四步全满足 → 停在收尾那一步，让"完成"有地方待着', () => {
    const p = wizardProgress(facts({ ...step1Ok, watchedFolders: ['D:\\dl'], bridgesInstalled: 2, autoLaunchAsked: true }))
    expect(p.step).toBe(4)
    expect(Object.values(p.done).every(Boolean)).toBe(true)
  })

  it('跳过的步**不算**满足（done 只认盘上真有的东西，否则第 ③ 步装了 0 个也打勾）', () => {
    const d = stepDone(facts({ ...step1Ok, watchedFolders: ['D:\\dl'], bridgesInstalled: 0, autoLaunchAsked: true }))
    expect(d[2]).toBe(true)
    expect(d[3]).toBe(false)
    expect(d[4]).toBe(true)
  })
})

describe('adoptOrFresh · Q3 那一步的判据', () => {
  it('空目录 → 直接建空库，不问', () => {
    expect(adoptOrFresh(dir())).toBe('fresh')
  })

  it('数到过一个受支持的文件 → 要问', () => {
    expect(adoptOrFresh(dir({ supportedFileCount: 1 }))).toBe('ask')
  })

  it('一个文件都没有、但顶层目录多于两个 → 也要问（散着放的解压库就是这个形状）', () => {
    expect(adoptOrFresh(dir({ dirCount: 3 }))).toBe('ask')
  })

  it('⭐ 量不到（-1）→ 一律问，不许猜"空的"（误判成空库的代价是把 24 GB 当空库用）', () => {
    expect(adoptOrFresh(dir({ supportedFileCount: -1 }))).toBe('ask')
  })

  it('目录不存在 → fresh，但 directoryUnusable 会先把它拦在第 ① 步', () => {
    const gone = dir({ exists: false, dirCount: 50, supportedFileCount: 50 })
    expect(adoptOrFresh(gone)).toBe('fresh')
    expect(directoryUnusable(gone)).toBe(true)
  })
})

describe('libraryChoicePatch · 接管那条要顺手关掉自动归档', () => {
  it('⭐ Q3：接管 → autoArchive=false，哪怕原来是 true', () => {
    expect(libraryChoicePatch('adopt', { autoArchive: true }).autoArchive).toBe(false)
  })

  it('建空库 → 保持原值（新库没有存量素材会被误搬）', () => {
    expect(libraryChoicePatch('fresh', { autoArchive: true }).autoArchive).toBe(true)
    expect(libraryChoicePatch('fresh', { autoArchive: false }).autoArchive).toBe(false)
  })
})

describe('Q4 的警告口径 · 只警告，不拦', () => {
  it('C 盘库根 → 警告', () => {
    expect(warnSystemDrive('C:\\Users\\me\\A')).toBe(true)
    expect(warnSystemDrive('c:\\a')).toBe(true)
  })

  it('别的盘 / 没设 → 不警告', () => {
    expect(warnSystemDrive('E:\\vrc\\A')).toBe(false)
    expect(warnSystemDrive(null)).toBe(false)
  })

  it('剩余空间低于线 → 警告；量不到（-1）→ 不警告（有些盘就是读不到）', () => {
    expect(warnLowFreeSpace(dir({ freeBytes: LOW_FREE_BYTES - 1 }))).toBe(true)
    expect(warnLowFreeSpace(dir({ freeBytes: LOW_FREE_BYTES + 1 }))).toBe(false)
    expect(warnLowFreeSpace(dir({ freeBytes: -1 }))).toBe(false)
  })
})

describe('写回去的那几个补丁', () => {
  it('⭐ skipPatch 绝不写 onboardingDone=true（这是全文件最容易写错的一条）', () => {
    const p = skipPatch('2026-10-08T12:00:00Z')
    expect(p.onboardingDone).toBe(false)
    expect(p.onboardingSkippedAt).toBe('2026-10-08T12:00:00Z')
  })

  it('finishPatch 把 skip 清掉（先跳过、后来配完了，不该还留着"跳过"的痕）', () => {
    expect(finishPatch().onboardingSkippedAt).toBeNull()
    expect(finishPatch().onboardingDone).toBe(true)
  })

  it('stepPatch 只写步数这一件事（存进度不许顺手把 done/skip 也改了）', () => {
    expect(stepPatch(3)).toEqual({ onboardingStep: 3 })
  })

  it('收尾那一问：答"是"答"否"都算问过了（否则下次还要再骚扰一次）', () => {
    expect(autoLaunchAnswerPatch(true)).toEqual({ autoLaunch: true, autoLaunchAsked: true })
    expect(autoLaunchAnswerPatch(false)).toEqual({ autoLaunch: false, autoLaunchAsked: true })
  })
})

describe('summaryLines · 走完之前要让他看见自己定了什么', () => {
  it('⭐ 只有"装了桥接"那条算动盘；接管不算 —— 卡片上明写"一个文件都不搬"，摘要不能自己打脸', () => {
    const lines = summaryLines(
      { ...facts({ ...step1Ok, watchedFolders: ['D:\\dl'], bridgesInstalled: 2, autoLaunchAsked: true }), autoLaunch: true },
      'adopt',
      'Ctrl+Alt+A'
    )
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]))
    expect(byKey.mode.touchesDisk).toBe(false)
    expect(byKey.bridges.touchesDisk).toBe(true)
    expect(byKey.watched.touchesDisk).toBe(false)
    expect(byKey.libraryRoot.touchesDisk).toBe(false)
    expect(byKey.mode.value).toBe('adopt')
    expect(byKey.hotkey.value).toBe('Ctrl+Alt+A')
  })

  it('一个桥接都没装 → 那条也不算动盘', () => {
    const lines = summaryLines({ ...facts({ ...step1Ok }), autoLaunch: false }, 'fresh', 'Ctrl+Alt+A')
    expect(lines.find((l) => l.key === 'bridges')?.touchesDisk).toBe(false)
  })
})
