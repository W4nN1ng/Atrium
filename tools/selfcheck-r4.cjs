/**
 * R4 交付自查（**只读**，不写任何东西）。
 *
 * 和 `selfcheck-m5a/m5b/m6.cjs` 一个套路：把"这一轮声称做了什么、证据在哪"打成一张表，
 * 缺文件就报错。**没有测试的项一律标 (无自动化用例)**，不许混在"有测试"里充数。
 *
 * R4 特别容易虚报的三类，这张表逐条对着打：
 *  1. **"后端早就通了，只差最后一米"** —— 反查 / 进度事件 / dims / `bridgeAutoInstall`
 *     这四件在 R4 之前就是"接口有、没人接"，汇报时很容易写成已完成；
 *  2. **渲染层零 DOM 测试** —— 浮层画法、弹窗画法只能靠活体 + 截图；
 *  3. **沙盒活体的对端是假 Unity** —— 真 Unity 那几条分支（Play 排队、真 zip 成员、>8 多批）
 *     不能算验过，全部列在下面的"真机待验"里。
 *
 * 用法：node tools/selfcheck-r4.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')

/** 数一个测试文件里有几条用例（数不到就返回 -1 = 文件不存在） */
function cases(rel) {
  const p = path.join(REPO, rel)
  if (!fs.existsSync(p)) return -1
  const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return src.split(/\r?\n/).filter((l) => /^\s*(?:it|test)(?:\.\w+)*\(/.test(l)).length
}

const items = [
  // ---------------------------------------------------------------- ① 进度与队列
  ['逐条进度事件真的发出来，渲染层真的订阅（曾经广播没人 on）', ['src/main/import/coordinator.ts', 'src/renderer/stores/ui.ts'], ['tests/shared/import-queue.spec.ts', 'tests/renderer/batch-import-store.spec.ts']],
  ['队列收尾以 BatchOutcome 为准（事件可以丢，台账一定完整）', ['src/shared/importQueue.ts'], ['tests/shared/import-queue.spec.ts']],
  ['未执行 ≠ 失败：串行失败即停手，后面一律 not-run', ['src/shared/importQueue.ts', 'src/shared/memberPick.ts'], ['tests/shared/import-queue.spec.ts', 'tests/shared/member-pick.spec.ts']],
  ['任何时刻最多一条 running，且只有成功才顶下一条', ['src/shared/importQueue.ts'], ['tests/shared/import-queue.spec.ts']],
  ['blocked / skipped / cancelled 三种"没跑"语义分开，不许糊成两种', ['src/shared/importQueue.ts'], ['tests/shared/import-queue.spec.ts']],
  ['进度只贴到最后一条 running；序号对不上不许静默改错条', ['src/shared/importQueue.ts'], ['tests/shared/import-queue.spec.ts']],
  ['导入浮层多条并发展示（§5.2 的形态）', ['src/renderer/components/ImportFlow.tsx'], []],
  // ---------------------------------------------------------------- ② 多选卡批量
  ['Q2：批量上限复用 IMPORT_BATCH_MAX=8，主进程不另写一个数', ['src/shared/memberPick.ts', 'src/main/import/memberImport.ts'], ['tests/import/member-import.spec.ts', 'tests/shared/member-pick.spec.ts']],
  ['Q3：一批一次覆盖决定；四个数（包 / 冲突包 / 覆盖文件 / 全新）各管各的', ['src/shared/memberPick.ts', 'src/main/import/memberImport.ts'], ['tests/shared/member-pick.spec.ts', 'tests/shared/import-notes.spec.ts']],
  ['一张卡能不能直导的判据只写一处（cardImportChoice），不替他挑成员', ['src/shared/memberPick.ts', 'src/renderer/stores/ui.ts'], ['tests/shared/member-pick.spec.ts', 'tests/renderer/batch-import-store.spec.ts']],
  ['9 张卡自动切两批、一次只抽一批；「就导到这儿」把剩下的退回', ['src/renderer/stores/ui.ts', 'src/main/import/memberImport.ts'], ['tests/renderer/batch-import-store.spec.ts']],
  ['结果卡标题的包数不读已被清空的 plan（活体抓到"批量导入 · 0 个包"）', ['src/renderer/stores/ui.ts'], ['tests/renderer/batch-import-store.spec.ts']],
  ['撤销抢权：连点两次「整批退回」只撤一次，第二次不改写第一次的账', ['src/main/import/coordinator.ts'], ['tests/import/rollback-claim.spec.ts']],
  ['桥接报 failed（有资源没删掉）如实带出来，删除整步失败要能再撤一次', ['src/main/import/coordinator.ts'], ['tests/import/rollback-claim.spec.ts']],
  // ---------------------------------------------------------------- ③ 改分类搬文件
  ['Q4：搬之前给只读预览（N 文件 / 目标目录 / 会覆盖谁），确认才动盘', ['src/main/library/rearchive.ts', 'src/shared/rearchiveDialog.ts', 'src/renderer/components/RearchiveDialog.tsx'], ['tests/shared/rearchive-dialog.spec.ts', 'tests/library/rearchive.spec.ts', 'tests/renderer/rearchive-store.spec.ts']],
  ['预览算完之后磁盘与库里一个字节都没变（那些数字只能来自只读）', ['src/main/library/rearchive.ts'], ['tests/library/rearchive.spec.ts']],
  ['子项 / 附属跟着父级搬，同一个 batchId 整批可撤', ['src/main/library/rearchive.ts'], ['tests/library/rearchive.spec.ts']],
  ['散着的子项（库里路径不在父目录里）单独成一条 move，且只改被搬那棵树里的列', ['src/main/library/rearchive.ts'], ['tests/library/rearchive.spec.ts']],
  ['改完分类索引真的重建（reclassify 曾经不重建，而 SEARCH.md 声称会）', ['src/main/ipc/assets.ts'], ['tests/library/rearchive.spec.ts']],
  ['Ctrl+Z 撤 rearchive 不许顺手删掉素材记录（inPlace 那条）', ['src/main/library/undo.ts'], ['tests/library/rearchive.spec.ts', 'tests/library/commit-undo.spec.ts']],
  ['路径比较一律走 isInside（normalizeForCompare 会把分隔符统一成反斜杠）', ['src/main/library/rearchive.ts', 'src/main/security/paths.ts'], ['tests/security/paths.spec.ts', 'tests/library/rearchive.spec.ts']],
  ['键盘默认项恒为取消：回车 / Esc 不许触发搬文件', ['src/shared/rearchiveDialog.ts'], ['tests/shared/rearchive-dialog.spec.ts']],
  // ---------------------------------------------------------------- ④ 类别口语
  ['Q5：汉字→日语读音不引词典，提示做进文案（偏离写进 SEARCH.md）', ['docs/SEARCH.md', 'src/renderer/i18n/zh-CN.json'], ['tests/renderer/i18n.spec.ts']],
  ['口语走查询侧展开，一条都不塞进每条素材的别名（5 万实测 206 万条的教训）', ['src/shared/categoryExpand.ts', 'src/main/search/index.ts'], ['tests/search/synonyms.spec.ts', 'tests/perf/scale.spec.ts']],
  ['二级口语只映射二级标签（搜「礼服」不该把整个服装类拖出来）', ['src/shared/categoryExpand.ts'], ['tests/search/synonyms.spec.ts']],
  ['fuzzy 兜底趟只吃整串 ASCII 的输入（「冰箱」→ xing 捞出发型那次）', ['src/main/search/index.ts'], ['tests/search/synonyms.spec.ts']],
  ['面板加词不重启就生效；单字当场拒，上限与主进程 validate 同一个数', ['src/shared/synonymEdit.ts', 'src/main/services/categories.ts', 'src/renderer/components/SynonymEditor.tsx'], ['tests/shared/synonym-edit.spec.ts', 'tests/services/category-synonyms.spec.ts']],
  // ---------------------------------------------------------------- ⑤ 变体分列
  ['⭐ 用户加的口语存到运行时目录的增量、内置表只读（第 2 轮打包版：写安装目录 = 升级即丢）', ['src/main/services/categories.ts', 'src/main/services/paths.ts'], ['tests/services/categories-delta.spec.ts']],
  ['dims 编解码 + 三条画法判据（单值不列 / 容器不重复数版本 / >3 说 +N）', ['src/shared/variantDims.ts', 'src/renderer/components/AssetGrid.tsx'], ['tests/shared/variant-dims.spec.ts']],
  ['卡片 SQL 一次取同组维度（两条数据源共用同一个 sortDims，不各排一遍）', ['src/main/db/repos/asset.ts', 'src/main/db/repos/product.ts'], ['tests/shared/variant-dims.spec.ts']],
  ['模型名大小写双胞胎去重（否则 avatar 变体整个被吞掉）', ['src/main/classify/engine.ts', 'src/main/library/regroup.ts'], ['tests/library/regroup.spec.ts', 'tests/classify/grouping.spec.ts']],
  ['⑤ 的代价量过并钉住（500 卡 +13%，闸 1500ms）', ['src/main/db/repos/asset.ts'], ['tests/perf/cards-dims.spec.ts']],
  // ---------------------------------------------------------------- ⑥ 跨工程反查
  ['Q6：只读 import_log，限制口径必须上界面（不许写成"仅供参考"）', ['src/shared/installedWhere.ts', 'src/renderer/components/DetailPanel.tsx'], ['tests/shared/installed-where.spec.ts']],
  ['反查按 project_id 聚合 + 同组兄弟行一起算 + 工程被删过留 known=false', ['src/main/db/repos/unity.ts'], ['tests/db/installed-where.spec.ts']],
  ['只有退回记录的工程算历史：不进"装过"计数，但行要留着', ['src/main/db/repos/unity.ts', 'src/shared/installedWhere.ts'], ['tests/db/installed-where.spec.ts', 'tests/shared/installed-where.spec.ts']],
  ['装桥接那类记录（kind=bridge_install）不许算成"这个素材装过"', ['src/main/db/repos/unity.ts'], ['tests/db/installed-where.spec.ts']],
  // ---------------------------------------------------------------- ⑦ 首次发现工程弹桥接窗
  ['R-10 三按钮判据全在纯函数（六输入四出口，逐条钉）', ['src/shared/bridgeAsk.ts', 'src/renderer/components/BridgeAskDialog.tsx'], ['tests/shared/bridge-ask.spec.ts']],
  ['两个边沿都接上：第一次发现（可问 / 可装）+ 开始运行（只装不问）', ['src/main/project/api.ts'], ['tests/project/bridge-ask-wiring.spec.ts']],
  ['边沿事件攒进主进程队列（广播是发后即忘的，第一轮发现早于窗口就绪）', ['src/main/bridge/askQueue.ts', 'src/main/bridge/ipc.ts', 'src/renderer/stores/ui.ts'], ['tests/project/bridge-ask-wiring.spec.ts']],
  ['队列取看不清空：整页刷新不许把没答的问题吞掉（活体真撞见过）', ['src/main/bridge/askQueue.ts'], ['tests/project/bridge-ask-wiring.spec.ts']],
  ['Q7：答案存 setting 键 bridgeAsk:<id>，不为它动 schema；脏值当没答过', ['src/main/db/repos/bridgeAsk.ts'], ['tests/db/bridge-ask.spec.ts']],
  ['bridgeAutoInstall 真被主进程读（第二个死设置；行为 + 读源码两条都钉）', ['src/main/project/api.ts', 'src/shared/bridgeAsk.ts'], ['tests/project/bridge-ask-wiring.spec.ts', 'tests/shared/bridge-ask.spec.ts']],
  ['Esc / 点遮罩关掉弹窗不算回答（什么都不写，下次还会问）', ['src/renderer/stores/ui.ts', 'src/renderer/components/BridgeAskDialog.tsx'], []],
  // ---------------------------------------------------------------- 真机两条缺陷的修复
  ['§8-2：只剩 WMI 一路撑着"运行中"要过宽限期即判停（常量单独钉）', ['src/main/project/running.ts', 'src/shared/constants.ts'], ['tests/project/wmi-only-grace.spec.ts', 'tests/project/wmi-real-output.spec.ts']],
  ['"被覆盖的文件已备份"只在真存下东西时才说', ['src/shared/importNotes.ts', 'src/main/import/coordinator.ts'], ['tests/shared/import-notes.spec.ts']],
  ['运行状态三路探测的接线本身有用例（曾经是死代码）', ['src/main/project/running.ts', 'src/main/project/api.ts'], ['tests/project/running-wiring.spec.ts']],
  // ---------------------------------------------------------------- 第 5 轮 · M6 那四条真机欠账
  ['⭐ 托盘唤醒：先问"是不是藏着的"再拿窗口（置顶那 1.2 秒以前一次都没跑过）', ['src/main/window.ts'], ['tests/project/wake-order.spec.ts']],
  ['§8-11 真 none 的活体（有集合但都不沾 → 只更新顶栏、不切视图）', ['src/main/project/autoSwitch.ts', 'tools/live-r5-m6-debts.cjs'], []],
  ['「以后都自动安装」的第二次命中（**重启进程之后**按路径找回答案）', ['src/main/project/api.ts', 'src/main/db/repos/bridgeAsk.ts', 'tools/live-r5-m6-debts.cjs'], []],
  ['托盘置顶 1.2 秒与"已可见不闪置顶"的活体探针（Win32 逐 100ms 采样）', ['tools/topmost.ps1', 'tools/live-r5-m6-debts.cjs'], []],
  // ---------------------------------------------------------------- 第 7 轮 · M7 首启向导
  ['⭐ 向导的门禁 / 步数 / 接管判据全在纯函数里（组件只做映射，本仓零 DOM 测试）', ['src/shared/wizardState.ts'], ['tests/shared/wizard-state.spec.ts']],
  ['⭐ 没设库根不许往库里写：闸门只有一处，且真被三条写路径调用', ['src/main/services/settings.ts', 'src/main/ingest/api.ts', 'src/main/ipc/assets.ts'], ['tests/services/library-root-guard.spec.ts']],
  ['第 ① 步的只读目录探测（封顶 + 数不到当"像有素材"，绝不猜"空的"）', ['src/main/ipc/system.ts', 'src/main/unpack/magic.ts'], ['tests/shared/wizard-state.spec.ts']],
  ['接管已有库 = 只登记不搬盘 + 顺手关掉高置信度自动归档（Q3）', ['src/shared/wizardState.ts', 'src/renderer/stores/ui.ts'], ['tests/shared/wizard-state.spec.ts']],
  ['向导四步的界面与断点续填', ['src/renderer/components/FirstRunWizard.tsx', 'src/renderer/App.tsx'], ['tests/shared/wizard-state.spec.ts']],
  ['⭐ Q10「剩下 N 个都不再问」= 每个工程各写一行 never，不加全局静音标志', ['src/main/bridge/askQueue.ts', 'src/main/bridge/ipc.ts', 'src/renderer/components/BridgeAskDialog.tsx'], ['tests/bridge/ask-queue.spec.ts', 'tests/shared/bridge-ask.spec.ts', 'tests/project/bridge-ask-wiring.spec.ts']],
  ['⭐ 手动装成桥接也要让那条待答出队（第 7 轮 ④ 活体撞到的）', ['src/main/bridge/ipc.ts', 'src/renderer/stores/ui.ts', 'src/renderer/pages/Project.tsx'], ['tests/project/bridge-ask-wiring.spec.ts']],
  ['首启向导的活体夹具（3 个假工程 + 假 VCC 清单；根目录名不对就拒绝删）', ['tools/make-m7-live-tree.cjs'], []],
  ['⭐ 带 --remote-debugging-port 的 dev 必须有 AVCA_APP_HOME，否则拒绝启动（2026-10-09 真撞过）', ['tools/dev.cjs'], []],
  ['跳过向导之后侧栏要留"库还没配好"的口子，点开回到第 ① 步', ['src/renderer/components/chrome.tsx', 'src/renderer/stores/ui.ts'], ['tests/renderer/wizard-wiring.spec.ts']],
  ['向导四步的界面接线（App 门禁顺序 / 判据不许搬回组件）', ['src/renderer/App.tsx', 'src/renderer/components/FirstRunWizard.tsx'], ['tests/renderer/wizard-wiring.spec.ts']],
  ['⭐ 密码只在加密可用时才存：不可用 = 什么都不写，绝不退回明文（Q7 甲档的命门）', ['src/main/services/secrets.ts', 'src/main/db/repos/passwordVault.ts'], ['tests/services/secrets.spec.ts', 'tests/services/secrets-wiring.spec.ts']],
  ['记住的密码能看见、能逐条删，且界面永远拿不到明文', ['src/main/ipc/secrets.ts', 'src/renderer/components/PasswordVaultPanel.tsx'], ['tests/services/secrets-wiring.spec.ts']],
  ['摄取链真的会用记住的密码（含"只试一次"的防死循环标志）', ['src/main/ingest/api.ts'], ['tests/services/secrets-wiring.spec.ts']],
  ['沙盒活体（**dev 版**）：向导四步全程 + 批量装桥接 + 「剩下都不再问」+ 跳过再回来', ['tools/make-m7-live-tree.cjs'], []],
  [
    '⭐ 第 7 轮 ⑧ · **打包版**真机首启六条（四场 91 条判据：launch / password / skip / asks；起实例前硬查 asar 比源码新、Unity 没开、沙盒路径名含 avca/m7）',
    ['tools/live-m7-packaged.cjs', 'tools/make-m7-live-tree.cjs'],
    []
  ],
  // ---------------------------------------------------------------- 接线与活体
  ['IPC 通道与事件全链对齐（preload 白名单 / 主进程 handler / 渲染层订阅）', ['src/shared/ipc.ts', 'src/preload/index.ts'], ['tests/renderer/ipc-channels.spec.ts']],
  ['沙盒活体：批量导入串行 + 进度 + 整批退回（§8-4 有图）', ['tools/live-r4-batch.cjs', 'tools/make-r4-live-tree.cjs'], []],
  ['沙盒活体：改分类搬文件 + 撤销 + 新词当场搜到（§6 有图）', ['tools/live-r4-move.cjs', 'tools/live-r4-move-reason.cjs'], []],
  ['沙盒活体：口语搜索 + 面板加词不重启生效 + 落点与升级模拟三段（--stage=add|upgrade|cleanup）', ['tools/live-r4-synonyms.cjs'], []],
  ['沙盒活体：变体分列 + 跨工程反查', ['tools/live-r4-dims-where.cjs', 'tools/live-r4-dims-reset.cjs'], []],
  ['沙盒活体：首次弹桥接窗五步（含整页刷新那条）', ['tools/live-r4-bridge-ask.cjs'], []],
  ['真 Unity 活体：§8-1 / 8-3 / 8-6 / 8-7 + 批量退回二次点击', ['tools/live-s8-real-unity.cjs', 'tools/live-s8-double-rollback.cjs', 'tools/live-s8-close-watch.cjs'], []],
  ['真库只读预览（搬文件 / 5 张缺变体的卡成因），一个字节没动', ['tests/real/realdb-r4-preview.spec.ts'], ['tests/real/realdb-r4-preview.spec.ts']],
  ['三语文案（新增 key 全部走 add-i18n-keys，占位符一律双花括号）', ['src/renderer/i18n/zh-CN.json', 'src/renderer/i18n/en.json', 'src/renderer/i18n/ja.json'], ['tests/renderer/i18n.spec.ts']],
  ['回退验证器（42 处变异，每处撤掉都有用例变红；跑完必须 git status 看工作区干净）', ['tools/verify-red-r4.cjs'], []],
  ['M7 回退验证器（29 处变异：门禁三态 / 第①步判据 / 库根闸门 / Q10 出队 / 密码库；**不与 r4 那张表合并**，一次要跑二十来轮 vitest）', ['tools/verify-red-m7.cjs'], []],
  ['对账表：R4 三十四条 + M7 四十二条逐条在册', ['tests/spec-coverage.spec.ts'], ['tests/spec-coverage.spec.ts']]
]

/** 中文按两格宽对齐（否则表格会歪） */
function pad(s, n) {
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)
  return s + ' '.repeat(Math.max(0, n - w))
}

let bad = 0
const untested = []
console.log(pad('交付项', 66) + pad('实现', 8) + pad('测试', 26))
console.log('-'.repeat(108))
for (const [name, impls, tests] of items) {
  const missImpl = impls.filter((p) => !fs.existsSync(path.join(REPO, p)))
  const missTest = tests.filter((p) => cases(p) < 0)
  const n = tests.reduce((a, t) => a + Math.max(0, cases(t)), 0)
  if (missImpl.length || missTest.length) bad++
  if (!tests.length) untested.push(name)
  console.log(
    pad(name, 66) +
      pad(missImpl.length ? '缺 ' + missImpl.join(',') : 'OK', 8) +
      (tests.length ? (missTest.length ? '缺文件' : pad(String(n) + ' 项', 26)) : pad('(无自动化用例)', 26))
  )
}
console.log('-'.repeat(108))
if (untested.length) {
  console.log('没有自动化用例、只能靠沙盒活体或人点的项：')
  for (const u of untested) console.log('  · ' + u)
}
console.log(
  [
    '',
    '真机待验（沙盒证明不了的一批，别当已验证）：',
    '  · 桥接 ≥1.1.0 的 C# 那一支（topFolders / avatarDescriptors 现在人人记 bridgeTooOld；撤销后留在工程里的空目录 .meta 也归它）',
    '  · 真 Unity 开着工程时的自动装桥接（⑦ 那五步与第 5 轮的 always 两支用的都是桥接心跳假象，判定链同一条，但没在真编辑器上验）',
    '  · 唤醒时"焦点跟不跟过来"（第 5 轮实测：置顶 1185ms 真生效、前台 0/127 —— 规格按字面已满足，要不要算验收项等他裁）',
    '  · 浮层与弹窗的"画法"（渲染层零 DOM 测试，只有截图）',
    '  · Setup.exe 覆盖安装的真实升级行为（第 8 轮；第 3 轮只手工替换安装目录文件模拟过）',
    '  · ③ 在他真库 E:\\vrc\\A 上真搬（只读预览过了，动盘要他点头）',
    '  已清掉（别重复列）：打包版真跑 R4 全链（第 2 轮）、口语增量落点（第 3 轮）、§8-5 Play 排队 / 真 zip 成员导入 / >8 成员多批（第 4 轮）、§8-11 真 none / 「以后都自动安装」重启后第二次命中 / 托盘置顶 1.2 秒（第 5 轮）'
  ].join('\n')
)
console.log(bad ? `\n有 ${bad} 项的证据文件缺失，别当交付完成。` : '\n证据文件都在。未验证的项上面已单独列出，不算通过。')
process.exit(bad ? 1 : 0)
