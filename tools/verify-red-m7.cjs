#!/usr/bin/env node
/**
 * **M7 的回退验证器**：把第 7 轮每处修复临时改回旧写法，跑一遍用例，确认它**真的会红**，然后无条件还原。
 *
 * ## 为什么不并进 `verify-red-r4.cjs`
 *
 * 钉的东西不同 —— R4 那张表管"队列状态机 / 单位口径 / 边沿与队列"，这里管
 * **首启门禁的三态、"跳过 ≠ 完成"、接管不许动盘、闸门只有一处、密码绝不写明文**。
 * 两张表塞一起，谁都没法单独跑（本工具一次要跑二十来轮 vitest）。
 *
 * ## 这一轮最值得钉的三类（都是本轮实际犯过或抓到的）
 *
 *  1. **"写好了没人接"** —— `libraryRootOrThrow()` 定义了而全仓零调用、密码库服务如果没人调就是
 *     第二个死服务。所以有几条专门撤调用点、撤注册、撤出队那一句。
 *  2. **"看起来对，其实自己关自己"** —— 门禁判"当前库根空不空"时，第 ① 步落库根会让向导当场消失
 *     （活体撞到的）。这类只能钉"sticky 那半边不许掉"。
 *  3. **"安全的那一步退化成危险的那一步"** —— 加密不可用时退回明文落盘，比不做更坏；
 *     日志里带一次密码，就等于把用户交出来的秘密抄进一个谁都读得到的文件。
 *
 * ## 用法
 *
 *   node tools/verify-red-m7.cjs          # 全部跑一遍
 *   node tools/verify-red-m7.cjs 7        # 只跑第 7 条
 *
 * ⚠ 它会真的改源文件（跑完立刻还原）。跑之前：`tools/killdev.ps1` → `npm run native:node` → 工作区干净。
 *   （dev 实例占着 `better_sqlite3.node`，`native:node` 会**静默失败**，然后整份文件报 ABI 不匹配。）
 * ⚠ **别和别的重活并行跑**（M5-B 实测：并发会让那一轮 vitest 起不来 → 红 0 条 → 假报"漏网"）。
 * ⚠ 锚文本一律**单行**：这批文件两种换行都有（实测 `src/renderer/stores/ui.ts` 是 CRLF，
 *   `src/shared/wizardState.ts` / `src/main/services/*.ts` 是 LF），多行锚有一半会因 \r 对不上而 0 命中。
 * ⚠ 每条 patch 用"锚文本恰好出现 1 次"定位；不唯一就失败。
 * ⚠ 跑完 `git status` 必须干净（本工具只碰 src/，不产生垃圾文件）。
 *
 * ## 第一条被这套表抓到的，是**这张表自己写错**
 *
 * B3 原来一处变异同时 expect 两条用例（"第 ① 步不能跳"+"②③④ 能跳"），跑出来 ① 那条不红 ——
 * 因为把 `step !== 1` 改成恒 false 只会伤到后者。判据是**两个方向**，就得有**两处变异**：
 * 现在 B3 拆掉第 ① 步那道闸（红 3 条），B8 反过来把 ②③④ 也锁死（红 1 条）。
 * 记这条是因为它长得像"用例没覆盖"，其实漏的是这张表的口径。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const VITEST_ENTRY = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const REPORT = path.join(os.tmpdir(), 'avca-verify-red-m7.json')

/** 只跑 M7 这几份用例：一轮要快，且"红的是哪条"必须看得懂 */
const SPECS = [
  'tests/shared/wizard-state.spec.ts',
  'tests/services/library-root-guard.spec.ts',
  'tests/renderer/wizard-wiring.spec.ts',
  'tests/bridge/ask-queue.spec.ts',
  'tests/shared/bridge-ask.spec.ts',
  'tests/services/secrets.spec.ts',
  'tests/services/secrets-wiring.spec.ts',
  'tests/project/bridge-ask-wiring.spec.ts'
]

const W = 'src/shared/wizardState.ts'
const UI = 'src/renderer/stores/ui.ts'
const API = 'src/main/ingest/api.ts'
const SET = 'src/main/services/settings.ts'
const AIPC = 'src/main/ipc/assets.ts'
const Q = 'src/main/bridge/askQueue.ts'
const BR = 'src/main/bridge/ipc.ts'
const PRJ = 'src/renderer/pages/Project.tsx'
const BA = 'src/shared/bridgeAsk.ts'
const SEC = 'src/main/services/secrets.ts'
const VLT = 'src/main/db/repos/passwordVault.ts'

/** @type {Array<{title:string, file?:string, from?:string, to?:string, patches?:Array<{file:string,from:string,to:string}>, expect:string[]}>} */
const CASES = [
  // ---------------------------------------------------------------- 门禁三态
  {
    title: 'A1. 向导永远不出现（全新安装第一屏就进了主界面，拖什么都报错）',
    file: W,
    from: "  return i.startedHere ? 'wizard' : 'main'",
    to: "  return 'main'",
    expect: ['全新安装（启动时库根是空的）→ 画向导']
  },
  {
    title: 'A2. 反过来：门禁不看 startedHere，老用户升级后被拦在向导里',
    file: W,
    from: "  return i.startedHere ? 'wizard' : 'main'",
    to: "  return 'wizard'",
    expect: ['⭐ Q2：老用户（启动时就有库根）即使 onboardingDone=false 也直接放行']
  },
  {
    title: 'A3. startedHere 丢掉 sticky 那半边（第 ① 步落完库根，向导当场把自己关掉）',
    file: UI,
    from: 'wizardStartedHere: get().wizardStartedHere || startedHereFrom(settings.libraryRoot)',
    to: 'wizardStartedHere: startedHereFrom(settings.libraryRoot)',
    expect: ['⭐ startedHere 是 sticky 的']
  },
  {
    title: 'A4. 「稍后配置」写成「已完成」（用户拿到一个"看着配好了、拖什么都报错"的软件）',
    file: W,
    from: 'return { onboardingDone: false, onboardingSkippedAt: nowIso }',
    to: 'return { onboardingDone: true, onboardingSkippedAt: nowIso }',
    expect: ['⭐ skipPatch 绝不写 onboardingDone=true']
  },
  {
    title: 'A5. 跳过之后侧栏不再提示"库还没配好"（改主意的人找不到入口）',
    file: W,
    from: '  return startedHereFrom(libraryRoot)',
    to: '  return false',
    expect: ['⭐ 「稍后配置」之后不再拦人，但仍然提示"库还没配好"']
  },
  {
    title: 'A6. 设置没读回来那一拍也画向导（每次启动闪一下）',
    file: W,
    from: "  if (!i.booted) return 'main'",
    to: "  if (!i.booted) return 'wizard'",
    expect: ['设置还没读回来那一拍不许画向导']
  },
  // ---------------------------------------------------------------- 第 ① 步的判据
  {
    title: 'B1. 探测数不到时当成"空目录"（把 24 GB 的库当空库用的那条路）',
    file: W,
    from: "if (f.supportedFileCount < 0) return 'ask'",
    to: "if (f.supportedFileCount < 0) return 'fresh'",
    expect: ['⭐ 量不到（-1）→ 一律问，不许猜"空的"']
  },
  {
    title: 'B2. 接管那条不再顺手关自动归档（第一次就把他的库 shuffle 一遍）',
    file: W,
    from: "if (choice === 'adopt') return { autoArchive: false }",
    to: "if (choice === 'adopt') return { autoArchive: true }",
    expect: ['⭐ Q3：接管 → autoArchive=false，哪怕原来是 true']
  },
  {
    title: 'B3. 第 ① 步那道硬闸门被拆掉（没库根也放人往下走，进主界面就是一条报错）',
    file: W,
    from: '  if (step !== 1) return true',
    to: '  return true',
    expect: ['第 ① 步：没库根不能走']
  },
  {
    title: 'B4. 库根在 C 盘的警告关掉（Q4 选了"只警告"，警告本身没了）',
    file: W,
    from: "  return !!m && m[1].toLowerCase() === 'c'",
    to: '  return false',
    expect: ['C 盘库根 → 警告']
  },
  {
    title: 'B5. 目录不存在不再拦（带着一个不存在的库根往下走）',
    file: W,
    from: '  return !f.exists',
    to: '  return false',
    expect: ['目录不存在 → fresh，但 directoryUnusable 会先把它拦在第 ① 步']
  },
  {
    title: 'B6. clampStep 不再收脏值（settings.json 被手改成 99 就停在第 99 步）',
    file: W,
    from: '  return WIZARD_STEPS.includes(n as WizardStep) ? (n as WizardStep) : 1',
    to: '  return (n as unknown) as WizardStep',
    expect: ['手改过的 settings.json / 老版本没这个键 → 一律回到第 ① 步']
  },
  {
    title: 'B7. 摘要又把"接管"标成会动磁盘（卡片上刚写完"一个文件都不搬"）',
    file: W,
    from: "if (mode) out.push({ key: 'mode', value: mode, touchesDisk: false })",
    to: "if (mode) out.push({ key: 'mode', value: mode, touchesDisk: mode === 'adopt' })",
    expect: ['⭐ 只有"装了桥接"那条算动盘']
  },
  {
    title: 'B8. 反过来：第 ②③④ 步也不许跳过（规格 01§8 明写第 ③ 步可跳过，把人按在向导里）',
    file: W,
    from: '  if (step !== 1) return true',
    to: '  if (step !== 1) return false',
    expect: ['第 ②③④ 步都能跳过']
  },
  // ---------------------------------------------------------------- 库根闸门
  {
    title: 'C1. 闸门本体被删（函数还在、调用点还在，但什么都不拦）',
    file: SET,
    from: '  if (!root || !root.trim()) throw new Error(',
    to: '  if (false) throw new Error(',
    expect: ['没设过库根 → 抛', '⭐ 只有空格的库根也算没设']
  },
  {
    title: 'C2. 两条写路径改回各写各的（口径散回调用点上）',
    file: API,
    from: 'const libraryRoot = libraryRootOrThrow()',
    to: "const libraryRoot = String(getSettings().libraryRoot ?? '')",
    expect: ['⭐ ingest/api.ts 调了它，而且不再自己写那句文案']
  },
  {
    title: 'C3. 那句文案在第二个文件里又写一遍（"只有一处"那条扫描必须红）',
    file: AIPC,
    from: 'const libraryRoot = libraryRootOrThrow()',
    to: "const libraryRoot = String(getSettings().libraryRoot ?? '还没设置库根目录（设置 → 库）')",
    expect: ['⭐ 那句文案全 src/main 只有一处']
  },
  // ---------------------------------------------------------------- Q10 与出队
  {
    title: 'D1. 「剩下都不再问」写了 never 但不出队（下次刷新又问一遍，等于没答）',
    file: Q,
    from: '    pending.delete(id)',
    to: '    void id',
    expect: ['⭐ 只处理"屏幕上这条之外"的：其余每条 write 一次并出队，队首留着']
  },
  {
    title: 'D2. 连屏幕上那条一起替用户答了（三按钮白给）',
    file: Q,
    from: '  const rest = Array.from(pending.keys()).filter((id) => id !== exceptProjectId)',
    to: '  const rest = Array.from(pending.keys())',
    expect: ['⭐ 只处理"屏幕上这条之外"的：其余每条 write 一次并出队，队首留着']
  },
  {
    title: 'D3. 手动装成桥接不出队（第 7 轮 ④ 活体撞到的那条）',
    file: BR,
    from: '      dropBridgeAsk(id)',
    to: '      void id',
    expect: ['⭐ M7 ④ · **手动**装成桥接也要让那条待答出队']
  },
  {
    title: 'D4. 「当前工程」页装完不摘本地队列（弹窗继续挂着旧事件问）',
    file: PRJ,
    from: '        settleBridgeAsk(p.id)',
    to: '        void p.id',
    expect: ['⭐ M7 ④ · **手动**装成桥接也要让那条待答出队']
  },
  {
    title: 'D5. 只有一条待答时也把「剩下都不再问」摆出来（"剩下"是零，按钮是废话）',
    file: BA,
    from: '  return waiting > 1',
    to: '  return waiting >= 1',
    expect: ['只剩正在答的这一条时不出现']
  },
  // ---------------------------------------------------------------- 密码库
  {
    title: 'E1. ⭐ 加密不可用那道闸关掉（= 明文落盘，比不做更坏）',
    file: SEC,
    from: '  if (!c.available()) {',
    to: '  if (false) {',
    expect: ['⭐ 加密不可用 → 库里一行都没有，返回 unavailable']
  },
  {
    title: 'E2. 空密码也存（下次解出一个空串，看起来像"密码错了"，谁也想不到是没存）',
    file: SEC,
    from: "  if (!password) return 'failed'",
    to: "  if (false) return 'failed'",
    expect: ['空密码 / 文件读不到 → failed（不写库）']
  },
  {
    title: 'E3. 日志里带上密码本身',
    file: SEC,
    from: '    log.info(`[vault] 记住了 ${path.basename(file)} 的密码（${enc.length} 字节密文，${c.algo}）`)',
    to: '    log.info(`[vault] 记住了 ${path.basename(file)} 的密码 ${password}（${enc.length} 字节）`)',
    expect: ['⭐ 密码本身绝不进日志、不进 IPC 返回值']
  },
  {
    title: 'E4. 列表里 readable 永远 false（换机之后那条"解不开"变成"全都解不开"，噪声掩盖真信号）',
    file: SEC,
    from: '        readable = true',
    to: '        readable = false',
    expect: ['列表**不含明文也不含密文**，只说能不能解开']
  },
  {
    title: 'E5. INSERT 参数次序与列次序不一致（item_id 存成路径 → "覆盖"变成每次插一条）',
    file: VLT,
    from: '.run(input.hint, input.passwordEnc, input.platform, input.itemId, input.author)',
    to: '.run(input.hint, input.passwordEnc, input.platform, input.author, input.itemId)',
    expect: ['同一个包再存一次是**覆盖**，不是插两条', '列表**不含明文也不含密文**']
  },
  {
    title: 'E6. 密码库的 IPC 没注册（服务写好了没人接 —— 这仓库的老毛病）',
    file: 'src/main/index.ts',
    from: '  registerSecrets(registrar)',
    to: '  void registerSecrets',
    expect: ['IPC 常量 / handler / 注册 / preload / 界面，五段一段不能少']
  },
  {
    title: 'E7. 摄取链不再试记住的密码（"记住"变成只写不读的死功能）',
    file: API,
    from: 'const saved = recallArchivePassword(getDb(), job.item.sourcePath)',
    to: 'const saved = null as string | null',
    expect: ['⭐ 摄取链真的会**用**记住的密码']
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
