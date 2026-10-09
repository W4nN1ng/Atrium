/**
 * **R4 的回退验证器**：把 R4 ①–⑦ 每处修复临时改回旧写法，跑一遍用例，确认它**真的会红**，然后无条件还原。
 *
 * 为什么不复用 `verify-red-m6.cjs`：钉的东西完全不同 —— M6 钉"匹配口径 + 副作用时机 + 留痕"，
 * R4 钉的是**队列状态机 / 单位口径 / 判据只写一处 / 边沿与队列**。两张 CASES 表塞一起，
 * 两边都没法单独跑（本工具一次要跑二十几轮 vitest）。
 *
 * 这一轮最值得钉的三类（都是这一轮实际犯过或抓到的）：
 *  1. **"只差最后一米"的那几件**：反查、进度事件、dims、`bridgeAutoInstall` —— 后端早就通了，
 *     很容易在汇报里被写成已完成。所以每条都要求"撤掉最后一米"必须有用例红。
 *  2. **串行队列的三种语义**（未执行 / 失败 / 取消）—— 糊成两种就是"说它失败了"这种撒谎。
 *  3. **⑦ 的两个边沿与队列**：只挂"第一次发现"的话，「以后都自动安装」这个答案永远不会被执行；
 *     队列写成"取走即清"的话，一次整页刷新就把没答的问题吞掉（这两条都在活体里真撞见过）。
 *
 * 用法：
 *   node tools/verify-red-r4.cjs          # 全部跑一遍
 *   node tools/verify-red-r4.cjs 7        # 只跑第 7 条
 *
 * ⚠ 它会真的改源文件（跑完立刻还原），跑之前保证工作区干净、A 没在跑。
 * ⚠ **别和别的重活并行跑**（M5-B 实测：并发会让那一轮 vitest 起不来 → 红 0 条 → 假报"漏网"）。
 * ⚠ 锚文本一律**单行**：源文件是 CRLF，多行锚会因为 \\r 对不上而 0 命中（工具会当场拒绝，不会瞎改）。
 * ⚠ 每条 patch 用"锚文本恰好出现 1 次"定位；不唯一就失败。
 * ⚠ 跑之前先 `npm run native:node`：better-sqlite3 是双 ABI 的，Electron 跑过之后
 *   直接起 vitest 会整文件报 NODE_MODULE_VERSION 不匹配。
 *
 * ## 第一次跑抓到 10 条"撤掉修复也不红"，分五类（这一节是本工具的存在理由）
 *
 *  1. **变异打错调用点**（C1 / D1 / E4）—— 同一件事在两个地方各写一遍，我撤了没人查的那一遍：
 *     `assets.ts` 里 `reindexAsset` 有四处，用例扫的是 `assets:reclassify` 那一段，我却撤了
 *     `assets:patch`；fuzzy 那道闸真正生效的是 `fuzzyFor()`，不是 MiniSearch 的 options 字面量；
 *     大小写去重有两处（入库 `engine.ts` / 重建变体 `regroup.ts`），各钉各的才算数。
 *  2. **两道闸返回同一句文案**（B3）—— 只撤一道，另一道会返回一句同样能匹配断言的错误。
 *     必须两道一起撤才看得见那个事故形状。顺带记一句：那句原子 `UPDATE` 抢权的价值在
 *     **跨窗口 / 跨进程**竞态，单测结构上测不到，它的凭据是 `tools/live-s8-double-rollback.cjs`。
 *  3. **用例只查词典和源码，不查判据本身**（I2）—— 把 `installedWhereState` 的 `noteKeys` 清空
 *     全仓不红，等于"判据不再给口径、屏幕上什么都不说而测试全绿"。补了 `noteKeys 不许为空`；
 *     I3 另钉"组件不再渲染 noteKeys"（原来那条只扫源码，`false && where.noteKeys` 能骗过它，
 *     所以变异要把引用整个拿掉）。
 *  4. **不变量根本没人查**（A3）—— "任何时刻最多一条 running"这条只在别的用例里被顺带经过，
 *     撤掉 `promoteNext` 的守卫一条都不红。补了直接钉它的那条。
 *  5. **那个"变异"不是回归**（G8）—— `parseBridgeAskAnswer` 故意容错大小写，所以把存进去的值
 *     大写化照样读得回来。换成真正的旧写法（不走 `JSON.stringify`、裸串进 `value_json`）才红：
 *     那一列是 JSON 文本，`JSON.parse('always')` 抛 → 读回来变成"没答过"。M5-B 在同一列栽过。
 *
 * 曾经还剩**一个已知洞**：C3（`rearchive` 里"附属在不在旧父目录里"那支）撤掉不红、用例查不到。
 * **第 3 轮补上了**（现在是 C3 / C3b / C3c 三条）。补法不是改用例的断言，是改**夹具**：
 * 原来那个"散着的子项"只喂了 `library_path`，另外两列是 NULL，那个循环体根本没进过。
 * 教训记一句：断言"这支代码有覆盖"之前，先看夹具把哪几列喂进去了。
 *
 * ## 这个工具自己也红过一次（记下来，别让下一个人再撞）
 *
 * 第一版全量跑完报"33 处全部钉住"，但 `git status` 里 `src/main/import/coordinator.ts` 是脏的：
 * B3 一条用例改同一个文件**两次**，`saved` 里第二项存的是"已经改过一遍"的文本，
 * 还原时按顺序写回去，最后落盘的就是那份 —— 源码里留着一个 `if (false)`，
 * 而退出码是 0。**"工具说通过了"和"工作区干净"是两件事**，跑完必须 `git status` 看一眼。
 * 现在 `saved` 按文件去重，只留最早读到的原文。
 *
 * ⚠ **J4 那条会在 `resources/lexicon/` 里留下一份 `categories.user.json`**（变异就是把增量落点
 * 改回安装目录，测试的临时目录清理管不到它）。那是变异造的垃圾，`git status` 看见就删掉 ——
 * 别当成"仓库里本来有这个文件"。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SPECS = [
  'tests/classify/classify.spec.ts',
  'tests/shared/import-queue.spec.ts',
  'tests/renderer/batch-import-store.spec.ts',
  'tests/shared/member-pick.spec.ts',
  'tests/shared/import-notes.spec.ts',
  'tests/import/rollback-claim.spec.ts',
  'tests/import/member-import.spec.ts',
  'tests/shared/rearchive-dialog.spec.ts',
  'tests/library/rearchive.spec.ts',
  'tests/renderer/rearchive-store.spec.ts',
  'tests/search/synonyms.spec.ts',
  'tests/shared/synonym-edit.spec.ts',
  'tests/shared/variant-dims.spec.ts',
  'tests/library/regroup.spec.ts',
  'tests/db/installed-where.spec.ts',
  'tests/shared/installed-where.spec.ts',
  'tests/shared/bridge-ask.spec.ts',
  'tests/db/bridge-ask.spec.ts',
  'tests/project/bridge-ask-wiring.spec.ts',
  'tests/project/wmi-only-grace.spec.ts',
  'tests/services/categories-delta.spec.ts',
  'tests/project/wake-order.spec.ts',
  /**
   * 第 4 轮加进来的一条：`manager.spec.ts` 里那两个 busy 用例是 K1 的落点。
   * ⚠ 它自己就要跑 ~10 秒（busy 退避是真的在等 1s/2s），全量跑一轮会慢一档 ——
   *   换来的是一条**定死不许改**的序列第一步有人钉，值。
   */
  'tests/bridge/manager.spec.ts'
]
const VITEST_ENTRY = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const REPORT = path.join(os.tmpdir(), 'avca-verify-red-r4.json')

/** @type {Array<{title:string, file?:string, from?:string, to?:string, patches?:Array<{file:string,from:string,to:string}>, count?:number, expect:string[]}>} */
const CASES = [
  // ---------------------------------------------------------------- ① 进度与队列
  {
    title: 'A1. 「只有成功才把下一条顶上来」改成无条件顶（界面会在没发出去的包上显示"进行中"）',
    file: 'src/shared/importQueue.ts',
    from: '  const advanced = statusOf(ev.status) === \'ok\' ? promoteNext(items) : items',
    to: '  const advanced = promoteNext(items)',
    expect: ['第三条挂了 → 停手，剩下的一律 not-run']
  },
  {
    title: 'A2. 把 skipped/blocked 的「没跑」语义并进失败（§7-R2 那条"未执行 ≠ 失败"就没了）',
    file: 'src/shared/importQueue.ts',
    from: "  if (s === 'skipped' || s === 'blocked') return 'not-run'",
    to: "  if (false) return 'not-run'",
    expect: ['blocked / skipped 都算"没跑"，cancelled 单独一种']
  },
  {
    title: 'A3. 撤掉「已有 running 就不再提」的闸门（两条同时进行中，串行显示串行）',
    file: 'src/shared/importQueue.ts',
    from: "  if (items.some((i) => i.status === 'running')) return items",
    to: '  if (false) return items',
    expect: ['已经有 running 的时候再点一次开始，不许冒出第二条 running']
  },
  // ---------------------------------------------------------------- ② 多选卡批量
  {
    title: 'B1. 一个成员的容器也被判成"要先选成员"（其实没有"选哪个"这回事）',
    file: 'src/shared/memberPick.ts',
    from: '  if (needExtract.length && packages.length > 1) return { kind: \'needs-choice\', indexes: [] }',
    to: '  if (needExtract.length) return { kind: \'needs-choice\', indexes: [] }',
    expect: ['只有一个成员的容器也算"可直导"']
  },
  {
    title: 'B2. 一张卡都没有时说"失败"而不是"没有可导入的包"',
    file: 'src/shared/memberPick.ts',
    from: "  if (!packages.length) return { kind: 'empty', indexes: [] }",
    to: "  if (!packages.length) return { kind: 'single', indexes: [0] }",
    expect: ['一张卡都没有 → empty']
  },
  {
    /**
     * ⚠ 第一版这条钉错了对象：撤掉 `UPDATE … WHERE status='ok'` 那句**一条都不红**。
     * 因为 `rollbackImport` 开头还有一道"这行不是 ok 就直接拒"的状态闸，
     * 单测里两次调用是顺序发的，第二次必然先被状态闸拦下，走不到抢权那句 ——
     * 那句原子 UPDATE 是给**跨窗口 / 跨进程**竞态兜底的，单测结构上测不到，
     * 真机凭据是 `tools/live-s8-double-rollback.cjs` 那一轮（连点两次只撤一次）。
     * 所以这里改成钉真正被用例覆盖的那道状态闸。
     */
    title: 'B3. 二次撤销的**两道闸一起撤**（连点两次会走第二遍删除，写出"删除 0 个"那种二次账）',
    /**
     * ⚠ 第一版只撤原子 `UPDATE … WHERE status='ok'` 那一句，**一条都不红**。
     * 因为这里其实有两道闸：开头一句"这行不是 ok 就直接拒" + 那句抢权 UPDATE。
     * 单测里两次撤销是顺序发的，第二次先被状态闸拦下；而两道闸返回的错误文案
     * 都能匹配上断言里那个正则 —— **只撤一道测不出来，两道一起撤才是事故形状**。
     * 顺带记一句：那句原子 UPDATE 真正的价值在跨窗口 / 跨进程竞态（两个 A 一起点），
     * 单测结构上测不到，它的凭据是 `tools/live-s8-double-rollback.cjs` 那一轮真机复测。
     */
    patches: [
      { file: 'src/main/import/coordinator.ts', from: "  if (logRow.status !== 'ok') {", to: '  if (false) {' },
      {
        file: 'src/main/import/coordinator.ts',
        from: `UPDATE import_log SET status = 'running' WHERE id = ? AND status = 'ok'`,
        to: `UPDATE import_log SET status = 'running' WHERE id = ?`
      }
    ],
    expect: ['撤完再点一次：状态已经不是 ok，直接拒']
  },
  {
    title: 'B4. 主进程自己另写一个批量上限（Q2 明令禁止：两边各写一个数必漂）',
    file: 'src/main/import/memberImport.ts',
    from: 'export const IMPORT_BATCH_MAX = SHARED_BATCH_MAX',
    to: 'export const IMPORT_BATCH_MAX = 5',
    expect: ['跨卡合起来超过 8 条 → 整批不开始，抽取根一个字节都没写']
  },
  // ---------------------------------------------------------------- ③ 改分类搬文件
  {
    title: 'C1. 改完分类不重建索引（docs/SEARCH.md 曾经声称会，其实不会）',
    /**
     * ⚠ 第一版撤错了调用点：`assets.ts` 里 `reindexAsset` 有四处，
     * 我撤的是 `assets:patch` 那一处，而用例扫的是 `assets:reclassify` 那一段 —— 红不了。
     */
    file: 'src/main/ipc/assets.ts',
    from: '    reindexAsset(db, id)',
    to: '    /** 撤掉：改完分类不重建索引 */',
    expect: ['handler 里真的有 reindexAsset']
  },
  {
    title: 'C2. `undoLast` 不分批次类型，把 rearchive 的素材记录一起删掉',
    file: 'src/main/library/undo.ts',
    from: "  const inPlace = rows.some((r) => r.op === 'rearchive')",
    to: '  const inPlace = false',
    expect: ['Ctrl+Z 一次做完两半：文件回原位、库里路径回原值，而且素材记录还在']
  },
  /**
   * 这一支第 1 轮跑的时候是个**已知洞**：撤掉判断全仓不红，只能留一段注释当占位。
   * 第 3 轮补了夹具才钉上 —— 根因不是"用例写错了"，是**夹具里那个子项只有 `library_path`**，
   * `source_path` / `cover_image` 两列是空的，循环体一次都没执行过。
   * 记着这条教训：断言"某支代码被覆盖"之前，先看夹具喂进去的字段有没有那一列。
   */
  {
    title: 'C3. 散着的子项：不再检查"这列在不在它自己目录里"，库外路径也被改写（改了就是撒谎）',
    file: 'src/main/library/rearchive.ts',
    from: 'if (o && isInside(o, kOld)) rewrites.push',
    to: 'if (o) rewrites.push',
    expect: ['散着的子项：它自己目录里的列跟着挪，指向库外的列一个字不改']
  },
  {
    title: 'C3b. 盘上已经不存在的子项目录也记一条 move（apply 时 ENOENT，整次改分类判失败）',
    file: 'src/main/library/rearchive.ts',
    from: '      if (kst.files) {',
    to: '      if (true) {',
    expect: ['散着的子项：它自己目录里的列跟着挪，指向库外的列一个字不改']
  },
  {
    title: 'C3c. 「子项不在父目录里 → 单独成一条 move」整支撤掉（库指新位置、盘还在老地方）',
    file: 'src/main/library/rearchive.ts',
    from: 'if (kOld && !isInside(kOld, current) && !same(kOld, current))',
    to: 'if (false)',
    expect: ['子项的目录不在父目录里面 → 单独一条 move', '散着的子项真的跟着搬进新父目录里面']
  },
  {
    title: 'D1. fuzzy 兜底趟不再限定 ASCII（「冰箱」→ xiang → xing → 捞出发型卡）',
    file: 'src/main/search/index.ts',
    /** ⚠ 第一版钉错了地方：改的是 MiniSearch 的 options 字面量，而真正生效的是 `fuzzyFor()` */
    from: '  return /^[\\x20-\\x7e]+$/.test(token) && token.length >= 5 ? 0.2 : false',
    to: '  return token.length >= 5 ? 0.2 : false',
    expect: ['容错闸门本身：只给"整串 ASCII 且 ≥5 个字符"的词开']
  },
  {
    title: 'D2. 查询侧展开整个短路（口语白加：搜「衣服」再也命不中「服装」那张卡）',
    file: 'src/shared/categoryExpand.ts',
    from: '  for (const form of searchForms(query).all) {',
    to: '  for (const form of []) {',
    expect: ['一级口语映射到一级标签三语', '搜假名口语「ウェア」也命中']
  },
  {
    title: 'D3. 单字口语放行（存进去也不会进索引 = 白加，界面上却像加了）',
    file: 'src/shared/synonymEdit.ts',
    from: 'export const MIN_SYNONYM_LEN = 2',
    to: 'export const MIN_SYNONYM_LEN = 1',
    expect: ['单字词 → 当场拒绝，并且带上下限参数']
  },
  // ---------------------------------------------------------------- ⑤ 变体分列
  {
    title: 'E1. 只有一条值的维度也列出来（那一维上大家一样，写出来是噪音）',
    file: 'src/shared/variantDims.ts',
    from: '  const keep = sortDims(dims).filter((d) => d.values.length >= 2)',
    to: '  const keep = sortDims(dims)',
    expect: ['① 只有一条值的维度不显示']
  },
  {
    title: 'E2. 容器卡上的 version 再数一遍（角上"N 个模型变体"已经数过了）',
    file: 'src/shared/variantDims.ts',
    from: "  const shown = keep.filter((d) => !(opts.isBundle && d.kind === 'version' && (opts.unitCount ?? 0) > 1))",
    to: '  const shown = keep',
    expect: ['② 容器卡上的 version 在徽章数过之后不再数一遍']
  },
  {
    title: 'E3. 维度芯片不设上限（>3 那一维要显式说 +N，不许悄悄截断）',
    file: 'src/shared/variantDims.ts',
    from: 'const MAX_CHIPS = 3',
    to: 'const MAX_CHIPS = 99',
    expect: ['③ 超过 3 个维度要显式说 +N，不许悄悄截断']
  },
  {
    /**
     * ⚠ 第一版把两处搞混了：`大小写双胞胎…拆完组仍然写出 1 条 avatar 变体` 那条钉的是
     * **重新归并**这一侧（`regroup.ts` 读旧标签时的去重），撤 `engine.ts` 的 `pushAvatar`
     * 它照样绿 —— 去重一共两处（入库时 / 重建变体时），必须各钉各的。
     */
    title: 'E4a. 重新归并时不去重大小写（`length === 1` 那道闸门又过不去，avatar 变体补不回来）',
    file: 'src/main/library/regroup.ts',
    from: '              const k = t.value.toLowerCase()',
    to: '              const k = t.value',
    expect: ['大小写双胞胎标签算同一个模型：拆完组仍然写出 1 条 avatar 变体']
  },
  {
    title: 'E4b. 入库时的模型名去重改回大小写敏感（`SHINANO` + `Shinano` 算两个）',
    file: 'src/main/classify/engine.ts',
    from: '  if (list.some((x) => x.toLowerCase() === name.toLowerCase())) return',
    to: '  if (list.some((x) => x === name)) return',
    expect: ['散装目录 Grimoir_SHINANO_V1.0 → targetAvatars 只有一条']
  },
  // ---------------------------------------------------------------- ⑥ 跨工程反查
  {
    title: 'F1. 反查只查代表行（同组兄弟行导过的，会被报成"没装过"）',
    file: 'src/main/db/repos/unity.ts',
    from: '               OR (:g IS NOT NULL AND il.asset_id IN (SELECT id FROM asset WHERE group_id = :g)))',
    to: '               OR (1 = 0))',
    expect: ['同组兄弟行导过 = 这张卡装过']
  },
  {
    title: 'F2. 工程被从清单里删掉后显示成一个空名字的行',
    file: 'src/main/db/repos/unity.ts',
    from: '    known: r.name !== null',
    to: '    known: true',
    expect: ['工程记录被删了（VCC 里移掉）→ known=false，不许显示成空名字']
  },
  {
    title: 'F3. "导过又被退回"的工程被 HAVING 掉（发生过的事被抹掉了）',
    file: 'src/main/db/repos/unity.ts',
    from: '        HAVING packages > 0 OR rolledBack > 0',
    to: '        HAVING packages > 0',
    expect: ['只有"导过又被 A 退回"的工程也要列出来']
  },
  // ---------------------------------------------------------------- ⑦ 首次发现工程弹桥接安装窗
  {
    title: 'G1. 已经装了桥接也照问（重复复制会把用户自己改过的桥接覆盖回去）',
    file: 'src/shared/bridgeAsk.ts',
    from: '  if (i.installed) return \'quiet\'',
    to: "  if (false) return 'quiet'",
    expect: ['⭐ 已经装了桥接 → 无论如何都 quiet']
  },
  {
    title: 'G2. `bridgeAutoInstall` 又不读了（它从 M1 起就是死设置，R4 ⑦ 才接活）',
    file: 'src/shared/bridgeAsk.ts',
    from: "  const wantsAuto = i.answer === 'always' || i.autoInstallSetting",
    to: "  const wantsAuto = i.answer === 'always'",
    expect: ['⭐ 全局 `bridgeAutoInstall` 打开 → auto', '⭐ `bridgeAutoInstall` 开着 → 不问了，decision=auto']
  },
  {
    title: 'G3. 问不看边沿（三路探测每 3 秒一轮，会问到用户关软件）',
    file: 'src/shared/bridgeAsk.ts',
    from: "  return i.firstSighting ? 'ask' : 'quiet'",
    to: "  return 'ask'",
    expect: ['⭐ 不在任何边沿上 → quiet']
  },
  {
    title: 'G4. 自动装只挂"第一次发现"（答完「以后都自动安装」之后那个答案永远不会被执行）',
    file: 'src/shared/bridgeAsk.ts',
    from: "    return i.firstSighting || i.running ? 'auto' : 'quiet'",
    to: "    return i.firstSighting ? 'auto' : 'quiet'",
    expect: ['⭐ 「开始运行」这个边沿只自动装、**不弹窗**']
  },
  {
    title: 'G5. 主进程运行边沿那一路没接上（判据对了，链路上没人调）',
    file: 'src/main/project/api.ts',
    from: 'maybeAskAboutBridge({ id: row.id, path: row.path, name: row.name }, { firstSighting: false, running: true })',
    to: 'maybeAskAboutBridge({ id: row.id, path: row.path, name: row.name }, { firstSighting: false, running: false })',
    expect: ['⭐ 答过「以后都自动安装」→ 它开始运行时真的执行', '两个边沿都接上了：第一次发现 + 开始运行']
  },
  {
    title: 'G6. 待答队列退回"取走即清"（整页刷新一次，没答的工程就永远不问了）',
    file: 'src/main/bridge/askQueue.ts',
    from: '  return Array.from(pending.values())',
    to: '  const out = Array.from(pending.values()); pending.clear(); return out',
    expect: ['⭐ 同一条还要**攒进队列**：广播是发后即忘的，主进程第一轮发现时窗口还没建']
  },
  {
    title: 'G7. 不入队、只广播（⑦ 恰恰在全新安装那一次不生效 —— 那时窗口还没建）',
    file: 'src/main/project/api.ts',
    from: '    pushBridgeAsk(event)',
    to: '    void event',
    expect: ['⭐ 同一条还要**攒进队列**：广播是发后即忘的，主进程第一轮发现时窗口还没建']
  },
  {
    /**
     * ⚠ 这一条第一版写的是"把存进去的值 toUpperCase()"，结果**撤掉修复也不红** ——
     * 因为 `parseBridgeAskAnswer` 本来就容错大小写（那条是设计，脏值不该让人重新答一次）。
     * 换成真正的旧写法：不走 `JSON.stringify`，直接把裸字符串塞进 `value_json` ——
     * 那列是 JSON 文本，`JSON.parse('always')` 抛 → 读回来变成"没答过"。
     * （M5-B 就在同一列上栽过一次，"存了但读不出来"最难查。）
     */
    title: 'G8. 答案不走 JSON.stringify（setting 那列是 JSON 文本，裸串读回来变成"没答过"）',
    file: 'src/main/db/repos/bridgeAsk.ts',
    from: 'db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(key, JSON.stringify(answer))',
    to: 'db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(key, String(answer))',
    expect: ['always / never 各存各的，读回来一模一样']
  },
  // ---------------------------------------------------------------- 真机那两条缺陷
  {
    title: 'H1. 只剩 WMI 一路撑着"运行中"也不判停（§8-2 卡住的就是这个形状）',
    file: 'src/main/project/running.ts',
    from: '      } else if (now - since > WMI_ONLY_GRACE_MS) {',
    to: '      } else if (false) {',
    expect: ['超过宽限期还不认第二路证据 → 判未运行']
  },
  {
    title: 'H2. 宽限期常量被改大（逻辑用例都按常量写，常量本身必须单独钉）',
    file: 'src/shared/constants.ts',
    from: 'export const WMI_ONLY_GRACE_MS = 15_000',
    to: 'export const WMI_ONLY_GRACE_MS = 3_600_000',
    expect: ['常量本身要钉住']
  },
  {
    title: 'I1. "已备份"不看真存下几个（批量退回那轮实测：备份 0 个而横幅写"已备份"）',
    file: 'src/shared/importNotes.ts',
    from: '  const n = typeof last.backupSaved === \'number\' ? last.backupSaved : -1',
    to: '  const n = -1',
    expect: ['真存下了 N 个 → 说"已备份 N 个"，不许只说"已备份"']
  },
  {
    /**
     * 这条原本是漏网的：只把判据这边的 noteKeys 清空，**一条都不红** ——
     * 因为那两条用例一条只看词典里有没有这句话、一条只扫 DetailPanel 的源码。
     * 于是补了 `noteKeys 不许为空` 那条（见 tests/shared/installed-where.spec.ts），
     * 现在撤掉判据这边的口径真的会红。这正是本工具存在的理由。
     */
    title: 'I2. 判据这边不再给那句限制口径（屏幕上就什么都不说了）',
    file: 'src/shared/installedWhere.ts',
    from: "  const noteKeys: Array<{ key: string; params?: Record<string, string | number> }> = [{ key: 'installed.noteLogOnly' }]",
    to: '  const noteKeys: Array<{ key: string; params?: Record<string, string | number> }> = []',
    expect: ['判据这边**永远**要给出口径那一句（noteKeys 不许为空，两种入参都要给）']
  },
  {
    title: 'I3. 详情面板不再渲染 noteKeys（只列行、不说限制 —— "看起来像完整答案"那个错法）',
    file: 'src/renderer/components/DetailPanel.tsx',
    from: '          {where.noteKeys.map((n) => (',
    to: '          {([] as Array<{ key: string; params?: Record<string, string | number> }>).map((n) => (',
    expect: ['详情面板真的把口径渲染出来了']
  },
  // ---------------------------------------------------------------- 第 3 轮 ① 分类口语增量
  {
    title: 'J1. 保存时又把整份表写回内置表（第 2 轮实测到的那个"升级即丢"）',
    file: 'src/main/services/categories.ts',
    from: '  writeDelta(diffSynonyms(base, next))',
    to: "  fs.writeFileSync(builtinOverride ?? lexiconFile('categories.json'), JSON.stringify(next, null, 2), 'utf8')",
    expect: ['保存之后内置表一个字节都没变', '用户的改动落在运行时目录的 categories.user.json']
  },
  {
    title: 'J2. 读的时候不叠用户增量（加了口语搜不到，界面上却显示着）',
    file: 'src/main/services/categories.ts',
    from: '  mergedCache = applyDelta(base, readDelta())',
    to: '  mergedCache = applyDelta(base, {})',
    expect: ['加词生效、删内置词也生效，两份都能看见', '升级模拟：内置表以后新增了口语，用户的加减照样在']
  },
  {
    title: 'J3. 结构漂移那道闸关掉（改了标签/加了二级分类 → 保存"成功"然后什么都没发生）',
    file: 'src/main/services/categories.ts',
    from: '  const drift = structuralDrift(base, next)',
    to: '  const drift: string | null = null',
    expect: ['改标签要报错（界面上只允许改口语）', '加一个二级分类要报错，而不是保存成功然后什么都没发生']
  },
  {
    title: 'J4. 增量文件又落回安装目录（打包版 = resources\\lexicon，下次升级重写没）',
    file: 'src/main/services/paths.ts',
    from: "  categoriesUser: () => path.join(root(), 'categories.user.json'),",
    to: "  categoriesUser: () => lexiconFile('categories.user.json'),",
    expect: ['用户的改动落在运行时目录的 categories.user.json']
  },
  // ---------------------------------------------------------------- 第 4 轮 · busy 退避序列
  {
    /**
     * 第 4 轮沙盒活体抓到的：界面上写「第 1 次重试 · 2 秒后再试」—— 序列里那档 1000ms
     * 从来没被取到过（`retries` 在取下标之前就自增了）。
     * 老的断言只有 `nextDelayMs > 0` 和一条"≥ 1000+2000-150"，7 秒也照样绿，
     * 注释还写着"退避 1s + 2s"。规格 §2.5 说这条序列**定死不许改**，那就连第一步一起钉。
     */
    title: 'K1. busy 退避的下标差一个（第一次等 2s，序列第 0 项 1000ms 永远取不到）',
    file: 'src/main/bridge/manager.ts',
    from: 'const delay = BUSY_BACKOFF_MS[Math.min(retries - 1, BUSY_BACKOFF_MS.length - 1)]',
    to: 'const delay = BUSY_BACKOFF_MS[Math.min(retries, BUSY_BACKOFF_MS.length - 1)]',
    expect: ['⭐ busy 时通过 onBusy 如实报出"在排队、为什么、第几次"', 'busy 之后排队重试，最终成功，且重投的次数与退避次数一致']
  },
  // ---------------------------------------------------------------- 第 5 轮 · 托盘唤醒的顺序
  {
    /**
     * 第 5 轮活体量出来的：`wakeForProject` 先调 `createMainWindow()`（它在窗口已存在时顺手
     * `show()+focus()`），再读 `isVisible()` 判"是不是藏着的" → 恒为"本来就开着" →
     * **置顶那 1.2 秒一次都没执行过**。窗口能弹出来只是那个副作用的巧合，所以屏幕上看着是好的。
     * 变异就把那次预读换成同一个有副作用的调用 —— 形状和历史那版一模一样。
     */
    title: 'L1. 唤醒的"是不是藏着的"改回在 createMainWindow 之后读（置顶那一段永远不跑）',
    file: 'src/main/window.ts',
    /**
     * ⚠ 两行锚：`const existing = getMainWindow()` 在 window.ts 里有两处（唤醒与最小窗那条路各一处），
     *   单行锚会被工具的"恰好 1 次"闸门拒掉（第一版就是这么撞的）。
     *   这个文件是 **LF**，所以多行锚能对上 —— 但只对 LF 文件这么干：CRLF 文件里换行符是 \r\n，
     *   锚文本里的换行对不上会 0 命中（工具当场拒绝，不会瞎改）。
     */
    from: '  const existing = getMainWindow()\n  const wasHidden = !existing || existing.isDestroyed() || !existing.isVisible() || existing.isMinimized()',
    to: '  const existing = createMainWindow()\n  const wasHidden = !existing || existing.isDestroyed() || !existing.isVisible() || existing.isMinimized()',
    expect: ['⭐ 先读"是不是藏着的"，再调 createMainWindow（它的副作用会把窗口 show 出来）']
  }
]

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function write(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8')
}
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
      /**
       * ⚠ 同一个文件被一条用例改两次时（B3 就是），**只留第一次读到的原文**。
       * 不然 saved 里第二项存的是"已经改过一遍"的内容，还原时按顺序写回去，
       * 最后落盘的就是那一份 —— 跑完工作区里留着一个 `if (false)`，
       * 而工具自己报"全部钉住了"。第一版就这么差点把变异提交进去。
       */
      if (!saved.some((s) => s.file === p.file)) saved.push({ file: p.file, text: src })
      /** 全量替换：一处撤一处留，测出来的就是"撤了也不红"的假绿 */
      write(p.file, src.split(p.from).join(p.to))
    }
    dirty.push(...saved)
    const { failed, total } = runSpec()
    const missed = c.expect.filter((t) => ![...failed].some((f) => f.includes(t)))
    results.push({ title: c.title, red: failed.size, total, missed })
    for (const s of saved) write(s.file, s.text)
    dirty.length = 0
    console.log(`  · ${c.title} → 红了 ${failed.size}/${total}${missed.length ? ' ⚠ 漏网 ' + missed.length : ''}`)
    if (missed.length) for (const f of [...failed].slice(0, 6)) console.log('      红的是：' + f.slice(0, 150))
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
