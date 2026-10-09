/**
 * **回退验证器**：把 M5-B ① 的每处修复临时改回旧写法，跑一遍用例，确认它**真的会红**，
 * 然后无条件恢复。
 *
 * 为什么要这个文件而不是"我手工试过"：这个仓库为"假回归用例"付过三次学费
 * （CHANGE-REPORT §7.1）—— 断言写了但抓不到 bug，比不写更糟，因为它给了绿灯。
 * 所以每条新用例都得能回答：**把修复撤掉，哪一条会红？** 答不上来就是没覆盖。
 *
 * 用法：
 *   node tools/verify-red-m5b.cjs        # 全部跑一遍
 *   node tools/verify-red-m5b.cjs 3      # 只跑第 3 条
 *
 * ⚠ 它会真的改源文件（跑完立刻还原），跑之前请保证工作区干净、A 没在跑。
 * ⚠ 锚文本一律用**单行**：这个仓库的源文件是 CRLF，多行锚文本会因为 对不上而 0 命中
 *   （写这份工具时就踩过一次，工具当场拒绝替换、没有瞎改，行为是对的）。
 * ⚠ 每条 patch 用"锚文本恰好出现 1 次"定位；不唯一就当场失败，绝不批量替换
 *   （上一任用批量替换脚本毁过 7 行健康检查的测试，教训记在项目备忘里）。
 * ⚠ 解析失败一律抛错，不许返回空集合假装"都绿了"—— 本工具自己第一次就是这么
 *   "全部红 0 条"的（拿 `.cmd` 起 vitest 在 Windows 上根本起不来）。
 * ⚠ **别和别的重活并行跑**（实测 2026-10-06：和 selfcheck + 桥接编译检查一起发，
 *   45 条里冒出一条"漏网"；单独重跑两次都是全钉住）。这台机器 16 GB，
 *   vitest 抢不到 CPU 时那一轮会超时/起不来 → 红了 0 条 → 被当成没覆盖。
 *   报"漏网"时先单独重跑一次再动手改用例。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
/** 要跑的用例文件（一次全跑，红了哪条按名字认） */
const SPECS = [
  'tests/unpack/members.spec.ts',
  'tests/import/extract-root.spec.ts',
  'tests/import/container-packages.spec.ts',
  'tests/import/coordinator.spec.ts',
  'tests/import/member-import.spec.ts',
  /** ⑥ 的预勾与分批是纯函数，能离线测 —— 所以它也归"必须会红"那一堆 */
  'tests/shared/member-pick.spec.ts'
]
/**
 * 用 node 直接跑 vitest 的入口。
 * 不要 spawn `node_modules/.bin/vitest.cmd`：Windows 上不经 shell 起 .cmd 会 EINVAL，
 * 而 stdio 全 pipe 会把那句报错吞掉，表现就是"一条都没红"这种最坏的假通过。
 */
const VITEST_ENTRY = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const REPORT = path.join(os.tmpdir(), 'avca-verify-red.json')

/** @type {Array<{title:string, file:string, from:string, to:string, expect:string[], count?:number}>} */
const CASES = [
  {
    title: 'A. extractMembers 退回"按 basename 找落地文件"（P0-1 原样）',
    file: 'src/main/unpack/members.ts',
    from: '    const hit = landed.get(key)',
    to: '    const hit = landed.get(key.split("/").pop())',
    expect: ['落地的文件真的能解析出条目', '分类流程真的能吃到嵌套内层包']
  },
  {
    title: 'B. unzip 的 only 退回前缀匹配（P0-2 原样）',
    file: 'src/main/unpack/unzip.ts',
    from: 'if (opts.only?.length && !opts.only.some((p) => memberMatches(name, p))) {',
    to: "if (opts.only?.length && !opts.only.some((p) => name.startsWith(p.replace(/\\\\/g, '/')))) {",
    expect: ['extractZip 只落地点名的那一个成员']
  },
  {
    title: 'C. 空 wanted 不再抛（"空 = 解全部"那条老歧义回来）',
    file: 'src/main/unpack/members.ts',
    from: '  if (!list.length) {',
    to: '  if (false) {',
    expect: ['wanted 传空数组直接抛']
  },
  {
    title: 'D. 不做 stat 事实检查（名字叫 .zip 的目录被当压缩包）',
    file: 'src/main/unpack/members.ts',
    from: "  if (st.isDirectory()) throw new NotAnArchiveError(file, 'is-directory')",
    to: '  // 回退：不查目录',
    expect: ['名字叫 .zip 的目录']
  },
  {
    title: 'E. zip 解压完全忽略 only（整包摊开）',
    file: 'src/main/unpack/unzip.ts',
    from: '        if (opts.only?.length && !opts.only.some((p) => memberMatches(name, p))) {',
    to: '        if (false && opts.only?.length) {',
    expect: ['只抽 1 个时磁盘上就只有那 1 个']
  },
  {
    title: 'E2. 7z 后端的"空清单"闸门撤掉',
    file: 'src/main/unpack/sevenZip.ts',
    from: '  if (opts.only && opts.only.length === 0) {',
    to: '  if (false && opts.only && opts.only.length === 0) {',
    expect: ['7z 后端也一样：空 only']
  },
  {
    title: 'F. 加密 zip 转交 7z 时丢掉 only',
    file: 'src/main/unpack/unzip.ts',
    from: '      only: opts.only,',
    to: '      // 回退：把 only 丢了',
    expect: ['加密包定点抽取']
  },
  {
    title: 'G. 后端太旧不再单独分类（谎报"包坏了"）',
    file: 'src/main/unpack/sevenZip.ts',
    from: '    if (UNSUPPORTED_OPT_RE.test(blob)) throw new BackendUnsupportedError(backend.exe, blob.slice(0, 200))',
    to: '    // 回退：不区分旧后端',
    expect: ['后端太旧']
  },
  {
    title: 'H. "在库根之内"退回字符串前缀判断（D:\\vrc\\AB 会被误判成在 D:\\vrc\\A 里面）',
    file: 'src/main/import/extractRoot.ts',
    from: "  if (lib && (root === lib || root.startsWith(lib + '/'))) {",
    to: '  if (lib && root.startsWith(lib)) {',
    expect: ['只是名字像']
  },
  {
    title: 'I. C 盘闸门撤掉',
    file: 'src/main/import/extractRoot.ts',
    from: "  if (facts.driveOf(root) === 'c') throw new ExtractRootError('err.extractOnSystemDrive', { extractRoot })",
    to: '  // 回退：不查系统盘',
    expect: ['C:\\ 开头一律拒绝，大小写都算']
  },
  {
    title: 'J. 空间闸门撤掉（解到一半写爆盘）',
    file: 'src/main/import/extractRoot.ts',
    from: '  if (free < floor) {',
    to: '  if (false) {',
    expect: ['剩余 < floor', '大包按 need×2 算']
  },
  {
    title: 'K. sizeOfTree 不递归（抽取目录天生三层，不递归永远是 0）',
    file: 'src/main/import/extractRoot.ts',
    from: '      total += sizeOfTree(full)',
    to: '      // 回退：不往子目录走',
    expect: ['sizeOfTree 会递归', 'prune 清整个抽取根']
  },
  {
    title: 'L. 成员目录不带 seq（同素材两个包互相覆盖）',
    file: 'src/main/import/extractRoot.ts',
    from: '  const dir = path.join(extractRoot, String(assetId), String(seq))',
    to: '  const dir = path.join(extractRoot, String(assetId))',
    expect: ['同一个素材的两个成员各占一个目录']
  },
  {
    title: 'M. 不再记录"包里还有压缩包"（一层封顶变成看不见）',
    file: 'src/main/import/containerPackages.ts',
    from: '    if (ARCHIVE_RE.test(e.name)) {',
    to: '    if (false) {',
    expect: ['只记一笔、绝不往里钻']
  },
  {
    title: 'N. 深度上限撤掉（静默少列变成瞎列）',
    file: 'src/main/import/containerPackages.ts',
    from: '  if (depth > lim.depthMax) {',
    to: '  if (false) {',
    expect: ['撞深度上限的要记在 capped']
  },
  {
    title: 'O. 数量上限撤掉',
    file: 'src/main/import/containerPackages.ts',
    from: '  if (out.members.length >= lim.scanMax) {',
    to: '  if (false) {',
    expect: ['撞数量上限同理']
  },
  {
    title: 'P. 目录容器不做 stat 分支（名字叫 .zip 的目录被当压缩包）',
    file: 'src/main/import/containerPackages.ts',
    from: '  if (st.isDirectory()) {',
    to: '  if (false) {',
    expect: ['名字叫 .zip 的目录走目录分支']
  },
  {
    title: 'Q. 加密容器不单独报 needsPassword',
    file: 'src/main/import/containerPackages.ts',
    from: '    if (e instanceof PasswordNeededError) {',
    to: '    if (false) {',
    expect: ['needsPassword 要单独报出来']
  },
  {
    title: 'R. 清单不排垃圾条目',
    file: 'src/main/import/containerPackages.ts',
    from: '    if (isJunkRelPath(rel)) continue',
    to: '    // 回退：不排垃圾',
    expect: ['垃圾条目与非包文件不进清单']
  },
  // ---------------------------------------------------------------- M5-B ⑤ 主链路
  {
    title: 'S. 抽取点名退回"来源与清单不符也照抽"（会拿错包导进工程）',
    file: 'src/main/import/memberImport.ts',
    from: '      if (!origin.memberRelPath || origin.memberRelPath !== pick.relPath) {',
    to: '      if (false) {',
    expect: ['清单过期（来源与清单对不上）→ 拒绝抽那一条，绝不"抽个看着像的"顶上']
  },
  {
    title: 'T. 主链路不调闸门（三道校验只在单测里活着，链上等于没有）',
    file: 'src/main/import/memberImport.ts',
    from: '    freeBytes = assertExtractRootUsable(input.extractRoot, input.libraryRoot, needBytes, input.disk)',
    to: '    freeBytes = -1',
    expect: [
      '空间不够 → 整批不开始，抽取根一个字节都没写',
      '抽取根落在库内 → 拒绝，且不在库里建任何目录',
      '抽取根落在 C 盘 → 拒绝'
    ]
  },
  {
    title: 'U. 确认时不重新预扫描，用计划那次的旧冲突表',
    file: 'src/main/import/memberImport.ts',
    from: '    const fresh = await preflight(db, bridge, plan.projectPath, item.localPath, plan.projectId)',
    to: '    const fresh = item.preflight',
    expect: ['导入前重新预扫描：备份用的是当下的冲突表，不是计划那次算的']
  },
  {
    title: 'V. Unity 退回失败后不停手（一个报错的编辑器被捶八次）',
    file: 'src/main/import/memberImport.ts',
    from: '    if (!r0.ok) {',
    to: '    if (false) {',
    expect: [
      '第 1 条 Unity 退回失败 → 停手，第 2 条记为未执行，不发 delete_guids',
      '第 2 条失败 → 第 1 条留在工程里，两条记录都在，撤销如实报"卡在第几条"'
    ]
  },
  {
    title: 'W. 没执行的条目不收副本',
    file: 'src/main/import/memberImport.ts',
    from: '    if (item.extractDir && !(await releaseMemberDir(item.extractDir, plan.extractRoot))) out.cleanupFailed++',
    to: '    if (false) out.cleanupFailed++',
    expect: ['第 1 条 Unity 退回失败 → 停手，第 2 条记为未执行，不发 delete_guids']
  },
  {
    title: 'X. 目录型成员也当副本处理（把库里的原件路径传给删除）',
    file: 'src/main/import/memberImport.ts',
    from: '        localPath = abs',
    to: '        localPath = abs; extractDir = abs',
    expect: [
      '目录型容器导完之后，库里那个 .unitypackage 必须一字节都没变',
      '散装单包：V5 三列留 NULL（"散装直导"与"容器成员"是两种事实，不许混填）'
    ]
  },
  {
    title: 'X2. 抽取根那道删除闸门撤掉（X 那种传错就真把库里原件删了）',
    file: 'src/main/import/extractRoot.ts',
    from: '  if (!target || !root || !isInsideDir(target, root)) {',
    to: '  if (false) {',
    expect: ['release 拒绝删抽取根之外的任何路径']
  },
  {
    title: 'Y. import 的 journal 带上 assetIds（一次 Ctrl+Z 能删掉用户的卡）',
    file: 'src/main/import/coordinator.ts',
    from: '          label: `导入 ${path.basename(packagePath)} 到 ${path.basename(projectPath)}`',
    to: '          assetIds: assetId ? [assetId] : [],\n          label: `导入 ${path.basename(packagePath)} 到 ${path.basename(projectPath)}`',
    expect: ['撤销只碰 status=ok 的行，且 import/import_rollback 都不许带 assetIds']
  },
  {
    title: 'Y2. import_rollback 的 journal 带上 assetIds',
    file: 'src/main/import/coordinator.ts',
    from: '      label: `撤销导入（${path.basename(logRow.unitypackage_path ?? importId)}）`',
    to: "      assetIds: logRow.asset_id ? [logRow.asset_id] : [],\n      label: `撤销导入（${path.basename(logRow.unitypackage_path ?? importId)}）`",
    expect: ['整批撤销接**真的** rollbackImport：只撤 ok 的行，两条都撤干净']
  },
  {
    title: 'Z. Ctrl+Z 的白名单里加回 import（导一次包就把撤销链钉死）',
    file: 'src/main/db/repos/journal.ts',
    from: "  const OPS = ['move', 'copy', 'extract', 'mkdir', 'rename', 'trash', 'register', 'reparent', 'reanalyze']",
    to: "  const OPS = ['move', 'copy', 'extract', 'mkdir', 'rename', 'trash', 'import', 'register', 'reparent', 'reanalyze']",
    expect: ['Ctrl+Z 不会撞上 import 行（撞上了就是按一次什么都没撤、还把行标成 failed）']
  },
  {
    title: 'AA. 整批撤销排成正序（后覆盖先的，正序撤会把旧内容写回去）',
    file: 'src/main/db/repos/journal.ts',
    from: '        ORDER BY j.id DESC`',
    to: '        ORDER BY j.id ASC`',
    expect: ['整批成功 → 倒序撤销：后导入的那条先撤']
  },
  {
    title: 'AB. 容器三列从 relPath 反推（31 张散装卡全被记成"某容器的成员"）',
    file: 'src/main/import/memberImport.ts',
    from: '      memberRelPath: item.memberRelPath',
    to: '      memberRelPath: item.relPath',
    expect: ['散装单包：V5 三列留 NULL（"散装直导"与"容器成员"是两种事实，不许混填）']
  },
  {
    title: 'AC. 单个 .unitypackage 不再走 loose 分支（被当成压缩包去列成员）',
    file: 'src/main/import/coordinator.ts',
    from: '  if (st.isFile() && /\\.unitypackage$/i.test(p)) {',
    to: '  if (false) {',
    expect: [
      '给单个 .unitypackage → kind=loose，路径能直接用，origin 三列全 null',
      '散装单包：V5 三列留 NULL（"散装直导"与"容器成员"是两种事实，不许混填）'
    ]
  },
  {
    title: 'AD. 单批上限不生效',
    file: 'src/main/import/memberImport.ts',
    from: '  if (picks.length > max) {',
    to: '  if (false) {',
    expect: ['超过 IMPORT_BATCH_MAX → 不开始（闸门在链路里，不在界面里）']
  },
  {
    title: 'AE. 重复回传的成员不去重（同一个包抽两遍、导两遍）',
    file: 'src/main/import/memberImport.ts',
    from: '    if (seen.has(p.relPath)) return false',
    to: '    if (false) return false',
    expect: ['界面重复回传同一条成员 → 只算一份']
  },
  {
    title: 'AF. 一包一条但不串批次（batch_id 断开，"这批"就无从谈起）',
    file: 'src/main/import/memberImport.ts',
    from: '      batchId: plan.batchId,',
    to: '      batchId: null,',
    expect: [
      '压缩包型容器（成员在子目录里）走通，V5 三列记全，副本删干净',
      '一个容器里 8 个成员（正好卡在 IMPORT_BATCH_MAX）全部走通'
    ]
  },
  {
    title: 'AG. abandon 不删副本',
    file: 'src/main/import/memberImport.ts',
    from: '    if (await releaseMemberDir(item.extractDir, plan.extractRoot)) released++',
    to: '    if (false) released++',
    expect: ['abandon 只删自己抽的；抽取根下的目录随之清空']
  },
  {
    title: 'AH. 解析不了那一包时不收回副本（一次失败在盘上留一个壳）',
    file: 'src/main/import/memberImport.ts',
    from: '      if (extractDir) await releaseMemberDir(extractDir, plan.extractRoot)',
    to: '      /* 回退：不收 */',
    expect: ['包里有个假的 .unitypackage → 抽得出来、解析不了，只挡那一条']
  },
  {
    title: 'AH2. 抽不出成员时不收回那一个目录（一次失败在盘上留一个空壳）',
    file: 'src/main/import/memberImport.ts',
    from: '        await drop(dir)',
    to: '        /* 回退：不收 */',
    expect: ['成员真的不在了（重新摄取过）→ 抽不出东西，那条的目录当场收回']
  },
  {
    title: 'AI. 命名空间前缀不剥（长路径写法绕过"绝不落 C 盘"这条红线）',
    file: 'src/main/import/extractRoot.ts',
    from: "  return p.replace(/^[\\\\/]{2}[?.][\\\\/]/, '')",
    to: '  return p',
    expect: ['这种长路径写法照样拒', '是库根，不能因为写法不同就放行']
  },
  {
    title: 'AJ. 进度回调不包 try（界面画挂 = 导入链一起停）',
    file: 'src/main/import/memberImport.ts',
    /** 两处调用一起撤（4 空格那处是 6 空格那处的子串，所以 count=2） */
    from: 'notify(input.onItem, r, i)',
    to: 'input.onItem?.(r, i)',
    count: 2,
    expect: ['进度回调抛错不许把导入链带停']
  },
  // ---------------------------------------------------------------- M5-B ⑥ 预勾与分批
  {
    title: 'AK. 名字匹配退回子串（av 咬住 avatar，一个词勾上一片）',
    file: 'src/shared/memberPick.ts',
    from: '    return /^[\\d.]+$/.test(rest)',
    to: '    return true',
    expect: ['整段相等才算命中：av 不许咬 avatar，pack 不许咬 package']
  },
  {
    title: 'AL. 「命中面太宽就不勾」的闸门撤掉（工程名叫 vrc 时 87 个包全被勾上）',
    file: 'src/shared/memberPick.ts',
    from: '  if (hits > batchMax || (total >= 4 && hits / total >= maxShare)) {',
    to: '  if (false) {',
    expect: [
      '命中数超过一批上限 → **一个都不勾**，并说为什么',
      '命中过半 → 一个都不勾（工程名叫 vrc 时，87 个包个个带 vrc 就是这一种）'
    ]
  },
  {
    title: 'AM. 工程名指纹顺手剥词尾（Orion 剥成 or，某些工程永远预勾不上）',
    file: 'src/shared/memberPick.ts',
    from: "    const noDigits = p.replace(/\\d+$/, '')",
    to: "    const noDigits = p.replace(/(ion|pro|main|test)$/, '').replace(/\\d+$/, '')",
    expect: ['尾部的数字版本号剥掉，但']
  },
  {
    title: 'AN. 分批无视上限（界面切 4 个一批、链路按 8 个算，两边各说各话）',
    file: 'src/shared/memberPick.ts',
    from: '  const size = Math.max(1, Math.floor(max))',
    to: '  const size = Math.max(1, Math.floor(max / 2))',
    expect: ['8 个一批，剩下的进下一批']
  }
  /*
    ⚠ 有意**没有**"面板关掉时不退副本"那一条回退用例：那行在 `stores/ui.ts` 里，
    而本仓库没有 DOM/store 级测试（vitest 是 environment:'node'，没装 jsdom），
    硬编一条断言只会得到一个"看着有覆盖、其实测不到"的绿灯。
    同一件事在链路上是有用例与回退验证的（AG：abandon 只删自己抽的），
    界面这层的点击路径留给 ⑦ 的沙盒活体。
  */
]

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function write(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8')
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
    throw new Error(
      `读不到 vitest 的 JSON 报告（${e.message}）。验证器不能带着空结果往下走。\n退出码 ${code}\n输出：\n${out.slice(-1500)}`
    )
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
let dirty = null
try {
  for (let i = 0; i < CASES.length; i++) {
    if (only && only !== i + 1) continue
    const c = CASES[i]
    const src = read(c.file)
    const want = c.count ?? 1
    const hits = src.split(c.from).length - 1
    if (hits !== want) {
      throw new Error(`${c.title}\n  锚文本在 ${c.file} 里出现 ${hits} 次（要恰好 ${want} 次），拒绝替换`)
    }
    /** 全量替换：一处撤、一处留，测出来的就是"撤了也不红"的假绿 */
    write(c.file, src.split(c.from).join(c.to))
    dirty = { file: c.file, text: src }
    const { failed, total } = runSpec()
    const missed = c.expect.filter((t) => ![...failed].some((f) => f.includes(t)))
    results.push({ title: c.title, red: failed.size, total, missed })
    write(c.file, src)
    dirty = null
    console.log(`  · ${c.title} → 红了 ${failed.size}/${total}`)
  }
} finally {
  if (dirty) write(dirty.file, dirty.text)
}

console.log('\n=== 回退验证结果（期望：每处修复都有对应用例变红）===')
let allOk = results.length > 0
for (const r of results) {
  const ok = r.missed.length === 0 && r.red > 0
  if (!ok) allOk = false
  console.log(`${ok ? '✅' : '❌'} ${r.title} → 红 ${r.red} / ${r.total}`)
  for (const m of r.missed) console.log(`     ⚠ 撤掉修复它也不红，等于没覆盖：${m}`)
}
if (!results.length) console.log('（一条都没跑，检查传进去的编号）')
console.log(allOk ? '\n全部钉住了：每处修复被撤掉都会有用例变红。' : '\n有漏网，先别提交。')
process.exit(allOk ? 0 : 1)
