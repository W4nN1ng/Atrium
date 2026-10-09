/**
 * **M6 的回退验证器**：把 M6 ①–⑥ 每处修复临时改回旧写法，跑一遍用例，确认它**真的会红**，然后无条件还原。
 *
 * 为什么又要写一份而不是复用 `verify-red-m5b.cjs`：钉的东西完全不同 —— M5-B 钉的是
 * 抽取/导入链路的闸门，M6 钉的是"匹配口径 + 副作用时机 + 留痕"。同一份 CASES 表塞一起
 * 会让两边都没法单独跑（本工具一次要跑 40 轮 vitest）。
 *
 * 这一份至少覆盖他自己点名的四条：**冷却条件、平手留痕、行为开关真被读、`fold` 被导出**，
 * 外加隐患 B（skip 不写冷却）、R-52（切视图不清搜索框）、④ 的"只认预览名单"三条后门闸门。
 *
 * 用法：
 *   node tools/verify-red-m6.cjs          # 全部跑一遍（约 4–6 分钟）
 *   node tools/verify-red-m6.cjs 14       # 只跑第 14 条
 *
 * ⚠ 它会真的改源文件（跑完立刻还原），跑之前保证工作区干净、A 没在跑。
 * ⚠ **别和别的重活并行跑**（M5-B 实测过：和 selfcheck 一起发会冒出一条假"漏网"）。
 * ⚠ 锚文本一律**单行**：源文件是 CRLF，多行锚会因为 \r 对不上而 0 命中（工具会当场拒绝，不会瞎改）。
 * ⚠ 每条 patch 用"锚文本恰好出现 1 次"定位；不唯一就失败。
 * ⚠ 跑之前先 `npm run native:node`：better-sqlite3 是双 ABI 的，Electron 跑过之后
 *   直接起 vitest 会整文件报 NODE_MODULE_VERSION 不匹配（18:41 就这么红过三条，不是回归）。
 *
 * ## 第一次跑就抓到两条"假绿"（这两条才是本工具的存在理由）
 *
 *  - **C7**：`真切换 → 写冷却 + 通知界面，顺序是"先写库再通知"` 这条用例的名字写着"顺序"，
 *    但断言里只查了"两件都发生过"。把 `markSwitched` 推进 microtask（= 通知先跑）它照样绿。
 *    现在 harness 记 `order` 数组，断言 `['markSwitched','notify']`。
 *  - **E6**：`BANNER_AUTO_HIDE_MS` 全仓库没有一条用例看过这个**数字** —— 淡出那条只看
 *    `autoHide` 布尔，改成 0 或 10 分钟都不红。补了一条数字钉子（和 C8/C9 那两条同一味药：
 *    逻辑用例按常量写，常量本身就得单独钉）。
 *  - **G1**（本工具自己的期望写错了，也算一条）：`SCHEMA_VERSION` 从 6 退回 5，
 *    "V6 那列加没加出来"的用例**照样绿** —— `migrate()` 看的是库里的 `user_version`，
 *    V6 一样会跑。真症状在下一次启动：`user_version` 被写成 5 → V6 二次执行 → `duplicate column`
 *    → 库打不开。补了一条不变量用例（`SCHEMA_VERSION == 最后一篇迁移的版本号`）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SPECS = [
  'tests/shared/project-match.spec.ts',
  'tests/project/fingerprint.spec.ts',
  'tests/project/auto-switch.spec.ts',
  'tests/db/migration-v6.spec.ts',
  'tests/shared/model-collections.spec.ts',
  'tests/shared/backfill-state.spec.ts',
  'tests/library/model-backfill.spec.ts',
  'tests/shared/banner-state.spec.ts',
  'tests/renderer/auto-switch-store.spec.ts'
]
const VITEST_ENTRY = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const REPORT = path.join(os.tmpdir(), 'avca-verify-red-m6.json')

/** @type {Array<{title:string, file?:string, from?:string, to?:string, patches?:Array<{file:string,from:string,to:string}>, count?:number, expect:string[]}>} */
const CASES = [
  // ---------------------------------------------------------------- M6 ① 匹配口径
  {
    title: 'A1. `fold` 退回本地自己写一份（M4 那个 NFKD 浊音坑就会回来）',
    patches: [
      { file: 'src/shared/normalize.ts', from: 'export function fold(', to: 'function fold(' },
      {
        file: 'src/shared/projectMatch.ts',
        from: "import { fold, searchForms } from './normalize'",
        to: "import { searchForms } from './normalize'\nconst fold = (s: string): string => s"
      }
    ],
    expect: [
      'fold 是导出的（M6 要用它；被改回私有这条直接红）',
      'normalize.ts 里 fold 的声明带 export（读源码钉接线，行为测试挡不住"只给内部用"）'
    ]
  },
  {
    title: 'A2. token 资格闸门撤掉（单字、短词、纯数字都能当匹配依据）',
    file: 'src/shared/projectMatch.ts',
    from: '  return CJK_ONLY.test(t) ? t.length >= MIN_CJK_LEN : t.length >= MIN_LATIN_LEN',
    to: '  return true',
    expect: ['ASCII 短于 3 不参与、CJK 短于 2 不参与、纯数字不参与', '关键词 av 不许咬住 avatar（子串匹配的后果 M5-B 实测过）']
  },
  {
    title: 'A3. 通用词闸门撤掉（`unity` 这种什么都没说的词也能切集合）',
    file: 'src/shared/projectMatch.ts',
    from: '    if (isGeneric(kw, opts)) {',
    to: '    if (false) {',
    expect: [
      'vrc 命中 3 个已知工程 → 判通用词，不切，并留痕为什么没切',
      '一个词命中**全部**已知工程才算"什么都没说"（unity 这种）'
    ]
  },
  {
    title: 'A4. 关键词平手改成"取排序后第一个"（Q1 说绝不硬选）',
    file: 'src/shared/projectMatch.ts',
    from: "  if (tied.length > 1) return { kind: 'ambiguous', evidence: tied }",
    to: "  if (false) return { kind: 'ambiguous', evidence: tied }",
    expect: ['完全平手 → ambiguous，两个候选都在（留痕），调用方拿不到可切的结论']
  },
  {
    title: 'A5. 同一条路径写进两个集合时硬选一个',
    file: 'src/shared/projectMatch.ts',
    from: "    return { kind: 'ambiguous', evidence: pathHits }",
    to: "    return { kind: 'hit', evidence: pathHits[0] }",
    expect: ['同一条精确路径被写进两个集合 → 也判平手，不硬选']
  },
  {
    title: 'A6. 精确路径不再优先于关键词（"以后都这样"点了没效果）',
    file: 'src/shared/projectMatch.ts',
    from: "  if (pathHits.length === 1) return { kind: 'hit', evidence: pathHits[0] }",
    to: "  if (false) return { kind: 'hit', evidence: pathHits[0] }",
    expect: ['路径命中优先于一切关键词，哪怕别的集合 priority 更高']
  },
  {
    title: 'A7. 目录名不参与匹配（首帧没有 topFolders 时永远匹配不上）',
    file: 'src/shared/projectMatch.ts',
    from: '    fp.dirName,',
    to: "    '',",
    expect: ['只有目录名也能命中（§4.3 步骤 1「首帧先用项目名匹配」）']
  },
  // ---------------------------------------------------------------- M6 ② 指纹采集
  {
    title: 'B1. 不看 bridgeVersion 就用桥接回的清单（Q5：不许假设都装了新版）',
    file: 'src/main/project/fingerprint.ts',
    from: '  const canListAssets = !!ver && compareVersion(ver, BRIDGE_WITH_ASSET_LIST) >= 0',
    to: '  const canListAssets = true',
    expect: ['旧版桥接（1.0.0）：即使它回了 avatarDescriptors 也**不用**，并记 bridgeTooOld']
  },
  {
    title: 'B2. 顶层目录上限撤掉（撞线不记账，"少列"变成静默）',
    file: 'src/main/project/fingerprint.ts',
    from: '  return { folders: all.slice(0, TOP_FOLDERS_MAX), capped: all.length > TOP_FOLDERS_MAX }',
    to: '  return { folders: all, capped: false }',
    expect: ['撞线必须记账：201 个目录只收 200 个，并说 capped']
  },
  {
    title: 'B3. 桥接抛错不再吞（这条链挂在每 3 秒的轮询上，抛一次就废）',
    file: 'src/main/project/fingerprint.ts',
    from: "    notes.push('bridgeThrew')",
    to: '    throw e as Error',
    expect: ['桥接抛错 → 不往外抛，退回磁盘那半边并记 bridgeThrew']
  },
  {
    title: 'B4. 心跳过期也去问桥接（每次白等 5 秒）',
    file: 'src/main/project/fingerprint.ts',
    from: '  return !isHeartbeatStale(probe)',
    to: '  return true',
    expect: ['桥接没装 → false；装了但心跳过期 → false；心跳新鲜 → true']
  },
  // ---------------------------------------------------------------- M6 ③ 决策与副作用
  {
    title: 'C1. 冷却条件撤掉（同一个工程反复切集合）',
    file: 'src/main/project/autoSwitch.ts',
    from: '  if (last !== null && input.now - last < input.cooldownMs) {',
    to: '  if (false) {',
    expect: ['冷却：差 1 毫秒都算冷却中，过线就放行']
  },
  {
    title: 'C2. 把 NULL 当 0 用（从没切过的工程永远在冷却里）',
    file: 'src/main/project/autoSwitch.ts',
    from: '  const last = input.lastAutoSwitchAt',
    to: '  const last = input.lastAutoSwitchAt ?? 0',
    expect: ['从没切过（NULL）不受冷却影响 —— 别把 null 当 0 用']
  },
  {
    title: 'C3. ⚠隐患 B：skip 也写冷却（一次没切把后面 5 分钟的真命中全吞掉）',
    file: 'src/main/project/autoSwitch.ts',
    from: "    if (decision.action === 'switch') deps.markSwitched(p.id, t)",
    to: '    deps.markSwitched(p.id, t)',
    expect: [
      '**skip 一律不写冷却**（四种 skip 全测）',
      '一次 skip 之后，紧接着的真实命中**仍然能切**（隐患 B 的那条断言）'
    ]
  },
  {
    title: 'C4. 行为开关启动时快照一次（改了设置要重启才生效）',
    file: 'src/main/project/autoSwitch.ts',
    from: '          behavior: deps.behavior(),',
    to: "          behavior: 'when_matched',",
    expect: ['三档行为开关**每轮都重新读**（不许启动时快照一次）']
  },
  {
    title: 'C5. `never` 这一档照样去读盘（设置说"从不"就不该有副作用）',
    file: 'src/main/project/autoSwitch.ts',
    from: "      if (deps.behavior() === 'never') {",
    to: '      if (false) {',
    expect: ['never 这一档连盘都不读（设置说"从不"就不该有任何副作用）']
  },
  {
    title: 'C6. 平手时不把候选名单发给界面（Q1 的留痕少一半）',
    file: 'src/main/project/autoSwitch.ts',
    from: "      candidates: decision.action === 'skip' && decision.names ? decision.names.split('、') : [],",
    to: '      candidates: [],',
    expect: ['**skip 一律不写冷却**（四种 skip 全测）']
  },
  {
    title: 'C7. 先通知界面再写库（通知抛错就把冷却丢了，等于没切过）',
    file: 'src/main/project/autoSwitch.ts',
    from: "    if (decision.action === 'switch') deps.markSwitched(p.id, t)",
    to: "    if (decision.action === 'switch') queueMicrotask(() => deps.markSwitched(p.id, t))",
    expect: ['真切换 → 写冷却 + 通知界面，顺序是"先写库再通知"']
  },
  {
    title: 'C8. 冷却时长改成 1 分钟（逻辑用例按常量写，只有数字钉子能发现）',
    file: 'src/shared/constants.ts',
    from: 'export const AUTO_SWITCH_COOLDOWN_MS = 5 * 60 * 1000',
    to: 'export const AUTO_SWITCH_COOLDOWN_MS = 60 * 1000',
    expect: ['冷却时长就是规格那 5 分钟（常量改了逻辑用例照样绿，所以数字得单独钉）']
  },
  {
    title: 'C9. 托盘置顶时长改成 15 秒（Q6 的裁定值没人钉就会漂）',
    file: 'src/shared/constants.ts',
    from: 'export const WAKE_TOPMOST_MS = 1200',
    to: 'export const WAKE_TOPMOST_MS = 15_000',
    expect: ['托盘唤醒置顶 1.2 秒（Q6 裁定值：规格原文只说"短暂闪烁"，没给时长）']
  },
  // ---------------------------------------------------------------- M6 ④ 补建
  {
    title: 'D1. 通用值闸门撤掉（给 UNIVERSAL / 通用 也建集合）',
    file: 'src/shared/modelCollections.ts',
    from: '    if (GENERIC.has(key)) {',
    to: '    if (false) {',
    expect: [
      'UNIVERSAL 这类通用值不建集合，但要留痕（不解释用户会以为漏了）',
      '中文通用值同样拦掉（共通 / 汎用 / 通用 都不是模型名）'
    ]
  },
  {
    title: 'D2. 短值闸门撤掉（建出来的单字集合会咬住一片工程）',
    file: 'src/shared/modelCollections.ts',
    from: '    if (!usableToken(key)) {',
    to: '    if (false) {',
    expect: ['短到不能当匹配依据的值不建（建出来会咬住一片工程）']
  },
  {
    title: 'D3. 已建过的集合不去重（每次点补建都塞一批重名）',
    file: 'src/shared/modelCollections.ts',
    from: '    if (existing.has(key)) {',
    to: '    if (false) {',
    expect: ['已经建过的集合不重复建（按归一化键比，不按字面）', '已经建过的名字不再出现在候选里']
  },
  {
    title: 'D4. 平票时不避开全大写（显示名取决于 SQL 返回顺序）',
    file: 'src/shared/modelCollections.ts',
    from: '  if (candidateShouts !== currentShouts) return !candidateShouts',
    to: '  if (false) return !candidateShouts',
    expect: ['平票时不取全大写那种（否则显示名取决于 SQL 返回顺序，同一份库两次能建出两个名字）']
  },
  {
    title: 'D5. ⚠后门：apply 接受预览里没有的名字（这条通道变成任意造数据）',
    file: 'src/main/library/modelCollections.ts',
    from: '    const c = allow.get(name)',
    to: '    const c = allow.get(name) ?? { name, key: name, keywords: [name], count: 0 }',
    expect: ['只认刚才预览里出现过的名字（否则这条通道就是任意造数据的后门）']
  },
  {
    title: 'D6. 只数 variant 不数 tag（只打了标签的那批永远补建不出来）',
    file: 'src/main/library/modelCollections.ts',
    from: "WHERE t.kind='avatar' GROUP BY t.name",
    to: "WHERE t.kind='nope' GROUP BY t.name",
    expect: ['variant 与 tag 两处取并集（只看一处就会漏掉只打了标签的那批）']
  },
  {
    title: 'D7. `collection_backfill` 不在可撤销白名单里（补建完 Ctrl+Z 没反应）',
    file: 'src/main/db/repos/journal.ts',
    from: "  const OPS = ['move', 'copy', 'extract', 'mkdir', 'rename', 'trash', 'register', 'reparent', 'reanalyze', 'collection_backfill']",
    to: "  const OPS = ['move', 'copy', 'extract', 'mkdir', 'rename', 'trash', 'register', 'reparent', 'reanalyze']",
    expect: ['Ctrl+Z 找得到这次补建（op 必须在可撤销白名单里）']
  },
  {
    title: 'D8. 撤销时按全表删集合，不看 journal 里那份 id 清单',
    file: 'src/main/library/undo.ts',
    from: '      const ids = journalPayload(row).collectionIds ?? []',
    to: "      const ids = (db.prepare('SELECT id FROM collection').all() as Array<{ id: string }>).map((r) => r.id)",
    expect: ['只删本次新建的那几个，用户自己建的集合留着']
  },
  {
    title: 'D9. 撤销把挂了素材的集合也删了（反噬用户建完之后的动作）',
    file: 'src/main/library/undo.ts',
    from: '        if (Number(linked.n) > 0) {',
    to: '        if (false) {',
    expect: ['已经挂了素材的集合不删（那是用户建完之后的动作，不能被他自己的后续操作反噬）']
  },
  // ---------------------------------------------------------------- M6 ⑤ 横幅
  {
    title: 'E1. 静默名单清空（每 5 分钟弹一次"我没切"就是骚扰）',
    file: 'src/shared/bannerState.ts',
    from: "const SILENT_REASONS = new Set(['cooldown', 'never'])",
    to: 'const SILENT_REASONS = new Set<string>([])',
    expect: ['cooldown / never 这两种 skip 不打扰用户（每 5 分钟弹一次"我没切"就是骚扰）']
  },
  {
    title: 'E2. 「这次忽略」不生效（§4.3「关闭横幅，本次不再提示」）',
    file: 'src/shared/bannerState.ts',
    from: '  if (input.ignoredProjects.includes(e.projectId)) return { shown: false }',
    to: '  if (false) return { shown: false }',
    expect: ['被"这次忽略"过的工程不再出现（§4.3「关闭横幅，本次不再提示」）']
  },
  {
    title: 'E3. 少了「仍在搜索「…」」那句（列表突然变空，用户以为搜索词被吃了）',
    file: 'src/shared/bannerState.ts',
    from: "  const queryNote = keepQuery ? { key: 'project.bannerStillSearching', params: { q: keepQuery } } : null",
    to: '  const queryNote = null',
    expect: ['搜索框非空 → 横幅多一句「仍在搜索「…」」']
  },
  {
    title: 'E4. busy 分支去掉（命中了但没打断 = 什么都不显示）',
    file: 'src/shared/bannerState.ts',
    from: "  if (e.reason === 'busy') {",
    to: '  if (false) {',
    expect: ['busy（用户正忙，命中了但没打断）→ 给一个"现在切过去"，不闷声不响']
  },
  {
    title: 'E5. 平手文案里不写候选名单（Q1 要的留痕变成"就是没切"）',
    file: 'src/shared/bannerState.ts',
    from: "      titleParams: { project: e.projectName, count: e.candidates.length, names: e.candidates.join('、') },",
    to: "      titleParams: { project: e.projectName, count: 0, names: '' },",
    expect: ['ambiguous → warn + 把候选名单写进文案参数']
  },
  {
    title: 'E6. 自动淡出时长改成 0（规格：10 秒后淡出）',
    file: 'src/shared/bannerState.ts',
    from: 'export const BANNER_AUTO_HIDE_MS = 10_000',
    to: 'export const BANNER_AUTO_HIDE_MS = 0',
    expect: ['淡出时长就是规格那个 10 秒（布尔用例挡不住改数字）']
  },
  {
    title: 'E7. Q3 那条提示不看"有没有遇到过 Unity 启动"（凭空冒出来问一次）',
    file: 'src/shared/bannerState.ts',
    from: '  return !input.autoLaunch && !input.alreadyAsked && input.sawUnityStart',
    to: '  return !input.autoLaunch && !input.alreadyAsked',
    expect: ['三个前提缺一个都不问（尤其：从没遇到过 Unity 启动时不该凭空冒出来）']
  },
  // ---------------------------------------------------------------- M6 ⑤⑥ 接线
  {
    title: 'F1. 切视图顺手清空搜索框（R-52）',
    file: 'src/renderer/stores/ui.ts',
    from: '      set({ nav, selection: [], detail: null, detailId: null })',
    to: "      set({ nav, search: '', selection: [], detail: null, detailId: null })",
    expect: ['R-52：搜索框里的字一个字都不许被清掉']
  },
  {
    title: 'F2. 边沿不看方向（工程"关闭"也去跑一遍自动切换）',
    file: 'src/main/project/api.ts',
    from: '        if (!c.running) continue',
    to: '        // 回退：不看方向',
    expect: ['工程发现真的在"未运行→运行中"的边沿上调用了 onProjectStarted']
  },
  {
    title: 'F3. `autoSwitchBehavior` 又变回死设置（写死一档）',
    file: 'src/main/project/api.ts',
    from: '    behavior: () => getSettings().autoSwitchBehavior,',
    to: "    behavior: () => 'when_matched',",
    expect: ['autoSwitchBehavior 真的被读（这个设置从 M1 起就是个死字段）']
  },
  {
    title: 'F4. 广播通道名跟 preload 白名单不一致（运行时直接抛）',
    file: 'src/main/project/api.ts',
    from: "      registrar.broadcast('unity:auto-switch', event)",
    to: "      registrar.broadcast('unity:auto-switch-x', event)",
    expect: ['广播用的通道名在 preload 白名单里（不在的话运行时直接抛"通道不在白名单"）']
  },
  {
    title: 'F5. 忘记传 wake（检测到 Unity 启动但托盘里的 A 不动）',
    file: 'src/main/index.ts',
    from: '      wake: wakeForProject',
    to: '      // 回退：忘了传 wake',
    expect: ['主进程只在"要切/要弹"时才去碰窗口焦点，而且 wake 是注入的（不能静态 import window.ts）']
  },
  {
    title: 'F6. 取消置顶不在 finally 里（A 永远压在 Unity 上面）',
    file: 'src/main/window.ts',
    from: '      if (!win.isDestroyed()) win.setAlwaysOnTop(false)',
    to: '      /* 回退：不关置顶 */',
    expect: ['主进程只在"要切/要弹"时才去碰窗口焦点，而且 wake 是注入的（不能静态 import window.ts）']
  },
  {
    title: 'F7. 桥接管理器启动时抓死引用（重建之后拿的是旧的）',
    file: 'src/main/index.ts',
    from: 'bridgeForFingerprint: () => bridge',
    to: 'bridgeForFingerprint: bridge',
    expect: ['启动时把桥接管理器传给了指纹采集（lazy，不是启动时抓引用）']
  },
  {
    title: 'F8. 界面不订阅 unity:auto-switch（整套逻辑永远跑不到界面）',
    file: 'src/renderer/stores/ui.ts',
    from: "    window.a.on('unity:auto-switch'",
    to: "    window.a.on('unity:auto-switch-off'",
    expect: ['bindEvents 订阅了 unity:auto-switch（不订阅的话这套逻辑永远跑不到界面）']
  },
  // ---------------------------------------------------------------- V6 迁移
  {
    title: 'G1. 忘了 bump SCHEMA_VERSION（下次启动会二次执行 V6，库打不开）',
    file: 'src/main/db/schema.ts',
    from: 'export const SCHEMA_VERSION = 6',
    to: 'export const SCHEMA_VERSION = 5',
    expect: [
      '迁移跑完 user_version 落在 SCHEMA_VERSION，且这一版就是 V6',
      'SCHEMA_VERSION == 最后一篇迁移的版本号（忘了 bump 的后果是下次启动二次执行、库直接打不开）'
    ]
  },
  {
    title: 'G2. V6 那条 SQL 内容被掏空（版本号涨了但没加列）',
    file: 'src/main/db/schema.ts',
    from: 'ALTER TABLE project ADD COLUMN last_auto_switch_at INTEGER;',
    to: '-- 回退：这一版什么都不加',
    expect: ['project 多了 last_auto_switch_at，且老行的其它列一个都没变']
  }
]

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function write(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8')
}

/** 一条用例可能要同时改两个文件（A1：把 fold 改回私有必然连带改 import） */
function patchesOf(c) {
  return c.patches ?? [{ file: c.file, from: c.from, to: c.to }]
}

/** 跑一遍用例，返回失败的 fullName 集合 */
function runSpec() {
  let out = ''
  let code = 0
  try {
    fs.rmSync(REPORT, { force: true })
  } catch {
    /* 还没有这个文件 */
  }
  try {
    out = execFileSync(process.execPath, [VITEST_ENTRY, 'run', ...SPECS, '--reporter=json', `--outputFile=${REPORT}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (e) {
    out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    code = Number((e && e.status) ?? 1)
  }
  let report
  try {
    report = JSON.parse(fs.readFileSync(REPORT, 'utf8'))
  } catch (e) {
    throw new Error(`读不到 vitest 的 JSON 报告（${e.message}）。验证器不能带着空结果往下走。\n退出码 ${code}\n输出：\n${out.slice(-1500)}`)
  }
  const failed = new Set()
  for (const f of report.testResults || []) {
    for (const a of f.assertionResults || []) {
      if (a.status === 'failed') failed.add(String(a.fullName || a.title || ''))
    }
  }
  const total = (report.testResults || []).reduce((n, f) => n + (f.assertionResults || []).length, 0)
  if (!total) throw new Error(`vitest 报告里一条用例都没有（退出码 ${code}）：\n${out.slice(-1500)}`)
  return { failed, total, code }
}

const only = process.argv[2] ? Number(process.argv[2]) : null
const results = []
/** 还原用的原始内容：任何一条抛错都要在 finally 里全部写回去 */
const dirty = []
let baseline = null
try {
  const base = runSpec()
  if (base.failed.size) {
    console.error(`⚠ 动手之前就有 ${base.failed.size} 条是红的：\n  ${[...base.failed].join('\n  ')}`)
    console.error('  先把它们修绿再跑本工具 —— 否则"红了"这件事没有任何信息量。')
    process.exit(3)
  }
  console.log(`基线：${base.total} 条全绿`)
  baseline = base

  for (let i = 0; i < CASES.length; i++) {
    if (only && only !== i + 1) continue
    const c = CASES[i]
    const saved = []
    for (const p of patchesOf(c)) {
      const src = read(p.file)
      const hits = src.split(p.from).length - 1
      const want = p.count ?? c.count ?? 1
      if (hits !== want) {
        for (const s of saved) write(s.file, s.text)
        throw new Error(`${c.title}\n  锚文本在 ${p.file} 里出现 ${hits} 次（要恰好 ${want} 次），拒绝替换`)
      }
      saved.push({ file: p.file, text: src })
      /** 全量替换：一处撤一处留，测出来的就是"撤了也不红"的假绿 */
      write(p.file, src.split(p.from).join(p.to))
    }
    dirty.push(...saved)
    const { failed, total } = runSpec()
    const missed = c.expect.filter((t) => ![...failed].some((f) => f.includes(t)))
    results.push({ title: c.title, red: failed.size, total, missed })
    for (const s of saved) write(s.file, s.text)
    dirty.length = 0
    console.log(`  · ${c.title} → 红了 ${failed.size}/${total}`)
  }
} finally {
  for (const s of dirty) {
    try {
      write(s.file, s.text)
    } catch (e) {
      console.error(`还原 ${s.file} 失败：${e.message}`)
    }
  }
}

console.log('\n=== 回退验证结果（期望：每处修复被撤掉都有用例变红）===')
let allOk = results.length > 0 && baseline !== null
for (const r of results) {
  const ok = r.missed.length === 0 && r.red > 0
  if (!ok) allOk = false
  console.log(`${ok ? '✅' : '❌'} ${r.title} → 红 ${r.red} / ${r.total}`)
  for (const m of r.missed) console.log(`     ⚠ 撤掉修复它也不红，等于没覆盖：${m}`)
}
if (!results.length) console.log('（一条都没跑，检查传进去的编号）')
console.log(allOk ? `\n全部钉住了：${results.length} 处修复，每处被撤掉都会有用例变红。` : '\n有漏网，先别提交。')
process.exit(allOk ? 0 : 1)
