/**
 * R4 ⑦ · 第一次发现某个 Unity 工程时，要不要弹"装桥接吗"那个三按钮窗。
 *
 * ## 为什么判据要抽成纯函数
 *
 * 本仓库渲染层零 DOM 测试，判据写在组件里就等于没测。而且这条判据有**六个输入、四种出口**，
 * 靠手点很难凑齐（"已经装过的工程"、"上次选了以后都自动装"、"全局开关开着"…），
 * 所以全放这里，组件只做薄壳映射，`tests/shared/bridge-ask.spec.ts` 逐条钉。
 *
 * ## 四条口径（都是规格点名要写清的）
 *
 *  1. **只在"第一次发现这个工程"那一刻问。** 三路运行状态探测每 3 秒跑一轮，
 *     不加这道闸的话用户会被问到关软件。边沿判定在 `project/api.ts`。
 *  2. **已经装了桥接就不问。** `isBridgeInstalled` 判的是
 *     `Packages/com.avca.bridge/package.json` 在不在。
 *  3. **"以后都自动安装"是*这个工程*以后自动装，不是开机自启。** 措辞按 M6 Q3 那条教训写
 *     （那次把"开机常驻托盘"和"自动切换"混在一句话里，用户以为勾了就会开机启动）。
 *     存的是 `setting` 键 `bridgeAsk:<projectId>`（裁定 Q7：不为这个动 schema）。
 *  4. **`bridgeAutoInstall` 这个设置项以前主进程无一处读取 —— 是个死设置。**
 *     它现在真的参与判定（`autoInstallSetting`），并且有一条"读源码钉接线"的用例
 *     防止它再变成第二个 `autoSwitchBehavior`。
 */

export type BridgeAskAnswer = 'always' | 'never'
export type BridgeAskChoice = 'install-once' | 'always' | 'never' | 'later'
export type BridgeAskDecision = 'ask' | 'auto' | 'quiet'

export interface BridgeAskInput {
  /** 这个工程已经装着桥接了（装了就不该打扰用户） */
  installed: boolean
  /** 用户以前答过什么；null = 从没问过 */
  answer: BridgeAskAnswer | null
  /** 全局设置 `bridgeAutoInstall`（设置页那个开关） */
  autoInstallSetting: boolean
  /** 这一轮是不是**第一次发现**这个工程（边沿，不是状态） */
  firstSighting: boolean
  /**
   * 这一轮是不是**发现它开着**（边沿）。
   *
   * 为什么需要第二个时机：「以后都自动安装」如果只在"第一次发现"那一刻生效，
   * 那用户答完之后这个工程已经在库里了、边沿再也不会亮 →
   * 那个答案**永远不会被执行**（第一次发现时 Unity 常常还没开，装了也没法立刻验证）。
   * 所以自动装走两个时机：第一次发现、或每次发现它在运行。
   */
  running: boolean
}

/** setting 表的键名。和 `projectGuids:<id>` 一个路子（不动 schema） */
export function bridgeAskKey(projectId: string): string {
  return `bridgeAsk:${projectId}`
}

/** 存进去的值 / 从库里读出来的值都可能是脏的，这里统一收成 `always|never|null` */
export function parseBridgeAskAnswer(raw: unknown): BridgeAskAnswer | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v === 'always') return 'always'
  if (v === 'never') return 'never'
  return null
}

/**
 * 该不该问 / 要不要直接装。
 *
 * 顺序是**先看出声条件，再看出声方式**：装了桥接、答过"暂不"、不在两个边沿上 ——
 * 都是 `quiet`，不弹也不装。
 */
export function bridgeAskDecision(i: BridgeAskInput): BridgeAskDecision {
  if (i.installed) return 'quiet'
  /** 用户答过"暂不"就只压住**问**这一件事；自动装是另一条路（见下面），不受它影响 */
  const wantsAuto = i.answer === 'always' || i.autoInstallSetting
  if (wantsAuto) {
    /** 自动装也要挑时机：第一次发现、或发现它开着。每 3 秒一轮地装是没意义的 */
    return i.firstSighting || i.running ? 'auto' : 'quiet'
  }
  if (i.answer === 'never') return 'quiet'
  /** 问只在"第一次发现"那一刻问一次；否则探测每 3 秒一轮，会问到用户关软件 */
  return i.firstSighting ? 'ask' : 'quiet'
}

/**
 * 安装一次和稍后连接不保存永久意愿；自动连接存 always。
 * never 仅供明确选择「不再询问此工程」的旧接口使用。
 */
export function bridgeAskAnswerFor(choice: BridgeAskChoice): BridgeAskAnswer | null {
  if (choice === 'always') return 'always'
  if (choice === 'never') return 'never'
  return null
}

/**
 * M7 Q10 · 要不要给"剩下这些都不再问"那颗按钮。
 *
 * 判据只有一句：**队列里不止一条**才值得说"剩下这些"。
 *
 * ⚠ 这一档按的是**每个工程各写一行 `never`**，不是加一个全局静音开关 ——
 * `bridgeAskDecision` 的判据必须继续只有"这个工程答过什么"这一个真相来源。
 * 加全局标志的话，以后"为什么这个工程不问了"就没法从现象反推（第 5 轮那种坑的翻版）。
 */
export function canSilenceRestBridgeAsks(waiting: number): boolean {
  return waiting > 1
}

/** 「剩下 N 个都不再问」里的 N：正在屏幕上这条不算"剩下"。 */
export function restBridgeAskCount(waiting: number): number {
  return Math.max(0, waiting - 1)
}
