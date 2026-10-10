/**
 * M7 · 首次启动向导的全部判据（纯函数）。
 *
 * ## 为什么判据必须在这儿，不在组件里
 *
 * 本仓库渲染层**零 DOM 测试**，判据写进组件就等于没测（这条在 M6 的 `bannerState.ts`、
 * R4 ⑦ 的 `bridgeAsk.ts` 里已经各吃过一次教训）。向导的分支比那两个还多：
 * 三态门禁（走完 / 跳过 / 没碰过）× 四步 × "老用户升级不许被拦" × "选到已有素材的目录"，
 * 所以全放这里，`FirstRunWizard.tsx` 只做映射。
 *
 * ## 裁定落点（第 6 轮 §8，他 2026-10-08 全批）
 *
 *  - **Q1**：判据用 `onboardingDone`（字段早就有，但**应用代码零读写**）+ 两个新键
 *    `onboardingStep` / `onboardingSkippedAt`。都在 electron-store，不为三个布尔开 SQLite 列。
 *  - **Q2**：`libraryRoot` 非空 = 已经配过 = 老用户，**直接放行主界面**。
 *    第 3 轮那条"升级即丢"的教训就是死在升级路径上多塞了一步。
 *  - **Q3**：第 ① 步选到"已经有素材的目录"要**当场二选一**，接管那条**只登记不搬盘**，
 *    并且把「高置信度自动归档」关掉 —— 这条以前只写在 README §收编 的第一句里，靠人自觉。
 *  - **Q4**：库根在 C 盘**只警告不拦**。（抽取根那条是硬错误，因为它要 2 倍空间余量、
 *    Unity 那边还要再写一遍；库根没这个客观理由，小白的库就在 C 盘。）
 *  - **Q8**：3 步 + 1 收尾。第 ②③④ 步都能跳过，**只有第 ① 步不能**（没库根产品是坏的）。
 *
 * ## 一条口径容易写错的地方
 *
 * 「稍后配置」**不能**写成 `onboardingDone = true`。它写的是 `onboardingSkippedAt`：
 * 下次启动不再拦人（那是用户的选择），但库根还是空的，侧栏那条"库还没配好"必须一直在。
 * 把 skip 当成 done 的话，用户会得到一个"看起来配好了、拖什么都报错"的软件。
 */

/** 向导的四步：① 库位置 ② 素材来源目录 ③ 装桥接 ④ 收尾（常驻托盘 / 热键） */
export type WizardStep = 1 | 2 | 3 | 4

export const WIZARD_STEPS: WizardStep[] = [1, 2, 3, 4]

/** 门禁的两种出口：画向导，还是画主界面 */
export type WizardGate = 'wizard' | 'main'

/** 第 ① 步选完之后，对那个目录的处理方式（Q3） */
export type LibraryChoice = 'adopt' | 'fresh'

export interface WizardInput {
  /** 走完向导（只有第 ④ 步或"完成"按钮会写它） */
  onboardingDone: boolean
  /** 用户点了「稍后配置」的时刻；null = 从没跳过 */
  onboardingSkippedAt: string | null
  /**
   * **本次启动时**库根是不是空的 —— 也就是"这台机器是全新安装"的那个瞬间。
   *
   * ⚠ 不能直接拿 `libraryRoot` 当判据：第 ① 步一落库根，`libraryRoot` 就不空了，
   * 于是向导会在用户刚选完目录的那一刻自己消失（第 7 轮活体第一次真点，就是这么撞出来的）。
   * 所以"老用户不拦"（Q2）和"向导走一半继续走"必须分开：前者看**启动时**有没有库根。
   */
  startedHere: boolean
  /** 主进程还没把设置读回来 —— 这一拍**不许**画向导，否则会闪一下再消失 */
  booted: boolean
}

/**
 * 该不该画向导。
 *
 * 顺序是刻意的：**先认"已经配过/已经答过"，再看这次是不是全新安装**。
 */
export function wizardGate(i: WizardInput): WizardGate {
  if (!i.booted) return 'main'
  if (i.onboardingDone) return 'main'
  if (i.onboardingSkippedAt) return 'main'
  /** 启动时库根已有值 → 老用户（Q2），不拦；启动时是空的 → 全新安装，一路走完向导 */
  return i.startedHere ? 'wizard' : 'main'
}

/**
 * 「本次启动时库根是空的吗」—— 全新安装的唯一判据。
 *
 * 单独抽出来是因为它只在 boot 那一刻算一次：算完就存进 store，
 * 之后第 ① 步把 `libraryRoot` 填上也不许改口（否则向导会当场把自己关掉）。
 * 只有空格的库根算空的。
 */
export function startedHereFrom(libraryRoot: string | null | undefined): boolean {
  return !(libraryRoot ?? '').trim()
}

/**
 * 主界面上那条"库还没配好"的提示该不该出现。
 *
 * 和门禁是**两件事**：跳过向导之后不再拦人，但只要库根是空的，入口必须留着，
 * 否则用户下次想配就找不到地方了。
 */
export function needsLibrarySetup(libraryRoot: string | null | undefined): boolean {
  return startedHereFrom(libraryRoot)
}

export interface StepProgress {
  /** 现在应该停在哪一步（断点续填） */
  step: WizardStep
  /** 每一步是不是已经满足（用来画"已配好"的对勾，也用来决定"完成"能不能点） */
  done: Record<WizardStep, boolean>
}

export interface StepFacts {
  libraryRoot: string | null
  /** 库根被主进程那道禁列闸判过不通过（`isForbiddenLibraryRoot`，渲染层不能 import 它，所以传进来） */
  libraryRootForbidden: boolean
  /** 第 ① 步之后有没有明确选过 adopt / fresh */
  libraryChoice: LibraryChoice | null
  watchedFolders: string[]
  /** 第 ③ 步已经装了几个工程（0 也算，这一步可跳过） */
  bridgesInstalled: number
  /** 第 ④ 步：常驻托盘那一问有没有答过（答过什么由 `autoLaunch` 记，这里只记"问过没有"） */
  autoLaunchAsked: boolean
}

/**
 * 某一步"能不能离开"。**只有第 ① 步是硬的**（规格 01§8 明写第 ③ 步可跳过，
 * 而第 ②④ 步本来就有默认值可用）。
 */
export function canLeaveStep(step: WizardStep, f: StepFacts): boolean {
  if (step !== 1) return true
  const root = (f.libraryRoot ?? '').trim()
  return !!root && !f.libraryRootForbidden && !!f.libraryChoice
}

/** 每一步是否已满足（用于画勾；和 `canLeaveStep` 的口径故意不同：跳过的步不算满足） */
export function stepDone(f: StepFacts): Record<WizardStep, boolean> {
  const root = (f.libraryRoot ?? '').trim()
  return {
    1: !!root && !f.libraryRootForbidden && !!f.libraryChoice,
    2: (f.watchedFolders ?? []).length > 0,
    3: f.bridgesInstalled > 0,
    4: f.autoLaunchAsked
  }
}

/**
 * 断点续填：从前往后找第一个没满足的步。
 * 全满足就停在最后一步（收尾），让"完成"那颗按钮有地方待着。
 */
export function wizardProgress(f: StepFacts): StepProgress {
  const done = stepDone(f)
  for (const s of WIZARD_STEPS) if (!done[s]) return { step: s, done }
  return { step: 4, done }
}

/** 探测一个目录的结果（主进程只读填出来，这里只做判定） */
export interface DirectoryFacts {
  /** 目录存不存在（选了个刚拔掉的盘） */
  exists: boolean
  /** 顶层子目录数 */
  dirCount: number
  /** 递归数到的受支持素材文件数（主进程那边有封顶，量不到时给 -1） */
  supportedFileCount: number
  /** 盘符，小写不带冒号；'' = 未知 */
  drive: string
  /** 剩余字节；量不到 = -1 */
  freeBytes: number
}

/**
 * 主进程 `system:probe-directory` 的返回。
 * 比 `DirectoryFacts` 多两个字段，都是给界面用的，**不参与判定**（判定只看上面那五个）。
 */
export interface DirectoryProbe extends DirectoryFacts {
  problemKey?: string | null
  /** 探的是哪个目录（原样带回，界面之后要拿它落 `libraryRoot`） */
  path: string
  /** 数到封顶了（界面要写成"500+"而不是"500"，别谎报精确值） */
  capped: boolean
  /** 探测过程中有没有跳过读不动的子目录（权限、坏软链） */
  skipped: number
}

/** 从设置里读回来的步数可能是脏的（手改过 settings.json、老版本没这个键） */
export function clampStep(n: unknown): WizardStep {
  return WIZARD_STEPS.includes(n as WizardStep) ? (n as WizardStep) : 1
}

/**
 * 选到这个目录之后，要不要当场问"接管还是建空库"（Q3）。
 *
 * 判据取的是**宁松不紧**：只要数到过一个受支持的文件，或者顶层目录多于两个，
 * 就当它"像已经有素材"。反过来，只有**明确是空的**才直接建库 ——
 * 误判成"像有素材"的代价是多问一句，误判成"空的"的代价是把一个 24 GB 的库当空库用。
 */
export function adoptOrFresh(f: DirectoryFacts): 'ask' | 'fresh' {
  if (!f.exists) return 'fresh'
  if (f.supportedFileCount < 0) return 'ask'
  if (f.supportedFileCount >= 1) return 'ask'
  return f.dirCount > 2 ? 'ask' : 'fresh'
}

/**
 * 选定处理方式之后要写的设置补丁。
 *
 * ⚠ 接管**必须**把 `autoArchive` 关成 false：这是 README §收编 第一条要求，
 * 以前只写在文档里、靠人自觉，现在由这里代劳。
 * 建空库那条不动 `autoArchive`（新库没有存量素材会被误搬）。
 * 两条都**只改指向，不搬盘** —— 全仓没有、也不该有"改库根时迁移文件"那种代码。
 */
export function libraryChoicePatch(
  choice: LibraryChoice,
  current: { autoArchive: boolean }
): { libraryRoot?: string; autoArchive?: boolean } {
  if (choice === 'adopt') return { autoArchive: false }
  return { autoArchive: current.autoArchive }
}

/** 库根落在系统盘 —— 只警告（Q4） */
export function warnSystemDrive(libraryRoot: string | null): boolean {
  const m = /^([a-z]):/i.exec((libraryRoot ?? '').trim())
  return !!m && m[1].toLowerCase() === 'c'
}

/** 剩余空间低于这条线就在第 ① 步提示（20 GB：实测他一次收编几百项会解出几十 GB） */
export const LOW_FREE_BYTES = 20 * 1024 * 1024 * 1024

export function warnLowFreeSpace(f: DirectoryFacts): boolean {
  if (f.freeBytes < 0) return false
  return f.freeBytes < LOW_FREE_BYTES
}

/** 目录根本不存在 / 拿不到信息 —— 第 ① 步要拦，不能让人带着一个不存在的库根往下走 */
export function directoryUnusable(f: DirectoryFacts): boolean {
  return !f.exists
}

/** 答常驻托盘那一问要写的键（Q8：这一问从运行期模态挪进向导收尾，答过就不再问） */
export function autoLaunchAnswerPatch(accept: boolean): { autoLaunch: boolean; autoLaunchAsked: boolean } {
  return { autoLaunch: accept, autoLaunchAsked: true }
}

/** 走完向导 */
export function finishPatch(): { onboardingDone: boolean; onboardingSkippedAt: null; onboardingStep: 4 } {
  return { onboardingDone: true, onboardingSkippedAt: null, onboardingStep: 4 }
}

/** 点「稍后配置」：写 skip，**不写 done**（见文件头那条口径） */
export function skipPatch(nowIso: string): { onboardingDone: boolean; onboardingSkippedAt: string } {
  return { onboardingDone: false, onboardingSkippedAt: nowIso }
}

/** 中途退出时存进度，下次进来还停在原来那一步 */
export function stepPatch(step: WizardStep): { onboardingStep: number } {
  return { onboardingStep: step }
}

/**
 * 第 ④ 步"确认"那一屏要列的清单。
 *
 * 存在的理由：向导走完之前必须让他**看见自己刚定了什么**，尤其是"接管已有库"和
 * "往 N 个工程写桥接"这两件会动盘的事。文案在 i18n，这里只给结构化条目。
 */
export interface SummaryLine {
  key: 'libraryRoot' | 'mode' | 'watched' | 'bridges' | 'autoLaunch' | 'hotkey'
  value: string
  /** 这一条会不会动盘（动盘的那几条在界面上要标出来） */
  touchesDisk: boolean
}

export function summaryLines(f: StepFacts & { autoLaunch: boolean }, mode: LibraryChoice | null, hotkey: string): SummaryLine[] {
  const out: SummaryLine[] = []
  out.push({ key: 'libraryRoot', value: (f.libraryRoot ?? '').trim(), touchesDisk: false })
  /**
   * 接管那条**不算动盘**：它只写设置（库根 + 关掉自动归档），一个素材文件都不搬 ——
   * 卡片上明写"一个文件都不搬、不改名"，摘要再标"会动磁盘"就是自己打自己脸。
   * （第 7 轮活体看截图时发现的口径错。）
   */
  if (mode) out.push({ key: 'mode', value: mode, touchesDisk: false })
  out.push({ key: 'watched', value: String((f.watchedFolders ?? []).length), touchesDisk: false })
  out.push({ key: 'bridges', value: String(f.bridgesInstalled), touchesDisk: f.bridgesInstalled > 0 })
  out.push({ key: 'autoLaunch', value: f.autoLaunch ? 'on' : 'off', touchesDisk: false })
  out.push({ key: 'hotkey', value: hotkey, touchesDisk: false })
  return out
}
