#!/usr/bin/env node
/**
 * **第 9 轮的回退验证器**：把本轮三块改动（① 给待复核装出口、② B4 存量重并、
 * ⑥ 存量重并改成"自动并完 + 事后告知"）每处修复临时改回旧写法，
 * 跑一遍用例，确认它**真的会红**，然后无条件还原。
 *
 * ## 这张表要钉住的两类毛病
 *
 *  1. **判据退化** —— 合集卡/附属又能单独复核（同一个意图两个入口）、批量按钮不绑视图
 *     （用户以为"待复核"是个可以抹掉的过滤器）、确认框拿 `selection.length` 凑数
 *     （说好的 2 条、实际改了 3 条）。
 *  2. **写好了没人接** —— 本轮修的那个缺陷本身就是这一类：`assets:set-review` 三段全通，
 *     渲染层只有合集详情在调。所以有几条专门撤调用点（DetailPanel 改回直接摸 IPC、
 *     BundleDetail 不再带上容器行、store 不再真写库）。
 *     **这一类判据用例永远测不到**，只有把调用点拆掉才知道有没有人看着它。
 *
 * ## D 系列（⑥）多出来的是第三类毛病：**告知说了却撤不回去**
 *
 * 「自动并完」把确认那一步取消了，代价是安全垫必须换成别的东西 —— 换成"能精确撤回这一次"。
 * 所以 D 系列有一半在钉那条链上的**批次 id**：store 记不记得（D8）、前端带不带（D9/D22）、
 * 主进程理不理（D10）、preload 传不传（D11）、后端报不报回来（D12/D20）。
 * 少任何一段，那个「撤销」就退化成"撤当时最新的那一步"，而那一步很可能已经是他刚导的包。
 *
 * ## 用法
 *
 *   node tools/verify-red-r9.cjs          # 全部跑一遍
 *   node tools/verify-red-r9.cjs 7        # 只跑第 7 条
 *
 * ⚠ 它会真的改源文件（跑完立刻还原）。跑之前：`tools/killdev.ps1` → `npm run native:node` → 工作区干净。
 *   （dev 实例占着 `better_sqlite3.node`，`native:node` 会**静默失败**，然后整份文件报 ABI 不匹配。）
 * ⚠ **别和别的重活并行跑**（M5-B 实测：并发会让那一轮 vitest 起不来 → 红 0 条 → 假报"漏网"）。
 * ⚠ 锚文本一律**单行**：`src/renderer/stores/ui.ts` 是 CRLF、`src/shared/*.ts` 是 LF，
 *   多行锚有一半会因 \r 对不上而 0 命中。
 * ⚠ 每条 patch 用"锚文本恰好出现 1 次"定位；不唯一就失败。
 *   （写这张表时 `set({ selection: [], detail: null, detailId: null })` 在 ui.ts 里有 3 处，
 *   所以"清选中"那条只能靠 `tests/renderer/review-wiring.spec.ts` 的正则钉，撤不动 —— 记在这儿，
 *   别以为这张表覆盖满了。）
 * ⚠ 跑完 `git status` 必须干净（本工具只碰 src/，不产生垃圾文件）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const VITEST_ENTRY = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const REPORT = path.join(os.tmpdir(), 'avca-verify-red-r9.json')

/** 只跑本轮这几份：① 的判据与接线 + ② 的执行与接线 + ⑥ 的判据与接线 */
const SPECS = [
  'tests/shared/review-state.spec.ts',
  'tests/renderer/review-wiring.spec.ts',
  'tests/library/remerge.spec.ts',
  'tests/renderer/remerge-wiring.spec.ts',
  'tests/shared/auto-remerge.spec.ts',
  'tests/renderer/auto-remerge-wiring.spec.ts'
]

const W = 'src/shared/reviewState.ts'
const DP = 'src/renderer/components/DetailPanel.tsx'
const AG = 'src/renderer/components/AssetGrid.tsx'
const BD = 'src/renderer/components/BundleDetail.tsx'
const UI = 'src/renderer/stores/ui.ts'
const RM = 'src/main/library/remerge.ts'
const UN = 'src/main/library/undo.ts'
const AP = 'src/main/ipc/assets.ts'
const ST = 'src/renderer/pages/Settings.tsx'
const AR = 'src/shared/autoRemerge.ts'
const RC = 'src/renderer/components/RemergeNotice.tsx'
const APP = 'src/renderer/App.tsx'
const PL = 'src/preload/index.ts'

/** @type {Array<{title:string, file?:string, from?:string, to?:string, patches?:Array<{file:string,from:string,to:string}>, expect:string[]}>} */
const CASES = [
  // ---------------------------------------------------------------- 判据层
  {
    title: 'A1. 合集卡与附属又能单独复核（同一个意图长出两个入口，早晚漂走一处）',
    file: W,
    from: '  if (!c || c.isBundle || c.attachment) return off',
    to: '  if (!c) return off',
    expect: ['⭐ 合集卡 → 完全不出', '附属资源 → 不出']
  },
  {
    title: 'A2. 改了分类不再提亮（Q1 乙那条"只提示、不自动清"退化成一律不提示）',
    file: W,
    from: "    hint: c.needsReview ? (categoryDirty ? 'hint' : 'idle') : 'none'",
    to: "    hint: 'none' as const",
    expect: ['Q1 乙：改了分类']
  },
  {
    title: 'A3. 已经看过的卡也喊话（每张干净卡上都挂一颗主按钮）',
    file: W,
    from: '    prominent: c.needsReview,',
    to: '    prominent: true,',
    expect: ['已经看过的普通卡 → 只给次要链接']
  },
  {
    title: 'A4. reviewTargets 不再过滤（"标记已复核"会把干净卡的 updated_at 也刷一遍，列表当场跳）',
    file: W,
    from: '  return cards.filter((c) => !c.isBundle && !c.attachment && !!c.needsReview === want).map((c) => c.id)',
    to: '  return cards.map((c) => c.id)',
    expect: ['只挑当前真的是待复核的那几张', '反过来（重新排进待复核）', '⭐ 合集与附属一律不参与']
  },
  {
    title: 'A5. 批量那颗不绑视图（在"全部素材"里选一堆也能一键抹掉待复核）',
    file: W,
    from: '  return o.onReviewScreen && o.selected >= 2 && o.targets > 0',
    to: '  return o.selected >= 2 && o.targets > 0',
    expect: ['⭐ 不在待复核视图']
  },
  {
    title: 'A5b. 批量那颗不看"选了几张"（一张都没选也摆按钮，点下去改的是 0 行）',
    file: W,
    from: '  return o.onReviewScreen && o.selected >= 2 && o.targets > 0',
    to: '  return o.onReviewScreen && o.targets > 0',
    expect: ['一个都没选', '⭐ 只选了一张']
  },
  {
    title: 'A6. 只选一张时工具栏也长一颗（详情面板那颗还在，两个入口）',
    file: W,
    from: '  return o.onReviewScreen && o.selected >= 2 && o.targets > 0',
    to: '  return o.onReviewScreen && o.selected > 0 && o.targets > 0',
    expect: ['⭐ 只选了一张']
  },
  {
    title: 'A7. 确认框的条数不收口（脏值 / 负数原样报给用户）',
    file: W,
    from: '  return Math.max(0, Math.trunc(targets))',
    to: '  return targets',
    expect: ['条数只来自"真的会变的行数"']
  },
  {
    title: 'A8. 侧栏计数的方向反了（标完已复核，那个数反而涨）',
    file: W,
    from: "  return intent === 'done' ? -n : n",
    to: "  return intent === 'done' ? n : -n",
    expect: ['侧栏计数往下掉', '往上加']
  },
  // ---------------------------------------------------------------- 接线层
  {
    title: 'B1. DetailPanel 不再把"是不是附属"喂给判据（附属又能单独复核，界面上看不出来）',
    file: DP,
    from: '              attachment: Boolean(asset.attachment_kind)',
    to: '              attachment: false',
    expect: ['⭐ 附属那条判据真的喂给了函数']
  },
  {
    title: 'B2. 单卡那颗退回直接摸 IPC（写进去了，但侧栏那个数和列表都不刷 —— 用户以为没点上）',
    file: DP,
    from: '                  onClick={() => void setReview([asset.id], false)}',
    to: '                  onClick={() => void window.a.assets.setReview([asset.id], false)}',
    expect: ['点下去走 store 那颗']
  },
  {
    title: 'B3. AssetGrid 那句"当前在待复核视图"写死成 true（批量那颗到处都长）',
    file: AG,
    from: "  const onReviewScreen = nav === 'review'",
    to: '  const onReviewScreen = true',
    expect: ['⭐ 绑的是"当前在待复核视图"']
  },
  {
    title: 'B4. 确认框拿选中数凑条数（选到已经看过的卡时，说的和做的不是同一个数）',
    file: AG,
    from: 'onClick={() => setReviewAsk({ ids: selectedReview, n: reviewConfirmCount(selectedReview.length) })}',
    to: 'onClick={() => setReviewAsk({ ids: selectedReview, n: selection.length })}',
    expect: ['⭐ 确认框里的条数来自 reviewConfirmCount']
  },
  {
    title: 'B5. 合集那颗又只清成员、不清容器行（成员全清完，那张卡还挂在待复核里出不去）',
    file: BD,
    from: 'setReview([...picked, bundleId], false)',
    to: 'setReview([...picked], false)',
    expect: ['⭐ 容器那一行跟着一起清']
  },
  {
    title: 'B6. store 那颗不真写库（点了有 toast、界面也变了，重启一看标记还在）',
    file: UI,
    from: '        const r = await window.a.assets.setReview(ids, needReview)',
    to: '        const r = { updated: ids.length }',
    expect: ['调 IPC、刷列表、刷统计，三样一件不缺']
  },
  // ---------------------------------------------------------------- ② B4 存量重并
  {
    title: 'C1. 喂给 planGroups 的"货架"写成文件路径（预览永远报 0 簇，功能当场变成死的）',
    file: RM,
    from: '      dir: dirKeyOf(r.library_path ?? r.source_path ?? null)',
    to: '      dir: r.library_path ?? r.source_path ?? null',
    expect: ['⭐ 真库形状', '同目录的同一件东西要能报出来']
  },
  {
    title: 'C2. 已经并好但键还是老的那批不再报出来（"无事可做"是假的）',
    file: RM,
    from: '      if (!g || g.group_key === p.groupKey) continue',
    to: '      if (!g) continue',
    expect: ['已经并好、键也对']
  },
  {
    title: 'C3. 删旧组前不看"是不是真空了"（组里还挂着附属就被删，留下一堆孤儿 group_id）',
    file: RM,
    from: '        if (Number(stay.n) > 0) continue',
    to: '        if (Number(stay.n) > 999) continue',
    expect: ['⭐ 不留孤儿行']
  },
  {
    title: 'C4. 变体查重整个关掉（一张卡上同时挂 Airi 与 AIRI，徽章一半是重复的）',
    file: RM,
    from: '        if (have.has(sig)) return',
    to: '        if (false) return',
    expect: ['⭐ 变体补齐']
  },
  {
    title: 'C5. 变体写归并键内部那份大写值（真库里存的是原样词形，两种写法混在一排）',
    file: RM,
    from: '  const name = hit ? hit[0] : upper',
    to: '  const name = upper',
    expect: ['⭐ 变体补齐']
  },
  {
    title: 'C6. 多体型的包也写变体（一个包适配两个体型 → 聚合视图谎报"12 变体"）',
    file: RM,
    from: "        if (t.avatars.length === 1) put(r.assetId, 'avatar', displayAvatar(row.raw_name || row.name, t))",
    to: "        if (t.avatars.length >= 1) put(r.assetId, 'avatar', displayAvatar(row.raw_name || row.name, t))",
    expect: ['⭐ 变体补齐']
  },
  {
    title: 'C7. 撤销时不把删掉的组塞回去（Ctrl+Z 之后库里少 12 个组，退不回去）',
    file: UN,
    from: '        for (const d of drops) {',
    to: '        for (const d of []) {',
    expect: ['一次 Ctrl+Z 全撤', '撤销之后组数回到 13']
  },
  {
    title: 'C8. 落地时直接用前端传来的旧预览（中间只要入过一次库，就是按旧地图挪新数据）',
    file: AP,
    from: '    const full = planRemerge(db, lex)',
    to: '    const full = { scanned: 0, skippedAmbiguous: 0, clusters: [] }',
    expect: ['⭐ 主进程落地时']
  },
  {
    title: 'C9. 面板没挂进设置页（后端四段全通、界面上没有入口 —— ① 那个毛病重演一遍）',
    file: ST,
    from: '                <RemergePanel />',
    to: '                {null}',
    expect: ['⭐ 面板真的挂在设置页里']
  },
  {
    title: 'C10. 预览不排在前面（面板只列前 8 行，用户看见的全是"已经不动的那批"）',
    file: RM,
    from: '    const rows = rowOf().sort((a, b) => Number(moving.has(b.assetId)) - Number(moving.has(a.assetId)))',
    to: '    const rows = rowOf()',
    expect: ['⭐ 预览把"要挪的"排在前面']
  },
  // ---------------------------------------------------------------- ⑥ 自动并完 + 事后告知
  {
    title: 'D1. 那道刹车拿掉（用户撤销完，下次开机程序把同一批卡又并一遍 = 抢方向盘）',
    file: AR,
    from: '  if (i.alreadyRun) return false',
    to: '  if (false) return false',
    expect: ['刹车：这台机器已经跑过一次']
  },
  {
    title: 'D2. 向导/小窗/没配库那几道不看了（首启那一刻跟他抢注意力）',
    file: AR,
    from: '  return i.booted && i.libraryReady && !i.wizardOpen && !i.miniView',
    to: '  return i.booted',
    expect: ['四种"此刻不该抢注意力"的情形各自都不问']
  },
  {
    title: 'D3. 一簇也懒得并（真库实测就只有 1 处要并，拦掉等于本轮白做）',
    file: AR,
    from: '  return clusters > 0',
    to: '  return clusters > 1',
    expect: ['0 簇不动，1 簇也要动']
  },
  {
    title: 'D4. 只修了归并键也弹告知（界面上什么都没变，弹条只会让人满库找"哪里变了"）',
    file: AR,
    from: '  if (clusters <= 0 || moved <= 0) return null',
    to: '  if (clusters <= 0) return null',
    expect: ['只修了归并键、一张卡都没挪']
  },
  {
    title: 'D5. 明细里"并进来几张"拿总卡数凑（真库形状会写 20 张，实际少掉 12 张）',
    file: AR,
    from: "      ? { name: c.name, key: 'remerge.autoLineMerged' as const, count: c.moved }",
    to: "      ? { name: c.name, key: 'remerge.autoLineMerged' as const, count: c.rows }",
    expect: ['每行只说该说的数']
  },
  {
    title: 'D6. 明细不排序（只修键的那几处排在最前，用户先看见"什么都没做"）',
    file: AR,
    from: '  const sorted = [...clusters].sort((a, b) => Number(b.moved > 0) - Number(a.moved > 0) || b.moved - a.moved)',
    to: '  const sorted = [...clusters]',
    expect: ['能看见的排在前面']
  },
  {
    title: 'D7. "还有 N 处"报的是总数（6 条已经列出来了，再说还有 9 处 = 谎报）',
    file: AR,
    from: '  return { lines: lines.slice(0, NOTICE_DETAIL_MAX), more: Math.max(0, lines.length - NOTICE_DETAIL_MAX) }',
    to: '  return { lines: lines.slice(0, NOTICE_DETAIL_MAX), more: lines.length }',
    expect: ['超过上限就折起来']
  },
  {
    title: 'D8. 告知不记得自己那一批的 id（撤销按钮就没有靶子，只能撤"当时最新那一步"）',
    file: UI,
    from: '        set({ remergeNotice: { clusters: r.clusters, moved: r.moved, batchId: r.batchId, items } })',
    to: "        set({ remergeNotice: { clusters: r.clusters, moved: r.moved, batchId: '', items } })",
    expect: ['告知内容带着那一批的 id']
  },
  {
    title: 'D9. 告知条的撤销退回裸撤（那十几秒里用户导了个包，点撤销就撤掉刚导的东西）',
    file: UI,
    from: '        const r = await window.a.journal.undoLast(n.batchId)',
    to: '        const r = await window.a.journal.undoLast()',
    expect: ['撤销按钮打的是 undoRemerge']
  },
  {
    title: 'D10. 主进程那道"只撤这一批"的闸失效（D9 的另一种坏法：前端带 id、后端不理）',
    file: UN,
    from: '  if (deps.onlyBatchId && head.batch_id !== deps.onlyBatchId)',
    to: '  if (false)',
    expect: ['不是最新那一批']
  },
  {
    title: 'D11. preload 不把 id 传下去（四段链路少一段，界面点什么都撤不回来）',
    file: PL,
    from: "    undoLast: (batchId?: string | null) => invoke('journal:undo-last', batchId ?? null)",
    to: "    undoLast: () => invoke('journal:undo-last')",
    expect: ['通道两端都传这个 id']
  },
  {
    title: 'D12. apply-remerge 不回报 batchId（告知条拿不到靶子）',
    file: AP,
    from: 'clusters: picked.length, batchId: r.batchId }',
    to: 'clusters: picked.length }',
    expect: ['apply-remerge 把 batchId 报回来']
  },
  {
    title: 'D13. 告知条没挂进 App（自动并完了却没人说 —— ② 那个毛病反过来重演）',
    file: APP,
    from: '      <RemergeNotice />',
    to: '      {null}',
    expect: ['挂在 App 这一层']
  },
  {
    title: 'D14. boot 不挂这一步（整套"自动并完"变成一段没人调的代码）',
    file: UI,
    from: '        void get().maybeAutoRemerge()',
    to: '        /* ② 那四步还在设置页里，先不自动跑 */',
    expect: ['boot 末尾挂了它']
  },
  {
    title: 'D15. 查完发现没事可做也不落时间戳（每次开机都为"确认没事"全库跑一遍归并键）',
    file: UI,
    /**
     * 第 10 轮 #112 之后这两处落时间戳各带着 `autoRemergeRunRoot`，
     * 原来那句单行锚现在有 2 处命中 → 改成带上一行的锚（ui.ts 是 CRLF，所以 \r\n 要写死），
     * 只撤"没事可做"那一条，另一条由 D14/本轮 G5 管。
     */
    from:
      'if (!shouldApplyAutoRemerge(plan.clusters.length)) {\r\n          await s.patchSettings({ autoRemergeRunAt: new Date().toISOString(), autoRemergeRunRoot: st.libraryRoot })',
    to: 'if (!shouldApplyAutoRemerge(plan.clusters.length)) {\r\n          await s.patchSettings({})',
    expect: ['查成功就落时间戳']
  },
  {
    title: 'D16. 展开明细还在计时（用户正读到一半，条子自己走了）',
    file: RC,
    from: '    if (!hasHead || open || hidden) return',
    to: '    if (!hasHead || hidden) return',
    expect: ['展开时不自己收起']
  },
  {
    title: 'D17. store 那个带靶子的撤销动作改名（组件点到的是 undefined，界面看着能点其实没反应）',
    file: UI,
    from: '    async undoRemerge() {',
    to: '    async undoRemergeRenamed() {',
    expect: ['撤销失败就不关条子']
  },
  {
    title: 'D18. 「知道了」不关条子（用户已经看过、程序还在替他挂着）',
    file: RC,
    from: '        <Button className="h-6 px-2 text-[11px]" onClick={dismiss}>',
    to: '        <Button className="h-6 px-2 text-[11px]" onClick={() => {}}>',
    expect: ['撤销按钮打的是 undoRemerge']
  },
  {
    title: 'D19. 文案 key 改名（语言文件里查不到，界面直接显示 remerge.autoDoneXX）',
    file: AR,
    from: "  return { key: 'remerge.autoDone', params: { clusters, moved } }",
    to: "  return { key: 'remerge.autoDoneXX', params: { clusters, moved } }",
    expect: ['三份里都有']
  },
  {
    title: 'D20. IPC handler 把传来的 id 丢了（前端带靶子、后端当没带）',
    file: AP,
    from: "      onlyBatchId: typeof batchId === 'string' && batchId ? batchId : null",
    to: '      onlyBatchId: null',
    expect: ['通道两端都传这个 id']
  },
  {
    title: 'D21. 组件自己决定"说了几张"（判据从 shared 搬回组件，那份 shared 用例当场管不到）',
    file: RC,
    from: '  const head = notice ? noticeText(notice.clusters, notice.moved) : null',
    to: '  const head = notice ? noticeText(notice.clusters, notice.items.length) : null',
    expect: ['组件里没有判断，只有映射']
  },
  {
    title: 'D22. 告知条的撤销接错动作（接上键盘那个裸撤，等于 D9 从组件这头再犯一次）',
    file: RC,
    from: '  const undo = useUi((s) => s.undoRemerge)',
    to: '  const undo = useUi((s) => s.undoLast)',
    expect: ['撤销按钮打的是 undoRemerge']
  },
  {
    title: 'D23. 撤销成功之后那句"退回几张卡"报 0（撤成功了却告诉用户什么都没发生）',
    file: UN,
    from: "kind: 'restored', count: cards }",
    to: "kind: 'restored', count: 0 }",
    expect: ['撤销之后那句人话报的是']
  },
  {
    title: 'D24. 重并的撤销混进通用那句（「搬回 0 项、清掉 0 个空目录、移除 0 条记录」）',
    file: UN,
    from: "  const remergeOnly = rows.length > 0 && rows.every((r) => r.op === 'remerge')",
    to: '  const remergeOnly = false',
    expect: ['撤销之后那句人话报的是']
  },
  {
    title: 'D25. 设置页那颗撤销也不带靶子（合并完先去别处点两下再回来，撤的就是别人的了）',
    file: 'src/renderer/components/RemergePanel.tsx',
    from: '              const u = await window.a.journal.undoLast(lastBatch || null)',
    to: '              const u = await window.a.journal.undoLast()',
    expect: ['面板的三步都在']
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
    out = String(
      execFileSync(process.execPath, [VITEST_ENTRY, 'run', ...SPECS, '--reporter=json', `--outputFile=${REPORT}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024
      })
    )
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
    for (const a of f.assertionResults || []) if (a.status === 'failed') failed.add(String(a.fullName || a.title || ''))
  }
  const total = (report.testResults || []).reduce((n, f) => n + (f.assertionResults || []).length, 0)
  if (!total) throw new Error(`vitest 报告里一条用例都没有（退出码 ${code}）：\n${out.slice(-1500)}`)
  return { failed, total, code }
}

const only = process.argv[2] ? Number(process.argv[2]) : null
const results = []
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
      if (hits !== 1) {
        for (const s of saved) write(s.file, s.text)
        throw new Error(`${c.title}\n  锚文本在 ${p.file} 里出现 ${hits} 次（要恰好 1 次），拒绝替换`)
      }
      /** 同一文件被一条用例改两次时只留最早那份原文（见 verify-red-r4 头部那条教训） */
      if (!saved.some((s) => s.file === p.file)) saved.push({ file: p.file, text: src })
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
