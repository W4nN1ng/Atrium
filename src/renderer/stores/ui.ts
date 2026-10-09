import { create } from 'zustand'
import type { AppInfo, IngestItemState, PathInfo, Stats } from '../../shared/api'
import type {
  AppSettings,
  AssetFilter,
  AssetCard,
  AutoSwitchEvent,
  BridgeFirstSeenEvent,
  BatchOutcome,
  CategoryConfig,
  CollectionRow,
  CollectionRule,
  ContainerNotes,
  DetailInfo,
  FoundPackage,
  ImportItemEvent,
  LearnedCorrection,
  LocaleKey,
  ModelBackfillPlan,
  PlanView,
  ProjectInfo,
  RearchiveOutcome,
  UnityStatus
} from '../../shared/types'
import {
  IMPORT_BATCH_MAX,
  batchesOf,
  cardImportChoice,
  collectionTokens,
  preselectMembers,
  projectFingerprintTokens,
  underSize,
  type PickReason
} from '../../shared/memberPick'
import { DEFAULTS } from '../../shared/settingsDefaults'
import { canSilenceRestBridgeAsks } from '../../shared/bridgeAsk'
import {
  adoptOrFresh,
  clampStep,
  finishPatch,
  libraryChoicePatch,
  skipPatch,
  startedHereFrom,
  type DirectoryProbe,
  type LibraryChoice,
  type WizardStep
} from '../../shared/wizardState'
import { rearchiveDialogState, type RearchivePending } from '../../shared/rearchiveDialog'
import {
  EMPTY_QUEUE,
  applyBusy,
  applyCommandProgress,
  applyItemResult,
  beginQueue,
  endQueue,
  queueFromPlan,
  reconcileFromOutcome,
  type ImportQueue
} from '../../shared/importQueue'
import i18next, { changeLocale } from '../i18n'
import { msg, rejectText, toastText, type ToastPayload } from '../lib/msg'

export type NavKey = 'inbox' | 'pending' | 'recent' | 'favorites' | 'project' | 'settings' | string

/** 一次导入流程的界面状态（M5-A） */
export interface ImportFlowState {
  /** 正在跑（预扫描或导入中），界面显示"进行中" */
  busy: boolean
  /** 当前在导哪个包（文件名，给人看） */
  packageName: string | null
  /**
   * 当前这一次要导的**完整包路径**。
   * 不能只放在 `pending` 里 —— 无冲突时 `pending` 是 null，
   * 而"无冲突直接导"那条路仍然需要这个路径（第一版就漏了这一点）。
   */
  packagePath: string | null
  /** 当前素材行 id（预扫描通过后要用它记 import_log.asset_id） */
  assetId: string | null
  /** 目标工程 id */
  projectId: string | null
  /** 目标工程名 */
  projectName: string | null
  /** 有冲突时挂起等用户选（null = 没有待确认的事） */
  pending: {
    entryCount: number
    fresh: number
    conflicts: Array<{ guid: string; existingPath: string; incomingPath: string }>
  } | null
  /**
   * Unity 忙（Play / 编译 / 刷新）时的排队状态。
   *
   * 这三个字段让界面能显示「已排队（Unity 正在运行 Play 模式）· 第 3 次重试」
   * 而不是干巴巴的"正在导入"。§8-5 的验收口径点名要求这个文案。
   */
  busyReason: string | null
  busyRetry: number
  busyNextDelayMs: number
  /**
   * 容器成员导入的那一批（M5-B ⑤）。null = 走的是"磁盘上就有一个 .unitypackage"的老路。
   *
   * 为什么只存这两个数而不存整个 `PlanView`：抽取与预扫描的结果留在主进程内存里
   * （那边才是权威），界面只需要"按下确认时报哪个 batchId"。
   * 界面上那些"合计 12.3 MB · 3 个包有冲突"的数字是 ⑥ 的汇总卡片要的，那时再补。
   */
  batch: { batchId: string; relPath: string } | null
  /**
   * R4 ① · 这批里每一条的进度（串行导入时逐条往上顶）。
   *
   * 为什么另开一份而不复用上面那些单值字段：`packageName` / `busy*` 那套是
   * "当前一个"的形状，M5-A 的单包导入就长这样；而 §8-4 要的是"5 个包、跑到第 3 个、
   * 后面 2 个还没跑"。把队列塞进单值字段里，等于让界面自己去猜列表 ——
   * 所以判据住在 `shared/importQueue.ts`（纯函数、有回归用例），这里只存它算出来的东西。
   */
  queue: ImportQueue
  /** 上一次导入的结果（成功后有"撤销"入口） */
  last: {
    importId: string
    projectName: string
    created: number
    overwritten: number
    backupDir: string | null
    /** 备份目录里真存下了几个文件（横幅那句"已备份"要靠它，不能只看有没有目录） */
    backupSaved: number
  } | null
}

export interface Toast {
  id: number
  tone: 'ok' | 'warn' | 'bad' | 'info'
  text: string
}

/**
 * 容器成员选择面板的状态（M5-B ⑥）。
 *
 * 为什么也放 store 而不是组件里：入口有两个（容器内部视图的按钮、双击多成员卡），
 * 而"抽好了等确认"的那一批**活在主进程内存里**（`unity:import-plan` 的返回 batchId）。
 * 组件一卸载（切页、筛选变了）如果把这些丢了，那批临时副本就没人负责删，
 * 只能等下次开机 prune —— 状态跟着数据的主人走，别跟着视图走。
 */
export interface MemberPickerState {
  open: boolean
  assetId: string | null
  /** 卡片标题，只给顶栏那行字用 */
  containerName: string | null
  loading: boolean
  /** 清单（`packagesOfAsset` 的 packages；archive 型那些 `path` 是 null = 还没抽） */
  packages: FoundPackage[]
  notes: ContainerNotes | null
  /** kind='empty' 时的原因 */
  emptyReasonKey: string | null
  /** 用户勾中的那些，**按勾选顺序**存（分批要这个顺序） */
  picked: string[]
  /** 预勾依据：relPath → 因为哪个词 */
  reasons: Record<string, PickReason>
  /** 命中面太宽，所以一个都没替用户勾（界面要把这句说出来） */
  tooBroad: { matched: string; hits: number; total: number } | null
  /** 当前批的预扫描结果（null = 还在勾选那一步） */
  plan: PlanView | null
  /** 还没开始的后续批次 */
  queue: string[][]
  running: boolean
  /** 当前批跑完的结果（汇总卡片 → 结果卡片） */
  outcome: BatchOutcome | null
  /** 抽取/规划那一步失败的原因（闸门、密码、坏了） */
  reasonKey: string | null
  reasonParams: Record<string, unknown>
}

/**
 * R4 ② · 多选卡批量导入的状态。
 *
 * 一条 = **一个要导的包**，带着它来自哪张卡（`assetId`）。
 * 为什么不按"卡"存：一张卡可能对应好几个包（目录型容器），而链路的闸门、
 * 冲突决定、撤销批次都是按"包"算的 —— 按卡存就得在链路里再展一次开，
 * 那一层展开的口径就成了第二份实现。
 */
export interface BatchItem {
  assetId: string
  /** 点名要导的那一个（容器成员是相对路径，散装卡就是文件名） */
  relPath: string
  /** 给人看的名字 */
  label: string
}

export interface BatchImportState {
  open: boolean
  /** 还没开始的后续批次 */
  queue: BatchItem[][]
  /** 当前这一批的预扫描结果（null = 还在抽取/规划，或者已经提交完） */
  plan: PlanView | null
  running: boolean
  outcome: BatchOutcome | null
  /**
   * 被跳过的卡数（多个成员的容器、没有可导包的卡）。
   * **必须显示出来**：勾了 5 张、实际导 3 张而不说，等于替用户做了决定还瞒着。
   */
  skipped: number
  reasonKey: string | null
  reasonParams: Record<string, unknown>
}

const IDLE_BATCH: BatchImportState = {
  open: false,
  queue: [],
  plan: null,
  running: false,
  outcome: null,
  skipped: 0,
  reasonKey: null,
  reasonParams: {}
}

const IDLE_PICKER: MemberPickerState = {
  open: false,
  assetId: null,
  containerName: null,
  loading: false,
  packages: [],
  notes: null,
  emptyReasonKey: null,
  picked: [],
  reasons: {},
  tooBroad: null,
  plan: null,
  queue: [],
  running: false,
  outcome: null,
  reasonKey: null,
  reasonParams: {}
}

/**
 * M6 ④ · 「按库里出现过的模型补建集合」那张预览面板的状态。
 *
 * 状态放 store、不放组件本地 state：面板要能活过切页（用户常常顺手切去别处看一眼再回来），
 * 而"预览算过了、勾了哪几个"必须跟着回来 —— 否则回来时又从零算一遍。
 */
export interface BackfillState {
  open: boolean
  loading: boolean
  plan: ModelBackfillPlan | null
  /** 勾中的模型名（按点击顺序） */
  picked: string[]
  /** 正在写库 */
  busy: boolean
}

const IDLE_BACKFILL: BackfillState = { open: false, loading: false, plan: null, picked: [], busy: false }

/**
 * R4 ③ · 「改分类要不要把文件也搬过去」那张确认卡。
 *
 * 状态放 store 而不是组件里，和 `memberPicker` 同一个理由：
 * 发起方是详情面板那两个下拉，而用户点完"保存"常常立刻切页 ——
 * 对话框挂在详情面板里的话就跟着卸载了，而那次决定**还没做**。
 * 判据（给不给"搬"这个按钮、要说哪几句提醒）全部在 `shared/rearchiveDialog.ts`。
 */
export interface RearchiveState {
  open: boolean
  busy: boolean
  /** 用户已经按下保存、正在等预览 */
  loading: boolean
  pending: RearchivePending | null
  plan: RearchiveOutcome | null
}

const IDLE_REARCHIVE: RearchiveState = { open: false, busy: false, loading: false, pending: null, plan: null }

/**
 * M6 ⑤ · 顶部横幅的状态。
 *
 * 为什么放 store 而不是组件里：横幅由主进程的事件驱动（工程刚被检测到打开），
 * 而它必须**活过切页** —— 用户这时候很可能正在别的页面上，
 * 组件挂在侧栏的话事件就丢了。
 */
export interface BannerStore {
  /** 最近一次决策（null = 没东西可画） */
  event: AutoSwitchEvent | null
  /** 用户点了"固定"，不再自动淡出 */
  pinned: boolean
  /** 本次运行内被"这次忽略"过的工程 id（§4.3「关闭横幅，本次不再提示」） */
  ignoredProjects: string[]
  /** 本次运行内是否真的发生过一次自动切换决策（Q3 那条"问一次"的前提） */
  sawUnityStart: boolean
}

/**
 * 「已经学会 N 条」那句提示（M3-7）。
 *
 * 抽出来是因为改分类现在有**三条**路会写分类：只改记录、搬文件、预览说不该搬时自动只改记录。
 * 文案逻辑留在 `reclassify` 里写一遍，另外两条就静默不学了 —— 这正是这一轮抓到的那类漏账。
 * 门槛（hits ≥ 3）在主进程判，这里只管"有 hint 就说、没有就闭嘴"。
 */
function learnedToast(toast: (tone: Toast['tone'], text: string) => void, learned?: LearnedCorrection): void {
  if (!learned?.hint) return
  toast('ok', reasonText('toast.learnedNow', { rules: learned.hint.rules, token: learned.hint.token }))
}

/**
 * reasonKey → 一句人话，**顺便当所有 store toast 的兜底口径**。
 *
 * 兜底给的是 key 本身而不是空串，两个理由：
 *  1. 词典漏登记时界面直接显示 `rearchive.reason.xxx`，一眼看出是漏翻译，
 *     而不是"出错了但不知道为什么"那种空白；
 *  2. i18next 还没 init（冷启动最早那几条 toast）时 `t()` 回的是空串，
 *     空串 toast 在界面上就是"点了没反应"。回归用例里那三条空 text 就是这么发现的。
 */
function reasonText(key: string | null | undefined, params?: Record<string, unknown> | null): string {
  const p: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(params ?? {})) p[k] = typeof v === 'number' ? v : String(v ?? '')
  return msg(key ?? undefined, p, key ?? '')
}

interface UiState {
  booted: boolean
  bootError: string | null
  info: AppInfo | null
  paths: PathInfo | null
  settings: AppSettings
  stats: Stats | null
  categories: CategoryConfig | null
  collections: CollectionRow[]
  cards: AssetCard[]
  total: number
  detail: DetailInfo | null
  detailId: string | null
  selection: string[]
  nav: NavKey
  search: string
  layout: 'grid' | 'list'
  view: 'grouped' | 'flat'
  ingestItems: IngestItemState[]
  unity: UnityStatus & { targetProjectId: string | null }
  /** 已知工程列表（顶栏切换器用） */
  projects: ProjectInfo[]
  /**
   * 容器成员选择面板（M5-B ⑥）。见 `MemberPickerState` 上那段"为什么放 store"。
   */
  memberPicker: MemberPickerState
  /** R4 ② · 多选卡批量导入 */
  batchImport: BatchImportState
  /** M6 ④ · 补建集合的预览面板 */
  backfill: BackfillState
  /** R4 ③ · 改分类搬文件的确认卡 */
  rearchive: RearchiveState
  /** M6 ⑤ · 顶部横幅 */
  banner: BannerStore
  /**
   * R4 ⑦ · 等着用户回答"要不要给这个工程装桥接"的工程**清单**。
   *
   * 是队列不是单个：全新安装第一轮就能同时发现一批工程（用户真实的 8 个），
   * 那时候每个都该被问到 —— 只留一个的话，其余的**永远问不到**
   * （"第一次发现"是边沿，过了就没了）。界面一次只弹最前面那条，答完自动轮到下一条。
   * 空数组 = 没在问。
   */
  bridgeAsk: BridgeFirstSeenEvent[]
  /**
   * 导入流程的当前状态（M5-A）。
   *
   * 为什么放在 store 而不是某个组件的 useState：发起导入的地方有好几个
   * （卡片双击、详情面板按钮、批量按钮），而**冲突确认对话框必须由一个
   * 常驻组件渲染** —— 放在宿主组件里的话，宿主一卸载（比如批量导入后切页）
   * 对话框就跟着没了，而导入还在跑。
   */
  importFlow: ImportFlowState
  toasts: Toast[]
  dropActive: boolean

  boot(): Promise<void>
  refreshList(): Promise<void>
  refreshMeta(): Promise<void>
  openDetail(id: string | null): Promise<void>
  setNav(nav: NavKey): void
  setSearch(q: string): void
  setLayout(l: 'grid' | 'list'): void
  setView(v: 'grouped' | 'flat'): void
  toggleSelect(id: string, additive: boolean): void
  selectAll(): void
  clearSelection(): void
  setDropActive(on: boolean): void
  patchSettings(patch: Partial<AppSettings>): Promise<void>
  resetSettings(): Promise<void>
  toast(tone: Toast['tone'], text: string): void
  dismissToast(id: number): void
  reclassify(id: string, category: string, subcategory: string | null): Promise<void>
  /**
   * R4 ③ · 详情面板点「保存」走这里（**取代**直接调 `reclassify`）。
   * 先让主进程算一份只读预览：该搬 → 弹确认卡；不该搬 → 直接只改记录并把原因说清。
   */
  saveCategory(p: { assetId: string; category: string; subcategory: string | null; fromLabel: string; toLabel: string }): Promise<void>
  /** 预览卡上点「搬过去」：带着预览给过的 `toDir` 去执行 */
  confirmRearchive(): Promise<void>
  /** 预览卡上点「只改记录」：文件留在原地（= 这一轮之前的老行为） */
  rearchiveRecordOnly(): Promise<void>
  closeRearchive(): void
  resolvePending(id: string, accept: boolean): Promise<void>
  trashSelected(): Promise<void>
  /** 把当前选中的素材加进某个集合（第 1 份 F8：集合是"手动 + 规则"两种成员来源） */
  addToCollection(collectionId: string): Promise<void>
  undoLast(): Promise<void>
  refreshIngestQueue(): Promise<void>
  /** 拉工程列表（顶栏切换器 + Project 页共用） */
  refreshProjects(): Promise<ProjectInfo[]>
  /** 切换导入目标。选中的工程就是导入目标（§4.3 步骤 4） */
  setUnityTarget(projectId: string | null): Promise<void>
  /**
   * 发起一次导入（M5-A）。
   *
   * 完整链路：找包 → 预扫描 → 有冲突就挂起等确认 → 导入。
   * 任何一步不满足都给**明确原因**（没选目标 / 工程没开 / 桥接没装 / 是压缩包），
   * 绝不静默什么都不做。
   */
  importAsset(assetId: string | null, opts?: { packagePath?: string }): Promise<void>
  /** 用户在冲突对话框里做的选择 */
  resolveImportConflict(choice: 'cancel' | 'continue' | 'continue-with-backup'): Promise<void>
  /** 撤销上一次导入 */
  rollbackLastImport(): Promise<void>
  /** 关掉"上次导入结果"那条（不是撤销，只是收起提示） */
  dismissImportResult(): void
  ingestPaths(paths: string[]): Promise<void>

  // ------------------------------------------------------------ 容器成员选择（M5-B ⑥）

  /** 打开这张卡的成员选择面板（多成员容器的唯一入口；双击也走这里） */
  openMemberPicker(assetId: string): Promise<void>
  closeMemberPicker(): void
  /** 重新拉一次清单（用户在外部改动过、或者闸门换了盘） */
  reloadMemberPicker(): Promise<void>
  toggleMemberPick(relPath: string): void
  setMemberPicks(relPaths: string[]): void
  pickAllMembers(): void
  clearMemberPicks(): void
  /** [只勾 < N MB 的] —— 阈值由界面传，不在 store 里写死第二套口径 */
  pickMembersUnder(maxBytes: number): void
  /** 勾选完按下"导入"：切批、规划第一批（抽取 + 预扫描），等用户在汇总卡片上决定 */
  runMemberBatches(): Promise<void>
  /** M6 ④ · 补建集合：打开并算预览 / 关掉 / 勾选 / 确认写库 */
  openModelBackfill(): Promise<void>
  closeModelBackfill(): void
  toggleBackfillPick(name: string): void
  pickAllBackfill(): void
  clearBackfillPicks(): void
  runModelBackfill(): Promise<void>
  /** M6 ⑤ · 主进程发来的自动切换决策：切视图（不清搜索框）+ 画横幅 */
  handleAutoSwitch(event: AutoSwitchEvent): void
  pinBanner(): void
  dismissBanner(): void
  /** 「不是这个集合 ▾」选了别的：切过去，但不擅自改规则 */
  bannerChoose(collectionId: string): Promise<void>
  /** 「以后都这样」：把这个工程写进该集合的 rule_json.projectPaths（精确匹配、优先级最高） */
  bannerRemember(): Promise<void>
  /** M6 ⑥（Q3）：回答那条"要不要开机常驻托盘"的一次性提示 */
  answerAutoLaunch(accept: boolean): Promise<void>
  /**
   * M7 · 首次启动向导的**状态**（判据全在 `shared/wizardState.ts`，这里只存"走到哪、探测到了什么"）。
   *
   * 为什么不放在组件的 `useState` 里：本仓渲染层零 DOM 测试，
   * 放组件里就等于"接管会不会顺手关掉自动归档"这种要紧的动作没人测得到。
   */
  wizardStep: WizardStep
  /**
   * 本次启动时库根是不是空的（= 这台机器是全新安装）。
   * boot 里算一次就不再改：第 ① 步落完库根之后向导必须继续，
   * 否则用户点完「接管这个库」的同一瞬间向导会把自己关掉（第 7 轮活体撞到的）。
   */
  wizardStartedHere: boolean
  wizardProbe: DirectoryProbe | null
  wizardProbing: boolean
  /** 第 ① 步：选目录 → 只读探测 → 空目录直接按"建空库"落定，像有素材的才问（Q3） */
  wizardPickDirectory(): Promise<void>
  /** 第 ① 步：探测一个手输的路径（系统目录框是模态，脚本点不到；这一屏又必须能被活体跑） */
  wizardProbePath(p: string): Promise<void>
  /** 第 ① 步：接管 / 建空库二选一。落 `libraryRoot` + `libraryMode`，接管还要关自动归档 */
  wizardChooseLibrary(mode: LibraryChoice): Promise<void>
  wizardSetStep(step: WizardStep): void
  wizardFinish(): Promise<void>
  wizardSkip(): Promise<void>
  /**
   * R4 ⑦ · 「第一次发现这个工程」的边沿：`ask` 弹三按钮窗，`auto` 直接装并报一句。
   * 判据不在这里 —— 主进程已经用 `shared/bridgeAsk.ts` 算完了。
   */
  handleProjectFirstSeen(event: BridgeFirstSeenEvent): void
  /** 三按钮的答案（`install-once` 不写库，下次第一次发现还会问） */
  answerBridgeAsk(choice: 'install-once' | 'always' | 'never'): Promise<void>
  /** 关掉弹窗**不算回答**（什么都不写，下次启动还会再问） */
  dismissBridgeAsk(): void
  /** M7 Q10 · 「剩下这些都不再问」：除屏幕上这条之外，每条各写一行 never */
  silenceRestBridgeAsks(): Promise<void>
  /** 桥接装成了 → 这条待答在本地也摘掉（主进程那边同一次调用里已经出队） */
  settleBridgeAsk(projectId: string): void
  /** M7 · 侧栏那条"库还没配好"按下去：擦掉跳过痕，回到向导 */
  reopenWizard(): Promise<void>
  /** 汇总卡片上的三选一（一次决定覆盖这一批 N 个包） */
  decideMemberPlan(choice: 'cancel' | 'continue' | 'continue-with-backup'): Promise<void>
  /** 还有下一批：继续 */
  nextMemberBatch(): Promise<void>
  /** 还有下一批：就这样了（放弃剩下的，清副本） */
  stopMemberBatches(): void
  /** 把刚导完这一批整体退回（倒序逐条撤，一条失败就停下如实报） */
  rollbackMemberOutcome(): Promise<void>
  /**
   * R4 ② · 把当前选中的**几张卡**一起导（规格 §8-4「多选 5 个 → 串行执行 → 进度可见」）。
   * 每张卡各挑一个可直导的包；要先选成员的卡不替他挑，跳过并计入 `skipped`。
   */
  importSelected(): Promise<void>
  /** 这一批的三选一（一次决定覆盖这一批 N 个包） */
  decideBatchPlan(choice: 'cancel' | 'continue' | 'continue-with-backup'): Promise<void>
  /** 下一批 */
  nextBatch(): Promise<void>
  /** 就导到这儿：剩下的批次不再抽不再导，已抽的退回 */
  stopBatches(): void
  closeBatchImport(): void
  /** 把刚导完的这一批整体退回（倒序逐条，一条失败就停下如实报） */
  rollbackBatchOutcome(): Promise<void>
}

/** 开发期可用 ?nav=settings&lang=ja 之类直接跳到某个界面，方便逐屏截图核对 */
function initialNav(): NavKey {
  try {
    const q = new URLSearchParams(window.location.search).get('nav')
    if (q && ['inbox', 'review', 'pending', 'recent', 'all', 'collections', 'bundles', 'project', 'settings'].includes(q)) return q
  } catch {
    /* 非浏览器环境 */
  }
  return 'inbox'
}

let toastSeq = 1
let listenersBound = false

export const useUi = create<UiState>((set, get) => {
  async function refreshList(): Promise<void> {
    const s = get()
    const filter: AssetFilter = {
      search: s.search || undefined,
      collectionId: s.nav.startsWith('col:') ? s.nav.slice(4) : undefined,
      category: s.nav.startsWith('cat:') ? s.nav.slice(4) : undefined,
      status: s.nav === 'inbox' ? 'inbox' : undefined,
      /** 「待复核」= 一键入库时置信度不够那批；「合集」= 只看合集卡 */
      reviewOnly: s.nav === 'review' || undefined,
      bundlesOnly: s.nav === 'bundles' || undefined,
      view: s.view,
      limit: 400
    }
    try {
      const r = await window.a.assets.list(filter)
      set({ cards: r.cards, total: r.total })
    } catch (e) {
      get().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  async function refreshMeta(): Promise<void> {
    try {
      const [stats, collections, categories] = await Promise.all([
        window.a.assets.stats(),
        window.a.collections.list(),
        window.a.categories.list()
      ])
      set({ stats, collections, categories })
    } catch (e) {
      get().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * 把一批成员抽出来并预扫描，结果挂进面板。
   *
   * 单独一个函数是因为**两个地方要用同一套失败处理**："开始导"和"下一批"。
   * 复制两遍的代价是其中一份忘了清 queue / 忘了把 running 落回 false ——
   * 那种 bug 的表现为按钮永远转圈。
   */
  async function planBatch(members: string[]): Promise<void> {
    const p = get().memberPicker
    if (!p.assetId) return
    try {
      const r = await window.a.unity.importPlan({ assetId: p.assetId, members })
      if ('items' in r) {
        set({ memberPicker: { ...get().memberPicker, plan: r, reasonKey: null } })
        if (r.blocked.length) {
          get().toast('warn', i18next.t('library.memberBlocked', { count: r.blocked.length }))
        }
        return
      }
      /** 闸门拒绝 / 工程侧不在线 / 全被挡住：说清是哪一个，别只说"失败了" */
      set({ memberPicker: { ...get().memberPicker, plan: null, reasonKey: r.reasonKey, reasonParams: r.reasonParams ?? {} } })
    } catch (e) {
      set({ memberPicker: { ...get().memberPicker, plan: null, reasonKey: 'err.importChainFailed' } })
      get().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * R4 ② · 跨卡批量：把这一批条目交给主进程抽取 + 预扫描。
   *
   * 和上面 `planBatch` 分开写而不是复用同一个函数，是因为入参形状不同：
   * 那条是"一张卡 + 它里面的几个成员"，这条是"N 张卡各一个包"。
   * **失败处理两边一样**（闸门 / 工程侧不在线 / 全被挡住都要说清是哪一个）——
   * 所以失败分支的写法是照抄的，改一处要改两处是这份文件的已知债，注释在这里标出来。
   */
  async function planBatchItems(items: BatchItem[]): Promise<void> {
    try {
      const r = await window.a.unity.importPlan({
        items: items.map((x) => ({ assetId: x.assetId, members: [x.relPath] })),
        projectId: get().unity.targetProjectId ?? undefined
      })
      if ('items' in r) {
        const proj = get().projects.find((p) => p.id === get().unity.targetProjectId) ?? null
        set({
          batchImport: { ...get().batchImport, plan: r, reasonKey: null },
          /**
           * 抽好了就把进度队列铺上。
           * ⚠ 这一行是沙盒活体补的：以前批量这条路没铺过队列，
           *   结果卡上只有"成功 5 个"那一句，逐条的行是空的 —— §8-4 的"进度可见"只成了一半。
           */
          importFlow: { ...get().importFlow, queue: queueFromPlan(r, proj?.name ?? null) }
        })
        if (r.blocked.length) {
          get().toast('warn', i18next.t('library.memberBlocked', { count: r.blocked.length }))
        }
        return
      }
      set({
        batchImport: { ...get().batchImport, plan: null, running: false, reasonKey: r.reasonKey, reasonParams: r.reasonParams ?? {} }
      })
    } catch (e) {
      set({ batchImport: { ...get().batchImport, plan: null, running: false, reasonKey: 'err.importChainFailed' } })
      get().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  function bindEvents(): void {
    if (listenersBound) return
    listenersBound = true
    window.a.on('ingest:progress', (payload) => {
      set({ ingestItems: Array.isArray(payload) ? (payload as IngestItemState[]) : [] })
    })
    window.a.on('data:changed', () => {
      void refreshList()
      void refreshMeta()
    })
    /**
     * M6 ⑤：主进程检测到"某个工程刚打开"并做完了决策。
     * 决策（切不切、为什么没切）已经在 `unity:auto-switch` 里算好，
     * 界面只负责"照吩咐切视图 + 画横幅"，**不在这里再判一次**（两边各判必漂）。
     */
    window.a.on('unity:auto-switch', (payload) => {
      const e = payload as AutoSwitchEvent
      if (e && typeof e.projectId === 'string') get().handleAutoSwitch(e)
    })
    window.a.on('project:first-seen', (payload) => {
      const e = payload as BridgeFirstSeenEvent | null
      if (e && typeof e.projectId === 'string') get().handleProjectFirstSeen(e)
    })
    window.a.on('settings:changed', (payload) => {
      const next = payload as AppSettings
      set({ settings: next })
      void changeLocale(next.language)
      document.documentElement.classList.toggle('dark', next.theme === 'dark')
      document.documentElement.classList.toggle('light', next.theme === 'light')
      // 切语言时 <html lang> 也要跟着走，否则读屏/翻译插件还当它是中文
      document.documentElement.lang = next.language
    })
    window.a.on('ui:toast', (payload) => {
      const p = (payload ?? {}) as ToastPayload
      const text = toastText(p)
      if (text) get().toast(p.tone ?? 'info', text)
    })
    /**
     * Unity 说忙、命令在排队重投（§8-5 要求显示"已排队"）。
     *
     * ⚠ 没有这条时，Play 模式下点导入界面会一直显示"正在导入 …"几分钟不变 ——
     * 用户以为卡死了。实际是：预扫描要发 `resolve_guids`，Unity 在 Play 模式
     * 不接命令只回 `busy`，A 正按 1s→2s→5s→10s→30s 退避重投。
     * 这里把"在排队、为什么、第几次"如实落到界面状态上。
     */
    window.a.on('unity:command-busy', (payload) => {
      const p = (payload ?? {}) as {
        busyReason?: string | null
        retry?: number
        nextDelayMs?: number
      }
      set((s) => ({
        importFlow: {
          ...s.importFlow,
          busyReason: p.busyReason ?? null,
          busyRetry: p.retry ?? 0,
          busyNextDelayMs: p.nextDelayMs ?? 0,
          /** 排队信息也要落到队列上，否则多条时只有老那行字在说"已排队" */
          queue: applyBusy(s.importFlow.queue, p)
        }
      }))
    })
    /**
     * R4 ① · 一批里每跑完一条：把那条从 `running` 改成终态，并顶下一条上来。
     *
     * ⚠ `matched:false`（这条批不在界面上）时**要留一行日志**，不许静默丢：
     * 序号对不上意味着主进程与界面切批的口径漂了，那是"进度永远差一条"这类怪事的根，
     * 悄悄丢掉就再也查不到。
     */
    window.a.on('unity:import-item', (payload) => {
      const ev = (payload ?? {}) as ImportItemEvent
      set((s) => {
        const r = applyItemResult(s.importFlow.queue, ev)
        if (!r.matched) console.warn(`[import] 进度事件对不上队列：batch=${ev.batchId} #${ev.index} ${ev.relPath}`)
        return { importFlow: { ...s.importFlow, queue: r.queue } }
      })
    })
    /** Unity 自己报的命令级进度（"正在写第 3/7 个文件"）：贴到当前在跑的那条上 */
    window.a.on('unity:import-progress', (payload) => {
      const p = (payload ?? {}) as { progress?: number | null; message?: string | null }
      set((s) => ({ importFlow: { ...s.importFlow, queue: applyCommandProgress(s.importFlow.queue, p) } }))
    })
    /**
     * 启动时收件箱被恢复：必须**告诉用户**。
     * 不提示的话用户会看到队列里凭空多出上次的卡片，以为程序出了毛病。
     */
    window.a.on('ingest:restored', (payload) => {
      const p = (payload ?? {}) as { recovered?: number; missing?: number }
      const n = Number(p.recovered ?? 0)
      if (n > 0) get().toast('info', i18next.t('toast.inboxRestored', { count: n }))
    })
  }

  return {
    booted: false,
    bootError: null,
    info: null,
    paths: null,
    settings: DEFAULTS,
    wizardStep: 1,
    wizardStartedHere: false,
    wizardProbe: null,
    wizardProbing: false,
    stats: null,
    categories: null,
    collections: [],
    cards: [],
    total: 0,
    detail: null,
    detailId: null,
    selection: [],
    nav: initialNav(),
    search: '',
    layout: 'grid',
    view: 'grouped',
    ingestItems: [],
    memberPicker: IDLE_PICKER,
    batchImport: IDLE_BATCH,
    backfill: IDLE_BACKFILL,
    rearchive: IDLE_REARCHIVE,
    banner: { event: null, pinned: false, ignoredProjects: [], sawUnityStart: false },
    bridgeAsk: [],
    unity: {
      running: false,
      bridgeReady: false,
      isPlaying: false,
      isCompiling: false,
      isUpdating: false,
      queueLength: 0,
      busyReason: null,
      targetProjectId: null
    },
    /** 已知工程列表 —— 顶栏的工程切换器要用；Project 页刷新后回填 */
    projects: [],
    importFlow: {
      busy: false,
      packageName: null,
      packagePath: null,
      assetId: null,
      projectId: null,
      projectName: null,
      pending: null,
      busyReason: null,
      busyRetry: 0,
      busyNextDelayMs: 0,
      batch: null,
      queue: EMPTY_QUEUE,
      last: null
    },
    toasts: [],
    dropActive: false,

    async boot() {
      try {
        bindEvents()
        const [info, paths, settings, unity] = await Promise.all([
          window.a.system.info(),
          window.a.system.paths(),
          window.a.settings.getAll(),
          window.a.unity.status()
        ])
        await changeLocale(settings.language)
        document.documentElement.classList.toggle('dark', settings.theme === 'dark')
        document.documentElement.classList.toggle('light', settings.theme === 'light')
        document.documentElement.lang = settings.language
        set({
          info,
          paths,
          settings,
          unity,
          booted: true,
          /** M7 · 断点续填：上次走到哪一步（脏值/老版本没这个键都由 `clampStep` 收成 1） */
          wizardStep: clampStep(settings.onboardingStep),
          /**
           * M7 · "这次是不是全新安装"只在**第一次** boot 判，之后不许改口。
           *
           * `patchSettings({libraryRoot})` 会再 boot 一次（第 ① 步落库根就走这条路），
           * 那时 `libraryRoot` 已经不空了 —— 要是每次 boot 都重算，
           * 用户点完「接管这个库」的同一瞬间向导就会把自己关掉（活体实测撞到的就是这个）。
           */
          wizardStartedHere: get().wizardStartedHere || startedHereFrom(settings.libraryRoot)
        })
        const wantNav = new URLSearchParams(window.location.search).get('nav')
        if (wantNav) set({ nav: wantNav })
        await Promise.all([refreshList(), refreshMeta()])
        await get().refreshIngestQueue()
        /**
         * R4 ⑦ · 把主进程**攒着没送到**的桥接决定取回来。
         *
         * 顺序上必须放在 `bindEvents()` 之后：先能收广播，再 drain，两边才不会两头漏。
         * 少了这一步，"第一次发现新工程要弹三按钮"恰恰在**全新安装**那一次不生效 ——
         * 主进程第一轮工程发现是同步跑完的，那时这个监听器还不存在。
         */
        const pending = await window.a.unity.pendingBridgeAsk()
        for (const ev of pending) get().handleProjectFirstSeen(ev)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ bootError: msg })
        console.error('[boot]', e)
      }
    },

    refreshList,
    refreshMeta,

    async openDetail(id) {
      if (!id) {
        set({ detail: null, detailId: null })
        return
      }
      set({ detailId: id })
      try {
        const d = await window.a.assets.detail(id)
        set({ detail: d })
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    setNav(nav) {
      set({ nav, selection: [], detail: null, detailId: null })
      void refreshList()
    },

    setSearch(search) {
      set({ search })
      void refreshList()
    },

    setLayout(layout) {
      set({ layout })
    },

    setView(view) {
      set({ view })
      void refreshList()
    },

    toggleSelect(id, additive) {
      const cur = get().selection
      if (!additive) {
        set({ selection: cur.length === 1 && cur[0] === id ? [] : [id] })
        return
      }
      set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
    },

    selectAll() {
      set({ selection: get().cards.map((c) => c.id) })
    },

    clearSelection() {
      set({ selection: [] })
    },

    setDropActive(dropActive) {
      set({ dropActive })
    },

    async patchSettings(patch) {
      try {
        const next = await window.a.settings.setMany(patch)
        set({ settings: next })
        if (patch.libraryRoot !== undefined) await get().boot()
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async resetSettings() {
      const next = await window.a.settings.reset()
      set({ settings: next })
      await changeLocale(next.language)
    },

    /**
     * M7 ③ · 第 ① 步：选目录 → **只读**探测 → 判据决定问不问。
     *
     * 空目录不啰嗦：`adoptOrFresh` 说"不像有素材"就直接按 `fresh` 落定；
     * 像有素材的才把探测结果交给界面去问"接管还是建空库"（Q3）。
     */
    async wizardPickDirectory() {
      const picked = await window.a.system.pickDirectory({ title: i18next.t('wizard.step1.pickTitle') })
      if (picked) await get().wizardProbePath(picked)
    },

    /**
     * 探测一个**手输**的路径。
     *
     * 为什么要留这条路：目录选择框是系统模态，脚本点不到；而"选到已有素材的目录"这一屏
     * 恰恰是最需要能在真机上跑一遍的（M7-DESIGN §6.2 的第 2 条）。顺手也方便了路径很长的人。
     */
    async wizardProbePath(p) {
      const raw = (p ?? '').trim()
      if (!raw) return
      set({ wizardProbe: null, wizardProbing: true })
      try {
        const probe = await window.a.system.probeDirectory(raw)
        set({ wizardProbe: probe })
        if (adoptOrFresh(probe) === 'fresh') await get().wizardChooseLibrary('fresh')
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      } finally {
        set({ wizardProbing: false })
      }
    },

    /**
     * M7 ③ · 落库根。
     *
     * ⚠ 只改指向，**不搬盘**（全仓没有也不该有"改库根时迁移文件"那种代码）。
     * 接管那条要顺手把「高置信度自动归档」关掉 —— 这条以前只写在 README §收编 第一句里靠人自觉，
     * 现在由 `libraryChoicePatch` 代劳，判定与用例在 `tests/shared/wizard-state.spec.ts`。
     */
    async wizardChooseLibrary(mode) {
      const root = get().wizardProbe?.path
      if (!root) return
      const patch: Partial<AppSettings> = {
        libraryRoot: root,
        libraryMode: mode,
        ...libraryChoicePatch(mode, { autoArchive: get().settings.autoArchive })
      }
      await get().patchSettings(patch)
      /** 落完库根才算这一步过了，直接进第 ② 步（`patchSettings` 里会顺带 boot 一次） */
      get().wizardSetStep(2)
    },

    wizardSetStep(step) {
      const s = clampStep(step)
      set({ wizardStep: s })
      /** 走 `patchSettings` 而不是裸 `settings.set`：store 里那份 settings 得跟着新，否则下次 boot 读回旧步数 */
      void get().patchSettings({ onboardingStep: s })
    },

    async wizardFinish() {
      await get().patchSettings(finishPatch())
    },

    /**
     * M7 · 「稍后配置」。
     * ⚠ 写的是 skip，**不是 done** —— 库根还是空的，侧栏那条提示必须继续留着。
     */
    async wizardSkip() {
      await get().patchSettings(skipPatch(new Date().toISOString()))
    },

    toast(tone, text) {
      const id = toastSeq++
      set((s) => ({ toasts: [...s.toasts, { id, tone, text }] }))
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, tone === 'bad' ? 9000 : 4200)
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    },

    async reclassify(id, category, subcategory) {
      try {
        const r = await window.a.assets.reclassify(id, category, subcategory)
        learnedToast(get().toast, r)
        await get().openDetail(id)
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * R4 ③ · 详情面板「保存」的真入口。
     *
     * 三条路，判据全在主进程的只读预览里：
     *  - 预览说**不该搬**（索引模式 / 不在库根下 / 本来就在对的地方）→ 没有可决定的事，
     *    直接只改记录，并把"为什么没搬"跟着"已保存"一起说出来；
     *  - 预览说**该搬** → 弹确认卡，用户点头才动盘（这一轮唯一碰素材磁盘的操作）；
     *  - 预览**失败**（素材没了 / 参数不对）→ 什么都不改。这时候连"只改记录"都不给，
     *    因为当前路径都没确认，让用户在信息不全下点确认等于替他决定。
     */
    async saveCategory(p) {
      const pending: RearchivePending = {
        assetId: p.assetId,
        category: p.category,
        subcategory: p.subcategory,
        fromLabel: p.fromLabel,
        toLabel: p.toLabel
      }
      set({ rearchive: { ...IDLE_REARCHIVE, loading: true, pending } })
      try {
        const plan = await window.a.assets.rearchivePlan(p.assetId, p.category, p.subcategory)
        /**
         * "该弹卡 / 该直接只改记录 / 该拒绝"三个决定**全部读这里**，不在 store 里再判一遍
         * `plan.willMove`/`plan.ok` —— 判据有两份实现就是下一轮"界面和主进程说得不一样"的来源。
         */
        const ds = rearchiveDialogState(pending, plan)
        if (!ds.canMove && !ds.canRecordOnly) {
          set({ rearchive: IDLE_REARCHIVE })
          get().toast('bad', reasonText(ds.reasonKey, ds.reasonParams ?? undefined))
          return
        }
        if (!ds.canMove) {
          /**
           * `expectToDir` 这里传 null 是安全的：主进程只在**真要搬**的那条分支上比对这个值，
           * `willMove=false` 走的是 `reclassifyOnly`，压根不看它。
           */
          const r = await window.a.assets.rearchive({
            assetId: p.assetId,
            category: p.category,
            subcategory: p.subcategory,
            expectToDir: null
          })
          set({ rearchive: IDLE_REARCHIVE })
          if (!r.ok) {
            get().toast('bad', reasonText(r.reasonKey, r.reasonParams))
            return
          }
          learnedToast(get().toast, r.learned)
          get().toast('ok', reasonText('rearchive.savedOnly', { reason: reasonText(ds.reasonKey, ds.reasonParams) }))
          await get().openDetail(p.assetId)
          return
        }
        set({ rearchive: { open: true, busy: false, loading: false, pending, plan } })
      } catch (e) {
        set({ rearchive: IDLE_REARCHIVE })
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async confirmRearchive() {
      const st = get().rearchive
      const pending = st.pending
      const plan = st.plan
      if (!pending || !plan || !plan.ok) return
      set({ rearchive: { ...st, busy: true } })
      try {
        const r = await window.a.assets.rearchive({
          assetId: pending.assetId,
          category: pending.category,
          subcategory: pending.subcategory,
          /** 必须回带预览给过的那个目录：主进程重算一遍，对不上就拒绝执行 */
          expectToDir: plan.toDir
        })
        set({ rearchive: IDLE_REARCHIVE })
        if (!r.ok) {
          get().toast('bad', reasonText(r.reasonKey, r.reasonParams))
          return
        }
        learnedToast(get().toast, r.learned)
        get().toast(
          'ok',
          r.dbOnly
            ? reasonText('rearchive.savedOnly', { reason: reasonText(r.reasonKey, r.reasonParams) })
            : reasonText('rearchive.movedDone', { moved: r.moved, rewrites: r.rewrites })
        )
        await get().openDetail(pending.assetId)
      } catch (e) {
        set({ rearchive: { ...st, busy: false } })
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /** 「只改记录」= 这一轮之前的老行为：卡片改了，文件留在原地，不写 journal、也不可 Ctrl+Z */
    async rearchiveRecordOnly() {
      const pending = get().rearchive.pending
      set({ rearchive: IDLE_REARCHIVE })
      if (!pending) return
      await get().reclassify(pending.assetId, pending.category, pending.subcategory)
      get().toast('ok', reasonText('rearchive.leftAlone'))
      await get().openDetail(pending.assetId)
    },

    closeRearchive() {
      set({ rearchive: IDLE_REARCHIVE })
    },

    async resolvePending(id, accept) {
      try {
        await window.a.assets.resolvePending(id, accept)
        await get().openDetail(accept ? null : id)
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async trashSelected() {
      const ids = get().selection
      if (!ids.length) return
      try {
        const r = await window.a.assets.trash(ids)
        if (r.trashed.length) get().toast('ok', i18next.t('toast.trashCount', { count: r.trashed.length }))
        for (const f of r.failed) get().toast('bad', `${f.id}：${f.error}`)
        set({ selection: [], detail: null, detailId: null })
        await Promise.all([refreshList(), refreshMeta()])
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async addToCollection(collectionId) {
      const ids = get().selection
      if (!ids.length || !collectionId) return
      try {
        const added = await window.a.collections.addAssets(collectionId, ids)
        const name = get().collections.find((c) => c.id === collectionId)?.name ?? ''
        get().toast('ok', i18next.t('collections.added', { count: added, name }))
        await Promise.all([refreshList(), refreshMeta()])
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async undoLast() {
      try {
        const r = await window.a.journal.undoLast()
        const text = msg(r.messageKey, r.messageParams, r.message ?? r.error)
        if (r.ok) get().toast('ok', text || i18next.t('toast.undoDone'))
        else get().toast('warn', text || i18next.t('toast.undoNone'))
        // 撤销改的是磁盘和库记录，不重拉一遍界面就继续挂着已经消失的卡片
        // （实测：4 个入库撤销完，文件都回 inbox 了，网格还显示 4 张卡）
        if (r.ok && r.undone > 0) {
          set({ selection: [], detail: null, detailId: null })
          await Promise.all([refreshList(), refreshMeta()])
        }
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async refreshIngestQueue() {
      try {
        set({ ingestItems: await window.a.ingest.queue() })
      } catch {
        /* M1 允许队列接口还没实现 */
      }
    },

    async refreshProjects() {
      try {
        const list = await window.a.unity.refreshProjects()
        set({ projects: list })
        return list
      } catch {
        /** 扫盘失败不该让界面空着 —— 退回库里的已知工程 */
        try {
          const list = await window.a.unity.listProjects()
          set({ projects: list })
          return list
        } catch {
          return get().projects
        }
      }
    },

    async setUnityTarget(projectId) {
      try {
        const id = await window.a.unity.setTarget(projectId)
        /**
         * 未运行的工程**不能导入**（§4.3 步骤 4），但可以选中 —— 顶栏要如实说"未运行"。
         * 这里**不弹错**：用户可能只是想先选好目标、再去开 Unity。
         */
        set((s) => ({ unity: { ...s.unity, targetProjectId: id } }))
        const fresh = await window.a.unity.status()
        set((s) => ({ unity: { ...s.unity, ...fresh, targetProjectId: id } }))
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async importAsset(assetId, opts) {
      const t = i18next.t.bind(i18next)
      const s = get()
      /** 1. 必须先有导入目标 —— 没选就直说，不要静默什么都不做 */
      if (!s.unity.targetProjectId) {
        s.toast('warn', t('unity.errNoProject'))
        return
      }
      const project = s.projects.find((p) => p.id === s.unity.targetProjectId) ?? null
      /** 2. 未运行的工程不能导入（§4.3 步骤 4） */
      if (!s.unity.running) {
        s.toast('warn', t('project.notRunningHint', { name: project?.name ?? t('project.target') }))
        return
      }

      const reset = (patch: Partial<ImportFlowState> = {}): void => {
        set((st) => ({
          importFlow: {
            ...st.importFlow,
            busy: false,
            packageName: null,
            packagePath: null,
            assetId: null,
            pending: null,
            /** 排队态也要清掉，否则上一轮 Play 模式的原因会粘在下一次导入上 */
            busyReason: null,
            busyRetry: 0,
            busyNextDelayMs: 0,
            /**
             * 批次也要清。留着它的症状很难查：下一次导入会把上一次那批
             * 已经抽好的成员又导一遍。所以新增字段必须同时出现在这里 ——
             * 这个 `reset` 是整个导入流程**唯一**的"干净状态"出口。
             */
            batch: null,
            /** R4 ①：进度队列也是导入流程的一部分，漏在这里就是"上一条的进度粘在下一次上" */
            queue: EMPTY_QUEUE,
            ...patch
          }
        }))
      }

      set((st) => ({
        importFlow: {
          ...st.importFlow,
          busy: true,
          packageName: null,
          packagePath: null,
          assetId,
          projectId: s.unity.targetProjectId,
          projectName: project?.name ?? null,
          pending: null,
          /** 上一批没点确认就关了窗：这次的批次号必须从空开始，不然会撤错批 */
          batch: null,
          busyReason: null,
          busyRetry: 0,
          busyNextDelayMs: 0
        }
      }))

      try {
        /**
         * 3. 找包。
         *  - 磁盘上就有的 `.unitypackage` → 老路（预扫描 → 冲突 → 导）
         *  - 压缩包成员 → 先 `importPlan`（抽取 + 预扫描），确认后再 `importCommit`
         *  - 多个成员的容器 → **不替用户挑**，让他进容器内部视图勾（那是 M5-B ⑥ 的选择面板）
         */
        let packagePath = opts?.packagePath ?? null
        if (!packagePath) {
          if (!assetId) {
            reset()
            return
          }
          const found = await window.a.unity.packagesOfAsset(assetId)
          if (found.kind === 'empty') {
            get().toast('warn', t('library.noImportablePackage'))
            reset()
            return
          }
          if (!found.packages.length) {
            get().toast('warn', t('library.noImportablePackage'))
            reset()
            return
          }
          /**
           * 判据住在 `shared/memberPick.ts:cardImportChoice` —— 多选批量（`importSelected`）
           * 用的是同一个函数。以前这条规则只写在这条路上，两边各写一遍迟早漂。
           */
          const choice = cardImportChoice(found.packages)
          if (choice.kind === 'needs-choice') {
            /**
             * 多个成员的容器**不替用户挑**：打开选择面板，让他勾。
             * 以前这里是"取第一个 + 一句实话"，等于 A 悄悄替他选了一个包往工程里灌。
             */
            await get().openMemberPicker(assetId)
            get().toast('info', t('library.memberOpenHint', { count: found.packages.length }))
            reset()
            return
          }
          const candidate = found.packages[choice.indexes[0]]
          if (candidate.path === null) {
            /** 单个成员：没有"选哪个"这回事，直接抽 + 预扫描，冲突照旧走三选一 */
            const plan = await window.a.unity.importPlan({ assetId, members: [candidate.relPath] })
            if (!('items' in plan)) {
              get().toast('bad', t(plan.reasonKey, plan.reasonParams ?? {}))
              reset()
              return
            }
            const item = plan.items[0]
            set((st) => ({
              importFlow: {
                ...st.importFlow,
                batch: { batchId: plan.batchId, relPath: item.relPath },
                packageName: item.relPath.split('/').pop() ?? item.relPath,
                /**
                 * 抽取前的路径**不是**能导入的路径（副本在 `<extractRoot>/<id>/<seq>/` 下，
                 * 名字还可能被后端加了目录层）。所以这里清空 `packagePath` 而不是猜一个 ——
                 * 老代码里 `packagePath` 是"导入用的路径"，让成员计划路径冒充它会导到不存在的文件。
                 */
                packagePath: null
              }
            }))
            if (item.conflicts.length) {
              set((st) => ({
                importFlow: {
                  ...st.importFlow,
                  busy: false,
                  pending: { entryCount: item.entryCount, fresh: item.fresh, conflicts: item.conflicts }
                }
              }))
              return
            }
            /**
             * 无冲突时不必问备份 —— 备份只针对"会被覆盖的文件"，
             * 这和老路（散装包）无冲突时直接 `'continue'` 是同一个口径。
             */
            await get().resolveImportConflict('continue')
            return
          }
          /**
           * 一个素材里有多个**散装**包时取第一个并说明，不静默挑一个。
           * 打包成批的选择面板属于 M5-B ⑥。
           */
          packagePath = found.packages[0].path
          if (!packagePath) {
            /**
             * 走到这里说明上面 `needExtract` 那条分支没接住"路径为 null 的成员" ——
             * 那是个 bug，不是用户能造成的状态。宁可在这里停下说一句实话，
             * 也不要把 null 当路径传下去（那边会以"找不到这个 .unitypackage"报回来，
             * 而那时已经没人记得是哪儿不对了）。
             */
            get().toast('bad', t('library.noImportablePackage'))
            reset()
            return
          }
          if (found.packages.length > 1) {
            get().toast('info', t('library.multiplePackages', { count: found.packages.length }))
          }
        }

        const name = packagePath.split(/[\\/]/).pop() ?? packagePath
        set((st) => ({ importFlow: { ...st.importFlow, packageName: name, packagePath } }))

        /** 4. 预扫描（只读）。不满足条件时它有明确 reason */
        const pre = await window.a.unity.preflight({ packagePath })
        if (!pre.ok) {
          get().toast('bad', pre.bridgeMissing ? t('unity.errBridgeMissing') : (pre.reason ?? pre.reasonKey ?? t('unity.errParse')))
          reset()
          return
        }

        /** 5. 有冲突 → 挂起等用户选（§5.1④ 三选一），不擅自覆盖 */
        if (pre.conflicts.length) {
          set((st) => ({
            importFlow: {
              ...st.importFlow,
              busy: false,
              pending: {
                entryCount: pre.entryCount,
                fresh: pre.fresh,
                conflicts: pre.conflicts
              }
            }
          }))
          return
        }

        /** 6. 无冲突 → 直接导（§5.1④：无冲突时跳过弹窗） */
        await get().resolveImportConflict('continue')
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
        reset()
      }
    },

    async resolveImportConflict(choice) {
      const t = i18next.t.bind(i18next)
      const flow = get().importFlow
      const packagePath = flow.packagePath
      const projectId = flow.projectId ?? get().unity.targetProjectId ?? undefined
      const assetId = flow.assetId

      /**
       * 两条岔路：**批次路**（容器成员，副本已经抽好在主进程等着）与
       * **单包路**（磁盘上就有一个 .unitypackage）。
       * 认batch 的依据是 `flow.batch` 在不在，不是"packagePath 为空"——
       * 空 packagePath 也可能是用户什么都没点，那种情况直接收摊。
       */
      if (flow.batch) {
        const batch = flow.batch
        if (choice === 'cancel') {
          /** 反悔就把抽出来的副本立刻还回去，别等主进程那 4 批的额度挤掉 */
          await window.a.unity.importAbandon(batch.batchId)
          set((s) => ({
            importFlow: {
              ...s.importFlow,
              pending: null,
              busy: false,
              packageName: null,
              packagePath: null,
              assetId: null,
              batch: null
            }
          }))
          get().toast('info', t('library.importCancelled'))
          return
        }
        set((s) => ({ importFlow: { ...s.importFlow, pending: null, busy: true } }))
        try {
          const r = await window.a.unity.importCommit({ batchId: batch.batchId, choice })
          if (!('results' in r)) {
            /** 这批已经不在了（程序重启过 / 被新批次挤掉）：如实说，别当作"导入失败" */
            set((s) => ({ importFlow: { ...s.importFlow, busy: false, batch: null } }))
            get().toast('bad', t(r.reasonKey, r.reasonParams ?? {}))
            return
          }
          const good = r.results.filter((x) => x.ok)
          const first = good[0] ?? null
          const projectName = get().projects.find((p) => p.id === projectId)?.name ?? ''
          set((s) => ({
            importFlow: {
              ...s.importFlow,
              busy: false,
              packageName: null,
              packagePath: null,
              assetId: null,
              batch: null,
              projectName,
              last: first
                ? {
                    importId: first.importId ?? '',
                    projectName,
                    created: first.createdGuids.length,
                    overwritten: first.overwrittenGuids.length,
                    /** 批量那条路没把备份数字带回来 → 写 -1（"不知道"），横幅就不许说"已备份 N 个" */
                    backupDir: null,
                    backupSaved: -1
                  }
                : s.importFlow.last
            }
          }))
          /**
           * 报"成功几条 / 失败几条 / **没执行几条**"。
           * 没执行的那些不能算成失败 —— 它们压根没碰过工程（§7-R2 的口径：留着比自动删安全）。
           */
          const msg = t('library.batchResult', {
            ok: r.imported,
            failed: r.failed,
            notRun: r.notRun,
            blocked: r.blocked.length
          })
          get().toast(r.failed || r.notRun ? 'warn' : 'ok', msg)
          if (r.imported) await get().refreshMeta()
        } catch (e) {
          set((s) => ({ importFlow: { ...s.importFlow, busy: false, batch: null } }))
          get().toast('bad', e instanceof Error ? e.message : String(e))
        }
        return
      }

      if (!packagePath) {
        set((s) => ({ importFlow: { ...s.importFlow, busy: false, pending: null } }))
        return
      }

      if (choice === 'cancel') {
        set((s) => ({ importFlow: { ...s.importFlow, pending: null, busy: false, packageName: null, packagePath: null, assetId: null } }))
        get().toast('info', t('library.importCancelled'))
        return
      }

      set((s) => ({ importFlow: { ...s.importFlow, pending: null, busy: true } }))
      try {
        const r = await window.a.unity.importPackage({
          packagePath,
          projectId: projectId ?? undefined,
          assetId,
          choice
        })
        const shortName = packagePath.split(/[\\/]/).pop() ?? packagePath
        if (r.ok && r.importId) {
          const projectName = get().projects.find((p) => p.id === projectId)?.name ?? ''
          set((s) => ({
            importFlow: {
              ...s.importFlow,
              busy: false,
              packageName: null,
              packagePath: null,
              assetId: null,
              pending: null,
              projectName,
              last: {
                importId: r.importId as string,
                projectName,
                created: r.createdGuids?.length ?? 0,
                overwritten: r.overwrittenGuids?.length ?? 0,
                backupDir: r.backupDir ?? null,
                backupSaved: typeof r.backupSaved === 'number' ? r.backupSaved : -1
              }
            }
          }))
          get().toast('ok', t('library.importDone', { name: shortName, count: r.createdGuids?.length ?? 0 }))
        } else {
          set((s) => ({ importFlow: { ...s.importFlow, busy: false, packageName: null, packagePath: null, assetId: null } }))
          get().toast('bad', r.error ?? t('library.importFailed'))
        }
      } catch (e) {
        set((s) => ({ importFlow: { ...s.importFlow, busy: false, packageName: null, packagePath: null, assetId: null } }))
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async rollbackLastImport() {
      const t = i18next.t.bind(i18next)
      const last = get().importFlow.last
      if (!last) return
      try {
        const r = await window.a.unity.rollbackImport(last.importId)
        if (r.ok) {
          /**
           * `unrestorable > 0` 时必须**如实说**"有 N 个被覆盖的文件没备份、内容找不回来"，
           * 不能只报"撤销成功" —— 那会让用户以为工程回到了导入前的样子。
           */
          const lost = r.unrestorable ?? 0
          /**
           * 桥接回 `failed:[路径…]` = "这个资源我没能删掉"。以前这条被丢掉，
           * 界面只剩"删除 0 个新建资源"，看着像"本来就没建东西"，
           * 而真相是"有东西留在工程里"。
           */
          const stuck = r.failedToDelete?.length ?? 0
          const msg =
            (lost > 0
              ? t('library.rollbackPartial', {
                  deleted: r.deletedFiles?.length ?? 0,
                  restored: r.restoredFiles?.length ?? 0,
                  lost
                })
              : t('library.rollbackDone', {
                  deleted: r.deletedFiles?.length ?? 0,
                  restored: r.restoredFiles?.length ?? 0
                })) + (stuck > 0 ? t('library.rollbackDeleteFailed', { count: stuck }) : '')
          get().toast(lost > 0 || stuck > 0 ? 'warn' : 'ok', msg)
          set((s) => ({ importFlow: { ...s.importFlow, last: null } }))
        } else {
          get().toast('bad', r.error ?? t('library.rollbackFailed'))
        }
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    dismissImportResult() {
      set((s) => ({ importFlow: { ...s.importFlow, last: null } }))
    },

    // ------------------------------------------------------------ 容器成员选择（M5-B ⑥）

    async openMemberPicker(assetId) {
      const card = get().cards.find((c) => c.id === assetId) ?? null
      /** 先开面板再拉清单：87 个成员的容器列一次要起后端进程，不能让人对着空气等 */
      set({ memberPicker: { ...IDLE_PICKER, open: true, assetId, containerName: card?.name ?? null, loading: true } })
      await get().reloadMemberPicker()
    },

    closeMemberPicker() {
      const p = get().memberPicker
      /**
       * 面板关掉时**必须把已经抽好的那批副本退回去**。
       * 不退就等于把删除的责任推给"下次开机 prune"，而用户看得见磁盘在涨。
       */
      if (p.plan) void window.a.unity.importAbandon(p.plan.batchId).catch(() => undefined)
      set({ memberPicker: { ...IDLE_PICKER } })
    },

    async reloadMemberPicker() {
      const t = i18next.t.bind(i18next)
      const p = get().memberPicker
      if (!p.assetId) return
      set({ memberPicker: { ...p, loading: true, reasonKey: null } })
      try {
        const res = await window.a.unity.packagesOfAsset(p.assetId)
        /** 预勾的依据只有两种，都是"用户正在忙什么"，不是"A 觉得什么好" */
        const targetName = get().projects.find((x) => x.id === get().unity.targetProjectId)?.name ?? null
        const colId = get().nav.startsWith('col:') ? get().nav.slice(4) : null
        const col = get().collections.find((c) => c.id === colId) ?? null
        const colKeywords = (() => {
          if (!col?.rule_json) return []
          try {
            const rule = JSON.parse(col.rule_json) as { keywords?: string[] }
            return Array.isArray(rule.keywords) ? rule.keywords : []
          } catch {
            return []
          }
        })()
        const tokens = [
          ...projectFingerprintTokens(targetName).map((token) => ({ token, reasonKey: 'pickByProject' as const })),
          ...collectionTokens(col?.name, colKeywords).map((token) => ({ token, reasonKey: 'pickByCollection' as const }))
        ]
        const pre = preselectMembers(res.packages, tokens, { batchMax: IMPORT_BATCH_MAX })
        set({
          memberPicker: {
            ...p,
            loading: false,
            packages: res.packages,
            notes: res.notes,
            emptyReasonKey: res.kind === 'empty' ? res.reasonKey : null,
            /** 有依据才勾；一个都没命中就谁都不勾（§3.4） */
            picked: Object.keys(pre.reasons),
            reasons: pre.reasons,
            tooBroad: pre.tooBroad
          }
        })
        if (res.kind === 'empty') get().toast('warn', t('library.noImportablePackage'))
      } catch (e) {
        set({ memberPicker: { ...get().memberPicker, loading: false, reasonKey: 'err.memberListFailed' } })
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    toggleMemberPick(relPath) {
      const p = get().memberPicker
      set({
        memberPicker: {
          ...p,
          picked: p.picked.includes(relPath) ? p.picked.filter((x) => x !== relPath) : [...p.picked, relPath]
        }
      })
    },

    setMemberPicks(relPaths) {
      set((s) => ({ memberPicker: { ...s.memberPicker, picked: Array.from(new Set(relPaths)) } }))
    },

    pickAllMembers() {
      const p = get().memberPicker
      set({ memberPicker: { ...p, picked: p.packages.map((x) => x.relPath) } })
    },

    clearMemberPicks() {
      set((s) => ({ memberPicker: { ...s.memberPicker, picked: [] } }))
    },

    pickMembersUnder(maxBytes) {
      const p = get().memberPicker
      set({ memberPicker: { ...p, picked: underSize(p.packages, maxBytes) } })
    },

    async runMemberBatches() {
      const p = get().memberPicker
      if (!p.assetId || !p.picked.length || p.running) return
      /**
       * 一次**只规划一批**：后面的批次还没抽，所以磁盘上最多只躺着当前这一批的副本。
       * 先把 87 个全抽出来再问用户，就是把"抽取根只剩 12 GB"那种事故自己造出来。
       */
      const queue = batchesOf(p.picked, IMPORT_BATCH_MAX)
      set({ memberPicker: { ...p, queue, outcome: null, reasonKey: null, plan: null, running: true } })
      await planBatch(queue[0])
      set((s) => ({ memberPicker: { ...s.memberPicker, running: false, queue: queue.slice(1) } }))
    },

    async decideMemberPlan(choice) {
      const p = get().memberPicker
      const plan = p.plan
      if (!plan) return
      if (choice === 'cancel') {
        /** 反悔：这批抽出来的副本立刻还回去，回到勾选那一步 */
        await window.a.unity.importAbandon(plan.batchId).catch(() => undefined)
        set((s) => ({ memberPicker: { ...s.memberPicker, plan: null, outcome: null } }))
        get().toast('info', i18next.t('library.importCancelled'))
        return
      }
      set((s) => ({
        memberPicker: { ...s.memberPicker, running: true },
        /**
         * 按下确认 = 这批的进度队列开始。条目直接拿 `PlanView.items`，
         * 因为那**就是主进程要串行跑的那份**（同一批、同一个顺序）；
         * 从界面自己勾的那份清单推会多算上被 `blocked` 挡掉的条目。
         */
        importFlow: { ...s.importFlow, queue: beginQueue(queueFromPlan(plan, s.importFlow.projectName)) }
      }))
      try {
        const r = await window.a.unity.importCommit({ batchId: plan.batchId, choice })
        if (!('results' in r)) {
          set((s) => ({
            memberPicker: { ...s.memberPicker, running: false, plan: null, reasonKey: r.reasonKey, reasonParams: r.reasonParams ?? {} },
            importFlow: { ...s.importFlow, queue: endQueue(s.importFlow.queue) }
          }))
          return
        }
        set((s) => ({
          memberPicker: { ...s.memberPicker, running: false, plan: null, outcome: r },
          /**
           * 收尾：先按 `BatchOutcome.results` 重算一遍，再把没落地的落成终态。
           *
           * 事件是"直播"，直播可以丢（窗口刷新、订阅晚了）；`importCommit` 的返回值一定完整。
           * 收尾以账本为准，浮层就不会出现"三条还在排队、其实早导完了"那种对不上账的样子。
           */
          importFlow: {
            ...s.importFlow,
            queue: endQueue(
              reconcileFromOutcome(s.importFlow.queue, r.results.map((x) => ({
                relPath: x.relPath,
                ok: x.ok,
                status: x.status,
                reasonKey: x.reasonKey,
                created: x.createdGuids.length,
                overwritten: x.overwrittenGuids.length
              })))
            )
          }
        }))
        /**
         * 刷新统计与列表：容器卡的"已导入 N 次"、详情页那排导入记录都靠它。
         * 导入历史面板自己会重拉，这里不伸手改它的 state。
         */
        if (r.imported) await refreshMeta()
      } catch (e) {
        set((s) => ({
          memberPicker: { ...s.memberPicker, running: false, plan: null, reasonKey: 'err.importChainFailed' },
          importFlow: { ...s.importFlow, queue: endQueue(s.importFlow.queue) }
        }))
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async nextMemberBatch() {
      const p = get().memberPicker
      const next = p.queue[0]
      if (!next) return
      set({ memberPicker: { ...p, outcome: null, reasonKey: null, plan: null, running: true } })
      await planBatch(next)
      set((s) => ({ memberPicker: { ...s.memberPicker, running: false, queue: s.memberPicker.queue.slice(1) } }))
    },

    stopMemberBatches() {
      const p = get().memberPicker
      if (p.plan) void window.a.unity.importAbandon(p.plan.batchId).catch(() => undefined)
      set({ memberPicker: { ...p, plan: null, queue: [], outcome: null, running: false } })
    },

    /**
     * M6 ④ · 补建集合。
     *
     * 默认**全勾**：这条通道是"看一眼要建哪几个 → 点确认"，
     * 一个个人勾 20 次不是预览的意义（真要挑，勾掉几个再点就行）。
     * 而它必须经过这一步确认 —— 直接"点一下就建 20 个集合"就是拿用户库当试验田。
     */
    async openModelBackfill() {
      set({ backfill: { ...IDLE_BACKFILL, open: true, loading: true } })
      try {
        const plan = await window.a.collections.planBackfill()
        set({
          backfill: {
            open: true,
            loading: false,
            plan,
            picked: plan.candidates.map((c) => c.name),
            busy: false
          }
        })
      } catch (e) {
        set({ backfill: { ...IDLE_BACKFILL, open: true } })
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    closeModelBackfill() {
      set({ backfill: IDLE_BACKFILL })
    },

    toggleBackfillPick(name) {
      const b = get().backfill
      const at = b.picked.indexOf(name)
      /** 顺序按点击走（和成员面板同一口径）：撤销与"上次建了哪几个"都要一个稳定的次序 */
      const picked = at >= 0 ? b.picked.filter((n) => n !== name) : [...b.picked, name]
      set({ backfill: { ...b, picked } })
    },

    pickAllBackfill() {
      const b = get().backfill
      set({ backfill: { ...b, picked: (b.plan?.candidates ?? []).map((c) => c.name) } })
    },

    clearBackfillPicks() {
      const b = get().backfill
      set({ backfill: { ...b, picked: [] } })
    },

    async runModelBackfill() {
      const b = get().backfill
      if (!b.plan || !b.picked.length || b.busy) return
      set({ backfill: { ...b, busy: true } })
      try {
        const r = await window.a.collections.applyBackfill(b.picked)
        /** 侧栏那份集合清单与统计都从 meta 来，建完必须重拉一次才看得见 */
        await refreshMeta()
        set({ backfill: IDLE_BACKFILL })
        get().toast('ok', i18next.t('collections.backfillDone', { count: r.created.length }))
        if (r.ignored.length) get().toast('warn', i18next.t('collections.backfillIgnored', { count: r.ignored.length }))
      } catch (e) {
        set({ backfill: { ...b, busy: false } })
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * M6 ⑤ · 收到主进程的自动切换决策。
     *
     * R-51「用户正在操作中不打断」—— 规格原文说的是"有未保存的编辑、正在拖拽"，
     * 而 A 不是编辑器、没有"未保存"这种状态，**这是偏离规格原文的判据**：
     * 有模态框开着（成员面板 / 补建预览）/ 正在拖文件进来 / 导入正在跑 →
     * 不切视图，改成一条"检测到了、没切，点这里现在切"的横幅。
     * 偏离的理由：不切这件事本身要看得见，否则症状就是"A 明明检测到了却没反应"。
     */
    handleAutoSwitch(event) {
      const s = get()
      const busy = s.memberPicker.open || s.backfill.open || s.dropActive || s.importFlow.busy
      /** 发生过一次决策 = "A 需要常驻托盘才能感知 Unity 启动"这句话对他成立（Q3 那条提示的前提） */
      const seen = { event, pinned: false, sawUnityStart: true }
      if (event.action === 'switch' && event.collectionId && !busy) {
        set({ banner: { ...s.banner, ...seen } })
        /** 只切左侧选中项与过滤条件；`search` 一个字都不碰（R-46 / R-52） */
        get().setNav('col:' + event.collectionId)
        return
      }
      if (event.action === 'switch' && busy) {
        set({ banner: { ...get().banner, ...seen, event: { ...event, action: 'skip', reason: 'busy' } } })
        return
      }
      set({ banner: { ...get().banner, ...seen } })
    },

    /** M6 ⑥（Q3）：那条"要不要开机常驻托盘"的提示只问一次，点什么都算答过 */
    async answerAutoLaunch(accept: boolean) {
      try {
        /** 只有他点了"好"才去碰登录启动项（`settings.set` 里那条 `setLoginItemSettings`） */
        if (accept) await window.a.settings.set('autoLaunch', true)
        await window.a.settings.set('autoLaunchAsked', true)
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * R4 ⑦ · 第一次发现某个工程。
     *
     * `ask` → 排进待答队列；`auto` → 直接装并报一句（装失败**必须**回退到弹窗，
     * 不能静默失败 —— 那是"设置里明明开了、什么都没发生"那种最难查的坑）。
     * 判据在主进程算的，这里不许再判一次。
     *
     * 同一工程重复来（广播 + boot 时 drain 到同一条）只留一份：`decision` 已经算好了，
     * 多问一遍纯属骚扰。
     */
    handleProjectFirstSeen(event: BridgeFirstSeenEvent) {
      const t = i18next.t.bind(i18next)
      const queue = (): BridgeFirstSeenEvent[] => get().bridgeAsk.filter((e) => e.projectId !== event.projectId)
      if (event.decision === 'ask') {
        if (get().bridgeAsk.some((e) => e.projectId === event.projectId && e.decision === 'ask')) return
        set({ bridgeAsk: [...queue(), event] })
        return
      }
      void (async () => {
        try {
          const r = await window.a.unity.installBridge(event.projectId)
          if (r.ok) {
            /** R-14：自动安装要写清"装了什么、装到哪"，只说"装好了"等于让人去猜文件落在哪 */
            get().toast('ok', t('project.autoInstalled', { name: event.name, count: r.copied, to: r.target }))
            /**
             * 装成了才让主进程把这条出队。
             * ⚠ 用 `.catch(() => undefined)` 包住：这一步失败只是"下次刷新会再装一遍"
             * （`installBridge` 那边有 alreadyInstalled 分支，不会覆盖用户改过的东西），
             * 不能让它掉进下面的 catch 变成"自动装没成功"那句假话。
             */
            await window.a.unity.bridgeAskDone(event.projectId).catch(() => undefined)
            return
          }
          get().toast('warn', t('project.autoInstallFailed', { name: event.name }))
        } catch {
          get().toast('warn', t('project.autoInstallFailed', { name: event.name }))
        }
        /** 自动装没成 → 让用户自己决定，别把这件事悄悄吞掉 */
        set({ bridgeAsk: [...queue(), { ...event, decision: 'ask' }] })
      })()
    },

    /** 三按钮的答案。`install-once` 不写库（下次第一次发现还会问） */
    async answerBridgeAsk(choice: 'install-once' | 'always' | 'never') {
      const t = i18next.t.bind(i18next)
      const cur = get().bridgeAsk[0]
      /** 先出队再干活：装的过程要几秒，期间不该让用户再点一次 */
      set({ bridgeAsk: get().bridgeAsk.slice(1) })
      if (!cur) return
      try {
        await window.a.unity.answerBridgeAsk(cur.projectId, choice)
        if (choice !== 'never') {
          const r = await window.a.unity.installBridge(cur.projectId)
          if (!r.ok) get().toast('bad', r.error ?? t('project.installFailed'))
          else get().toast('ok', r.alreadyInstalled ? t('project.installAlready', { name: cur.name }) : t('project.installDone', { name: cur.name, count: r.copied }))
        }
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * M7 · 从侧栏那条"库还没配好"回到向导。
     *
     * 跳过向导的人后来改主意了要能回去 —— 但不能靠"重新拦一次"：
     * 门禁判的是 `startedHere`（本次启动时库根空不空），所以这里显式把它拨成 true，
     * 同时把"我跳过了"那痕擦掉（擦掉之后 `wizardGate` 才会往 'wizard' 走）。
     */
    async reopenWizard() {
      set({ wizardStartedHere: true })
      await get().patchSettings({ onboardingSkippedAt: null, onboardingDone: false })
    },

    /**
     * 桥接装成了 → 本地那份待答队列也把它摘掉。
     *
     * 主进程那边 `unity:install-bridge` 已经出队了（刷新之后不会再弹），这里管的是**当前这一屏**：
     * 不摘的话向导装完两个、走完向导，弹窗还会拿旧事件问"这个工程还没装桥接"。
     */
    settleBridgeAsk(projectId) {
      set({ bridgeAsk: get().bridgeAsk.filter((e) => e.projectId !== projectId) })
    },

    /**
     * M7 Q10 · 「剩下这些都不再问」。
     *
     * 屏幕上这条**不动**（它还得由用户在三按钮里选一个），其余每条各写一行 never。
     * 本地队列也跟着收：只留队首，否则弹窗会一直挂着"还有 N 个在等"。
     */
    async silenceRestBridgeAsks() {
      const cur = get().bridgeAsk[0]
      const waiting = get().bridgeAsk.length
      if (!canSilenceRestBridgeAsks(waiting)) return
      try {
        const r = await window.a.unity.bridgeAskNeverRest(cur?.projectId ?? '')
        set({ bridgeAsk: cur ? [cur] : [] })
        get().toast('ok', i18next.t('unity.bridgeAskSilencedRest', { n: r.answered }))
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * 关掉窗口（Esc / 点遮罩）≠ 回答。
     *
     * 以前这里等价于按「暂不」，会把"以后别问了"写进库 —— 用户只是手滑按了一下 Esc，
     * 这个工程就永远不再被问。**什么都不写**，下次 A 启动还会再问一次。
     */
    dismissBridgeAsk() {
      set({ bridgeAsk: get().bridgeAsk.slice(1) })
    },

    pinBanner() {
      set({ banner: { ...get().banner, pinned: true } })
    },

    dismissBanner() {
      const b = get().banner
      const id = b.event?.projectId ?? null
      set({
        banner: {
          event: null,
          pinned: false,
          sawUnityStart: b.sawUnityStart,
          /** 「这次忽略」= 本次运行内这个工程不再弹（§4.3 步骤 3） */
          ignoredProjects: id && !b.ignoredProjects.includes(id) ? [...b.ignoredProjects, id] : b.ignoredProjects
        }
      })
    },

    async bannerChoose(collectionId) {
      const b = get().banner
      let row = get().collections.find((c) => c.id === collectionId)
      if (!row) {
        await refreshMeta()
        row = get().collections.find((c) => c.id === collectionId)
      }
      if (!row) {
        get().toast('warn', i18next.t('project.bannerRuleMissing', { name: '' }))
        return
      }
      set({
        banner: {
          ...b,
          event: b.event
            ? { ...b.event, action: 'switch', collectionId, collectionName: row.name, reason: 'switched' }
            : b.event
        }
      })
      get().setNav('col:' + collectionId)
      /** 选完不擅自改规则：要改得他再点一次"以后都这样"（规格："选择后询问是否更新规则"） */
      get().toast('info', i18next.t('project.bannerChooseHint', { name: row.name }))
    },

    async bannerRemember() {
      const b = get().banner
      const e = b.event
      if (!e?.collectionId || !e.projectPath) return
      let row = get().collections.find((c) => c.id === e.collectionId)
      if (!row) {
        /**
         * 界面那份集合清单是缓存：用户可能在别处（维护页、另一台窗口的集合页）刚改过。
         * 找不到就先重拉一次再试，**不许静默什么都不做** ——
         * 静默失败的症状是"我明明点了以后都这样，下次开 Unity 还是没切"。
         */
        await refreshMeta()
        row = get().collections.find((c) => c.id === e.collectionId)
      }
      if (!row) {
        get().toast('warn', i18next.t('project.bannerRuleMissing', { name: e.collectionName ?? '' }))
        return
      }
      let rule: CollectionRule = {}
      try {
        rule = row.rule_json ? (JSON.parse(row.rule_json) as CollectionRule) : {}
      } catch {
        rule = {}
      }
      const paths = new Set([...(rule.projectPaths ?? []), e.projectPath])
      try {
        await window.a.collections.update(row.id, {
          rule_json: JSON.stringify({ ...rule, projectPaths: Array.from(paths) })
        })
        await refreshMeta()
        set({ banner: { event: null, pinned: false, ignoredProjects: b.ignoredProjects, sawUnityStart: b.sawUnityStart } })
        get().toast('ok', i18next.t('project.bannerRemembered', { name: row.name }))
      } catch (err) {
        get().toast('bad', err instanceof Error ? err.message : String(err))
      }
    },

    async rollbackMemberOutcome() {
      const t = i18next.t.bind(i18next)
      const o = get().memberPicker.outcome
      if (!o) return
      /**
       * 整批退回走 `unity:rollback-batch`：按 batch_id **倒序**逐条撤，
       * 一条失败就停下 —— 继续闷着头撤，最后只能说"撤了几条、剩下的状态不明"。
       */
      try {
        const r = await window.a.unity.rollbackBatch(o.batchId)
        if (!('details' in r)) {
          get().toast('bad', t(r.reasonKey, r.reasonParams ?? {}))
          return
        }
        if (r.rolledBack && !r.stoppedAt) {
          get().toast('ok', t('library.rollbackDone', { deleted: r.details.reduce((a, d) => a + d.deletedFiles, 0), restored: r.details.reduce((a, d) => a + d.restoredFiles, 0) }))
        } else {
          const lost = r.details.reduce((a, d) => a + d.unrestorable, 0)
          get().toast('warn', t('library.memberRollbackStopped', { done: r.rolledBack, left: r.details.filter((d) => !d.ok).length, lost }))
        }
        await refreshMeta()
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * R4 ② · 多选卡批量导入。
     *
     * 三条口径：
     *  1. **不替用户挑成员**：一张卡里有好几个"要抽出来才有路径"的成员时跳过它，
     *     让他走成员面板 —— 判据在 `shared/memberPick.ts:cardImportChoice`，
     *     和单卡导入用的是**同一个函数**（两边各写一遍必漂）。
     *  2. 跳过多少张要如实报（`skipped`），不许"勾 5 导 3"还一声不吭。
     *  3. 一次只规划一批：后面的批次还没抽，磁盘上不会同时躺着几十份副本
     *     （M5-B 那条"先把 87 个全抽出来再问用户"的教训）。
     */
    async importSelected() {
      const t = i18next.t.bind(i18next)
      const s = get()
      const ids = Array.from(new Set(s.selection))
      if (!ids.length) return
      if (!s.unity.targetProjectId) {
        get().toast('warn', t('library.noTargetProject'))
        return
      }
      if (s.memberPicker.open || s.batchImport.open || s.backfill.open || s.importFlow.busy) {
        get().toast('info', t('library.batchBusy'))
        return
      }
      const items: BatchItem[] = []
      let skipped = 0
      for (const assetId of ids) {
        let found = null
        try {
          found = await window.a.unity.packagesOfAsset(assetId)
        } catch {
          skipped++
          continue
        }
        const choice = cardImportChoice(found.packages)
        if (choice.kind !== 'single') {
          skipped++
          continue
        }
        const p = found.packages[choice.indexes[0]]
        items.push({ assetId, relPath: p.relPath, label: p.relPath })
      }
      if (!items.length) {
        get().toast('warn', t('library.batchNothing', { picked: ids.length, skipped }))
        return
      }
      const batches = batchesOf(items, IMPORT_BATCH_MAX)
      set({ batchImport: { ...IDLE_BATCH, open: true, skipped, queue: batches.slice(1), running: true } })
      await planBatchItems(batches[0])
      set((st) => ({ batchImport: { ...st.batchImport, running: false } }))
      if (skipped) get().toast('warn', t('library.batchSkipped', { count: skipped }))
    },

    async decideBatchPlan(choice) {
      const t = i18next.t.bind(i18next)
      const b = get().batchImport
      const plan = b.plan
      if (!plan) return
      if (choice === 'cancel') {
        await window.a.unity.importAbandon(plan.batchId).catch(() => undefined)
        set({ batchImport: { ...get().batchImport, plan: null, outcome: null } })
        get().toast('info', t('library.importCancelled'))
        return
      }
      set((st) => ({
        batchImport: { ...st.batchImport, running: true },
        /** 按下确认 = 这批开始串行跑，第一条进"进行中"（判据不许组件自己猜） */
        importFlow: { ...st.importFlow, queue: beginQueue(st.importFlow.queue) }
      }))
      try {
        const r = await window.a.unity.importCommit({ batchId: plan.batchId, choice })
        if (!('results' in r)) {
          set((st) => ({
            batchImport: { ...st.batchImport, running: false, plan: null, reasonKey: r.reasonKey, reasonParams: r.reasonParams ?? {} },
            importFlow: { ...st.importFlow, queue: endQueue(reconcileFromOutcome(st.importFlow.queue, [])) }
          }))
          return
        }
        set((st) => ({
          batchImport: { ...st.batchImport, running: false, plan: null, outcome: r },
          importFlow: {
            ...st.importFlow,
            queue: endQueue(
              reconcileFromOutcome(
                st.importFlow.queue,
                r.results.map((x) => ({
                  relPath: x.relPath,
                  ok: x.ok,
                  status: x.status,
                  reasonKey: x.reasonKey,
                  created: x.createdGuids.length,
                  overwritten: x.overwrittenGuids.length
                }))
              )
            )
          }
        }))
        if (r.imported) await refreshMeta()
      } catch (e) {
        set((st) => ({
          batchImport: { ...st.batchImport, running: false, plan: null, reasonKey: 'err.importChainFailed' },
          importFlow: { ...st.importFlow, queue: endQueue(st.importFlow.queue) }
        }))
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async nextBatch() {
      const b = get().batchImport
      const next = b.queue[0]
      if (!next) return
      set({ batchImport: { ...b, plan: null, outcome: null, reasonKey: null, running: true } })
      await planBatchItems(next)
      set((st) => ({ batchImport: { ...st.batchImport, running: false, queue: st.batchImport.queue.slice(1) } }))
    },

    stopBatches() {
      const b = get().batchImport
      if (b.plan) void window.a.unity.importAbandon(b.plan.batchId).catch(() => undefined)
      set({ batchImport: { ...b, plan: null, queue: [], outcome: null, running: false } })
    },

    closeBatchImport() {
      const b = get().batchImport
      /** 关窗就等于"这批不要了"：已抽出来的副本必须当场退回去，不能留在盘上等下次开机 */
      if (b.plan) void window.a.unity.importAbandon(b.plan.batchId).catch(() => undefined)
      set({ batchImport: IDLE_BATCH, importFlow: { ...get().importFlow, queue: EMPTY_QUEUE } })
    },

    async rollbackBatchOutcome() {
      const t = i18next.t.bind(i18next)
      const o = get().batchImport.outcome
      if (!o) return
      try {
        const r = await window.a.unity.rollbackBatch(o.batchId)
        if (!('details' in r)) {
          get().toast('bad', t(r.reasonKey, r.reasonParams ?? {}))
          return
        }
        if (r.rolledBack && !r.stoppedAt) {
          get().toast(
            'ok',
            t('library.rollbackDone', {
              deleted: r.details.reduce((a, d) => a + d.deletedFiles, 0),
              restored: r.details.reduce((a, d) => a + d.restoredFiles, 0)
            })
          )
        } else {
          const lost = r.details.reduce((a, d) => a + d.unrestorable, 0)
          get().toast('warn', t('library.memberRollbackStopped', { done: r.rolledBack, left: r.details.filter((d) => !d.ok).length, lost }))
        }
        set({ batchImport: { ...get().batchImport, outcome: null } })
        await refreshMeta()
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    },

    async ingestPaths(paths) {
      if (!paths.length) return
      try {
        const r = await window.a.ingest.fromPaths(paths)
        if (r.rejected.length) {
          for (const bad of r.rejected) get().toast('bad', rejectText(bad))
        }
        if (r.accepted.length) set({ nav: 'inbox' })
        await get().refreshIngestQueue()
      } catch (e) {
        get().toast('bad', e instanceof Error ? e.message : String(e))
      }
    }
  }
})

export function localeName(l: LocaleKey): string {
  return l
}
