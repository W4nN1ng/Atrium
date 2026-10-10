#!/usr/bin/env node
/**
 * **第 10 轮的回退验证器**：把本轮六块修复（A 滚动 / B 四颗假按钮 / C 筐摊平 /
 * D 卡名优先级 / E 拖放静默 / F 文案大扫除，外加 #112 那道按库判的刹车）
 * 逐处临时改回旧写法，跑一遍用例，确认它**真的会红**，然后无条件还原。
 *
 * ## 这张表要钉住的三类毛病
 *
 *  1. **判据退化** —— 筐又能做成一张卡、包内名又顶掉磁盘名、拿到 0 个路径又闭嘴。
 *  2. **写好了没人接** —— 本轮新加的 `tagsWithAltName` 就是这一类：判据在 shared、
 *     调用点在 `ingest/api.ts` 的一个大对象字面量里。所以每条判据都配一条"拆掉调用点"的用例。
 *  3. **文案会自己长回来** —— 「在 Mx 交付」这句本轮删了 5 处，而它是写功能时最省事的写法。
 *     光删不钉 = 下周又长出来。F 那三条各有一处反向变异（把旧话术塞回去，用例必须抓到）。
 *
 * ## 用法
 *
 *   node tools/verify-red-r10.cjs          # 全部跑一遍
 *   node tools/verify-red-r10.cjs 7        # 只跑第 7 条
 *
 * ⚠ 它会真的改源文件（跑完立刻还原）。跑之前：`tools/killdev.ps1` → `npm run native:node` → 工作区干净。
 * ⚠ **别和别的重活并行跑**（并发会让那一轮 vitest 起不来 → 红 0 条 → 假报"漏网"）。
 * ⚠ 锚文本：CRLF 的那几份（`ui.ts`/`App.tsx`/`bundle.ts`/`undo.ts`/`Settings 之外的 json`）只用**单行**锚，
 *   多行锚会因 \r 对不上而 0 命中；LF 的那几份才允许多行锚。
 * ⚠ 默认要求锚文本**恰好出现 1 次**；确实要一次改多处的（比如两处落时间戳）传 `count`。
 * ⚠ 跑完 `git status` 必须干净（本工具只碰 src/，不产生垃圾文件）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const VITEST_ENTRY = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const REPORT = path.join(os.tmpdir(), 'avca-verify-red-r10.json')

/** 本轮的判据 + 接线 + 那两条文案闸；顺带整个 tests/classify（C/D 会动分类层，得有旧用例兜着） */
const SPECS = [
  'tests/classify',
  'tests/shared',
  'tests/renderer/r10-container-and-copy.spec.ts',
  'tests/renderer/r10-drop.spec.ts',
  'tests/renderer/auto-remerge-wiring.spec.ts',
  'tests/renderer/i18n.spec.ts',
  'tests/renderer/i18n-hygiene.spec.ts'
]

const BD = 'src/renderer/components/BundleDetail.tsx'
const DO = 'src/renderer/components/DropOverlay.tsx'
const APP = 'src/renderer/App.tsx'
const BU = 'src/main/classify/bundle.ts'
const EN = 'src/main/classify/engine.ts'
const CT = 'src/main/ingest/container.ts'
const NM = 'src/shared/naming.ts'
const API = 'src/main/ingest/api.ts'
const UN = 'src/main/library/undo.ts'
const ST = 'src/renderer/pages/Settings.tsx'
const AR = 'src/shared/autoRemerge.ts'
const UI = 'src/renderer/stores/ui.ts'
const ZH = 'src/renderer/i18n/zh-CN.json'
const JA = 'src/renderer/i18n/ja.json'
const FU = 'src/shared/flattenUnits.ts'

/** @type {Array<{title:string, expect:string[], patches:Array<{file:string,from:string,to:string,count?:number}>}>} */
const CASES = [
  // ---------------------------------------------------------------- A 滚动
  {
    title: 'A1. 容器视图那一层又少了 min-h-0（滚轮按下去没反应、最下面几行永远看不着）',
    patches: [{ file: BD, from: 'className="flex min-h-0 min-w-0 flex-1 flex-col"', to: 'className="flex min-w-0 flex-1 flex-col"' }],
    expect: ['⭐ 组件根那一层带 min-h-0', '旧的那一层写法没有第二处']
  },
  // ---------------------------------------------------------------- B 四颗假按钮
  {
    title: 'B1. 行内那颗「导入」退回 disabled 的假按钮（报障 1 本尊）',
    patches: [
      {
        file: BD,
        from: `<Button className="shrink-0" onClick={() => void importAsset(r.id)} title={t('library.importToUnityHint')}>`,
        to: `<Button className="shrink-0" disabled title={t('library.importToUnityHint')}>`
      }
    ],
    expect: ['⭐ 行内那颗「导入」不再是 disabled']
  },
  {
    title: 'B2. 容器里的双击退回那句过期占位（不吃「双击行为」，和外面两套动作）',
    patches: [
      {
        file: BD,
        from:
          "                  if (settings.doubleClickAction === 'import') void importAsset(r.id)\n                  else if (settings.doubleClickAction === 'reveal') toast('info', t('library.revealHint'))",
        to: "                  toast('info', t('library.importDeferred'))"
      }
    ],
    expect: ['⭐ 行双击吃设置里的「双击行为」', '代码里不许再引用这批 key']
  },
  {
    title: 'B3. 顶部那颗「整包」不预勾成员（面板开了却一个都没勾，等于让用户自己勾 22 下）',
    patches: [
      {
        file: BD,
        from: '                await openMemberPicker(bundleId)\n                pickAllMembers()',
        to: '                await openMemberPicker(bundleId)'
      }
    ],
    expect: ['顶部那颗「整包导入 Unity」不再是假的']
  },
  {
    title: 'B4. 容器里按 Enter 又只弹一句没人接的话（Q1 那条"统一和外面一样"的入口）',
    patches: [
      {
        file: BD,
        from: "        void openMemberPicker(bundleId)\n        toast('info', t('library.memberAllHint'))",
        to: "        toast('bad', t('library.importDeferred'))"
      }
    ],
    expect: ['勾了成员按 Enter 有真动作']
  },
  // ---------------------------------------------------------------- C 筐不成为卡
  {
    title: 'C1. 筐判据恒真（什么都往下摊：卖家的合集被撕成 20 张卡，R2b 那条"不许撕碎一件商品"就破了）',
    patches: [{ file: BU, from: '  return CONTAINER_RE.test(s) && !BUNDLE_NAME_RE.test(s)', to: '  return true' }],
    expect: ['判据本身：计数词是筐', '⭐ 名字写着"合集"的仍然是一张卡', '名字里同时写着"合集"和计数词', '同一件衣服的 20 个素体适配']
  },
  {
    title: 'C1b. 筐判据恒假（`道具22件` 又做成一张合集卡 —— 报障 3 第①件）',
    patches: [{ file: BU, from: '  return CONTAINER_RE.test(s) && !BUNDLE_NAME_RE.test(s)', to: '  return false' }],
    expect: ['判据本身：计数词是筐', '⭐ 拖一个筐进来']
  },
  {
    title: 'C2. 筐判据不看"写着合集"那一半（`插件道具合集22件` 这种两条都命中的名字被摊碎）',
    patches: [{ file: BU, from: '  return CONTAINER_RE.test(s) && !BUNDLE_NAME_RE.test(s)', to: '  return CONTAINER_RE.test(s)' }],
    expect: ['判据本身：计数词是筐', '名字里同时写着"合集"和计数词']
  },
  {
    title: 'C3. 空名字也算筐（null/undefined 进来就往下摊，等于给没有名字的东西随便拆）',
    /** bundle.ts 是 CRLF —— 只能单行锚 */
    patches: [{ file: BU, from: '  if (!s) return false', to: '  if (!s) return true' }],
    expect: ['判据本身：计数词是筐']
  },
  {
    title: 'C4. 引擎不看那道闸（判据写好了、主路径没接 —— 本轮最容易骗过自己的一类）',
    patches: [{ file: EN, from: '      if (isBasketOnlyName(ingest.rawName)) {', to: '      if (false && isBasketOnlyName(ingest.rawName)) {' }],
    expect: ['⭐ 拖一个筐进来']
  },
  {
    title: 'C5. 摊出来的单元还挂着 bundleRef（卡是散的、侧栏又把它们当合集统计一遍）',
    patches: [{ file: EN, from: '        for (const i of items) i.unit.bundleRef = null', to: '        for (const i of items) i.unit.bundleRef = plan.name' }],
    expect: ['⭐ 拖一个筐进来']
  },
  // ---------------------------------------------------------------- D 名字优先级
  {
    title: 'D1. 磁盘名不再优先（他拖 `修女` 进来，出来一张 `Holy Spice Kaguya` —— 报障 3 第②件）',
    patches: [{ file: CT, from: '  const droppedWins = !!droppedClean && !nameIsGarbage(droppedClean)', to: '  const droppedWins = false' }],
    expect: ['⭐ 目录名有信息量 → 主名就是它', 'Booth id + 中文品名']
  },
  {
    title: 'D2. 被压下去的那个名字直接丢了（不写 altName，以后按包内名搜就搜不着）',
    patches: [
      {
        file: CT,
        from: '  const altName = name && fromInside && fromInside !== name ? fromInside : null',
        to: '  const altName: string | null = null'
      }
    ],
    expect: ['⭐ 目录名有信息量 → 主名就是它', 'Booth id + 中文品名']
  },
  {
    title: 'D3. 「太短就算垃圾」那条又没给中日韩留口子（`修女` 两个字被判成没名字）',
    patches: [
      {
        file: NM,
        from: "  if (t.length < 3 && !/[\\u3040-\\u30ff\\u31f0-\\u31ff\\u4e00-\\u9fff\\uac00-\\ud7af]/.test(t)) return true",
        to: '  if (t.length < 3) return true'
      }
    ],
    expect: ['⭐ 目录名有信息量 → 主名就是它']
  },
  {
    title: 'D4. 名字优先级的判据被无条件反转（垃圾名也当主名，§A3 当初治的病放回来）',
    patches: [{ file: CT, from: '  const droppedWins = !!droppedClean && !nameIsGarbage(droppedClean)', to: '  const droppedWins = !!droppedClean' }],
    expect: ['⭐ 反过来：磁盘名是垃圾时仍然用包内主体名']
  },
  {
    title: 'D5. altName 和主名相同时也塞一份（tags 里出现两个一模一样的词）',
    patches: [
      {
        file: CT,
        from: '  const altName = name && fromInside && fromInside !== name ? fromInside : null',
        to: '  const altName = name && fromInside ? fromInside : null'
      }
    ],
    expect: ['altName 和 name 不许相同']
  },
  {
    title: 'D6. tags 那颗判据不去重（同一张卡上塞两个同名标签）',
    patches: [{ file: NM, from: '  if (base.includes(s)) return base', to: '  if (false) return base' }],
    expect: ['主名让位之后，包内名照样进 tags']
  },
  {
    title: 'D7. tags 判据直接改调用方传进来的数组（别处还在用同一份引用，会被串味）',
    patches: [{ file: NM, from: '  const base = tags ? [...tags] : []', to: '  const base = tags ?? []' }],
    expect: ['不许改动调用方传进来的那个数组']
  },
  {
    title: 'D8. ⭐ 判据实现了、调用点没接：api.ts 不再调 tagsWithAltName（界面上照样搜不到那个名字）',
    patches: [{ file: API, from: '      tags: tagsWithAltName(model?.tags, container?.altName),', to: '      tags: model?.tags ?? [],' }],
    expect: ['⭐ 摄取那条路真的调了它']
  },
  // ---------------------------------------------------------------- E 拖放
  {
    title: 'E1. dragover 又不点亮了（指针在窗口里动、高亮一次都不出现）',
    patches: [
      {
        file: DO,
        from: "      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'\n      /** ⭐ 点亮的主路径：以前这里只 preventDefault，高亮灭着也没人管 */\n      light()",
        to: "      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'"
      }
    ],
    expect: ['⭐ onDragOver 里点亮']
  },
  {
    title: 'E2. dragleave 又开始亲手灭高亮（跨子元素时那一拍就是用户读到的"没反应"）',
    patches: [{ file: DO, from: '    seen.current.leave++\n    e.preventDefault()', to: '    seen.current.leave++\n    on.current = false\n    setActive(false)\n    e.preventDefault()' }],
    expect: ['⭐ onDragLeave 里不再熄灭高亮']
  },
  {
    title: 'E3. 老的 depth 计数器回来（两套熄灭逻辑并存，坏的那套说话）',
    patches: [{ file: DO, from: '  const seen = useRef({ enter: 0, over: 0, leave: 0, drop: 0, files: 0 })', to: '  const depth = useRef(0)\n  const seen = useRef({ enter: 0, over: 0, leave: 0, drop: 0, files: 0 })' }],
    expect: ['depth 计数器整个没了']
  },
  {
    title: 'E4. 拿到 0 个本地路径又完全静默（报障 4 本尊：拖进去一点反应也没有）',
    patches: [
      {
        file: DO,
        from: '      if (paths.length) onPaths(paths)\n      /** ⭐ 以前这一句都没有：拿到 0 个路径就当无事发生，用户只能看到"没反应" */\n      else onEmpty?.({ files: files.length, localPaths: paths.length })',
        to: '      if (paths.length) onPaths(paths)'
      }
    ],
    expect: ['drop 的两个出口都会说话', '拿到路径时走 onPaths，没拿到时走 onEmpty']
  },
  {
    title: 'E5. 熄灭窗口拉到 5 秒（拖拽中途自己灭一下，手感发黏）',
    patches: [{ file: DO, from: 'export const DROP_IDLE_MS = 400', to: 'export const DROP_IDLE_MS = 5000' }],
    expect: ['熄灭只看"安静了多久"']
  },
  {
    title: 'E6. 主窗口接了、小窗没接（他日常拖放的另一扇门照旧静默）',
    patches: [{ file: APP, from: 'useDropZone(ingestPaths, onEmpty)', to: 'useDropZone(ingestPaths)', count: 2 }],
    expect: ['⭐ App 的两个 useDropZone 调用点都把 onEmpty 递进去了']
  },
  {
    title: 'E7. store 侧的 onEmpty 不再说话（接线全在、判据全对，就是没人弹那句提示）',
    patches: [{ file: APP, from: "      if (key) toast('warn', t(key))", to: '      if (key) void key' }],
    expect: ['那个 handler 说的是判据决定的那句话']
  },
  {
    title: 'E8. 提示的语气退回 info（一句"没收到文件"用淡灰一闪而过，等于没说）',
    patches: [{ file: APP, from: "      if (key) toast('warn', t(key))", to: "      if (key) toast('info', t(key))" }],
    expect: ['那个 handler 说的是判据决定的那句话']
  },
  {
    title: 'E9. 判据把"带了文件没路径"说成"压根没文件"（两种病根给同一个建议）',
    patches: [
      {
        file: 'src/shared/dropDiagnostics.ts',
        from: "  return info.files > 0 ? 'library.dropNoLocalPath' : 'library.dropNothing'",
        to: "  return 'library.dropNothing'"
      }
    ],
    expect: ['⭐ 带了文件、一个路径都没解析出来']
  },
  {
    title: 'E9b. 反过来把两句说成同一句（拖了个快捷方式也被告知"没拿到本地路径"）',
    patches: [
      {
        file: 'src/shared/dropDiagnostics.ts',
        from: "  return info.files > 0 ? 'library.dropNoLocalPath' : 'library.dropNothing'",
        to: "  return 'library.dropNoLocalPath'"
      }
    ],
    expect: ['⭐ 压根没有文件']
  },
  {
    title: 'E10. 判据拿到了路径也弹"没收到文件"（骗人）',
    patches: [{ file: 'src/shared/dropDiagnostics.ts', from: '  if (info.localPaths > 0) return null', to: '  if (false) return null' }],
    expect: ['⭐ 拿到了路径 → 无话可说', '拿到过路径就闭嘴']
  },
  // ---------------------------------------------------------------- F 文案
  {
    title: 'F1. 主进程那句抛错又预告里程碑（Ctrl+Z 按下去弹"将在 M5 交付"）',
    patches: [
      {
        file: UN,
        from: "      throw new Error('导入的退回走「最近导入 → 退回」那条（要 Unity 在线），不在 Ctrl+Z 里')",
        to: "      throw new Error('导入撤销依赖 Unity 桥接，将在 M5 交付')"
      }
    ],
    expect: ['主进程那句 import 抛错改成了实话，不再预告里程碑']
  },
  {
    title: 'F2. `reason` 里那句硬编码的「M2 手工分类」回来（它显示在详情面板，而不走语言文件）',
    patches: [{ file: API, from: "      reason: model?.reason || '手工分类（没走自动判断）',", to: "      reason: model?.reason || 'M2 手工分类（未走自动分类）'," }],
    expect: ['⭐ 源码里硬编码的用户可见字符串也不许带里程碑编号']
  },
  {
    title: 'F3. 设置页那颗又回到「该功能将在 M7 交付」（本轮刚换成真动作的那一颗）',
    patches: [{ file: ST, from: "{t('settings.openLogDir')}", to: "{t('settings.exportLogs')}" }],
    expect: ['代码里不许再引用这批 key', '代码里用到的每个 key 都存在']
  },
  {
    title: 'F4. 界面里又把内部代号「A」当主语用（第 8 轮改名漏掉的那一族）',
    patches: [
      {
        file: ZH,
        from: '"dropNothing": "这次拖拽没带上文件',
        to: '"dropNothing": "A 不知道这次拖来了什么，'
      }
    ],
    expect: ['⭐ 界面里没有把内部代号「A」当产品名用的文案']
  },
  {
    title: 'F5. 一种语言的文案被删空（三份文件漂了，界面上一片空白）',
    patches: [
      {
        file: JA,
        from:
          '"dropNothing": "このドラッグにはファイルが含まれていません（文字やショートカットの可能性）。エクスプローラーからフォルダをドラッグするか、「受信箱 → ファイルを選択…」を使ってください。"',
        to: '"dropNothing": ""'
      }
    ],
    expect: ['没有空翻译', '返回的键在三份语言文件里都翻得出话']
  },
  // ---------------------------------------------------------------- C 的后半程（登记那一步）
  {
    title: 'H1. 登记只读 units[0]（22 件摊出来只落 1 行 —— 本轮活体抓出来的那条断链）',
    patches: [{ file: API, from: '    if (isFlattenedBasket(flatUnits, !!tree)) {', to: '    if (false) {' }],
    /** "一律索引"那条不归这里：把分支关掉时字符串还在（只是走不到），那条由 H6 专门撤 */
    expect: ['⭐ commit() 里有一条"多单元逐个登记"的分支']
  },
  {
    title: 'H2. 摊出来的单元不带"我在父目录哪一层"（22 件全被记到筐那一层目录上）',
    patches: [{ file: EN, from: '      unit.sourceRelPath = it.relPath', to: '      unit.sourceRelPath = null' }],
    expect: ['⭐ 拖一个筐进来']
  },
  {
    title: 'H3. 源路径那条判据不看单元自己的文件（relPath 缺失时全落在父目录）',
    patches: [{ file: FU, from: '    if (dir) return joinRel(jobSourcePath, dir)', to: '    if (false) return joinRel(jobSourcePath, dir)' }],
    expect: ['⭐ 没标 relPath 时退回"它的第一个文件所在目录"']
  },
  {
    title: 'H4. 逐件登记时又把"整个筐那份容器清单"套上去（名字被筐名盖掉、附属挂 22 遍）',
    patches: [
      {
        file: API,
        from: "          batch,\n          /** 容器那份清单说的是**整个筐**，套到每件上会把全部附属重复挂一遍、还会把名字统一盖成筐名 */\n          null",
        to: '          batch,\n          info'
      }
    ],
    expect: ['⭐ 筐那一层的名字不许盖到每一件上']
  },
  {
    title: 'H5. 第一件的分类被无条件盖给其余那些件（一键入库时 units[0] 拽走整筐）',
    patches: [
      {
        file: API,
        from: '      const pickedCategory = input.category && input.category !== flatUnits[0].category ? input.category : undefined',
        to: '      const pickedCategory = input.category'
      }
    ],
    expect: ['用户没主动改分类时不许把第一件的分类盖给其余那些件']
  },
  {
    title: 'H6. 逐件登记又开始搬盘（一个筐里 22 个子目录各搬各的家，中途出错就是半个库散在两地）',
    patches: [{ file: API, from: "{ ...deps, storageMode: 'indexed' }", to: 'deps' }],
    expect: ['逐件登记一律索引、不搬盘']
  },
  {
    title: 'H7. 收尾只把第一件交给 finishCommit（其余那些件不进检索索引、封面也不做）',
    patches: [{ file: API, from: 'finishCommit(job, primaryId, createdIds, batchId, batch)', to: 'finishCommit(job, primaryId, [primaryId], batchId, batch)' }],
    expect: ['⭐ commit() 里有一条"多单元逐个登记"的分支']
  },
  // ---------------------------------------------------------------- #112 刹车按库判
  {
    title: 'G1. 那道刹车又开始按机器判（换了素材库根，新库里的旧账永远没人收拾）',
    patches: [
      {
        file: AR,
        from: '  const ran = normalizeDirKey(stamp.runRoot)\n  if (!ran) return true\n  return ran === normalizeDirKey(currentRoot)',
        to: '  return true'
      }
    ],
    expect: ['⭐ 换了一套库 → 松开刹车']
  },
  {
    title: 'G2. 老数据（没时间戳）被当成"已跑过"（⑥ 从此在新机器上永远不跑）',
    patches: [{ file: AR, from: '  if (!stamp.runAt) return false', to: '  if (!stamp.runAt) return true' }],
    expect: ['没有时间戳 = 从没跑过']
  },
  {
    title: 'G3. 路径归一化没用（`E:\\vrc\\A` 与 `e:/vrc/a` 判成两套库，改个写法就重跑一遍）',
    patches: [{ file: AR, from: '  return ran === normalizeDirKey(currentRoot)', to: '  return ran === currentRoot' }],
    expect: ['分隔符与大小写不算"换了库"', '尾部斜杠的有无也不该判成两套库']
  },
  {
    title: 'G4. store 又只看时间戳（shared 里那条按库判的判据成了没人调的死代码）',
    patches: [
      {
        file: UI,
        from: '          alreadyRun: remergeAlreadyRun({ runAt: st.autoRemergeRunAt, runRoot: st.autoRemergeRunRoot }, st.libraryRoot),',
        to: '          alreadyRun: !!st.autoRemergeRunAt,'
      }
    ],
    expect: ['⭐ 那道刹车按库判']
  },
  {
    title: 'G5. 落时间戳时不记是哪套库（下一次换库就松不开刹车）',
    patches: [{ file: UI, from: ', autoRemergeRunRoot: st.libraryRoot }', to: ' }', count: 2 }],
    expect: ['⭐ 落时间戳的两条路都连带落库根']
  }
]

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function write(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text)
}

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
        maxBuffer: 64 * 1024 * 1024
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
    for (const p of c.patches) {
      const want = p.count ?? 1
      const src = read(p.file)
      const hits = src.split(p.from).length - 1
      if (hits !== want) {
        for (const s of saved) write(s.file, s.text)
        throw new Error(`${c.title}\n  锚文本在 ${p.file} 里出现 ${hits} 次（要恰好 ${want} 次），拒绝替换`)
      }
      /** 同一文件被一条用例改两次时只留最早那份原文 */
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

console.log('\n=== 第 10 轮回退验证结果（期望：每处修复被撤掉都有用例变红）===')
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
