/**
 * M6 交付自查（**只读**，不写任何东西）。
 *
 * 和 `selfcheck-m5a/m5b.cjs` 一个套路：把"这一里程碑声称做了什么、证据在哪"打成一张表，
 * 缺文件就报错。**没有测试的项一律标 (无自动化用例)**，不许混在"有测试"里充数 ——
 * M6 最容易虚报的两处：① 渲染层零 DOM 测试（横幅/侧栏入口的"画法"）；
 * ② 沙盒活体用的是**假 Unity**，真 Unity 那条分支不能算验过。
 *
 * 用法：node tools/selfcheck-m6.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')

const items = [
  // ---------------------------------------------------------------- ① 匹配纯函数
  ['匹配口径全在纯函数里（工程 ↔ 集合，主进程只做取数）', ['src/shared/projectMatch.ts'], ['tests/shared/project-match.spec.ts']],
  ['归一化复用同一个 fold + searchForms（罗马字/拼音/假名互通）', ['src/shared/normalize.ts', 'src/shared/projectMatch.ts'], ['tests/shared/project-match.spec.ts']],
  ['token 资格：ASCII ≥3 / CJK ≥2 / 纯数字不算身份', ['src/shared/projectMatch.ts'], ['tests/shared/project-match.spec.ts']],
  ['通用词判据：命中**全部**已知工程才叫什么都没说（活体改过的那条）', ['src/shared/projectMatch.ts'], ['tests/shared/project-match.spec.ts']],
  ['Q1 平手绝不硬选，候选名单带回去（留痕的一半）', ['src/shared/projectMatch.ts', 'src/main/project/autoSwitch.ts'], ['tests/shared/project-match.spec.ts', 'tests/project/auto-switch.spec.ts']],
  ['"以后都这样"：精确路径优先于一切关键词，写法不同也算同一个', ['src/shared/projectMatch.ts', 'src/shared/pathkey.ts'], ['tests/shared/project-match.spec.ts']],
  // ---------------------------------------------------------------- ② 指纹采集
  ['工程指纹四段 + 上限记账（撞线要说 capped）', ['src/main/project/fingerprint.ts'], ['tests/project/fingerprint.spec.ts']],
  ['Q5 桥接按 bridgeVersion 降级（不许假设都装了新版）', ['src/main/project/fingerprint.ts'], ['tests/project/fingerprint.spec.ts']],
  ['"没回"和"没有"分开记；采指纹永不抛（挂在 3 秒轮询上）', ['src/main/project/fingerprint.ts'], ['tests/project/fingerprint.spec.ts']],
  ['指纹落 project.fingerprint_json（走 upsert，不抹 is_running）', ['src/main/project/fingerprint.ts', 'src/main/db/repos/unity.ts'], ['tests/project/fingerprint.spec.ts']],
  // ---------------------------------------------------------------- ③ 边沿触发 + 冷却
  ['只在"未运行 → 运行中"的边沿上决策', ['src/main/project/api.ts'], ['tests/project/auto-switch.spec.ts']],
  ['三档 autoSwitchBehavior 真被读，而且每轮重读（M1 起的死字段）', ['src/main/project/api.ts', 'src/main/project/autoSwitch.ts'], ['tests/project/auto-switch.spec.ts']],
  ['⚠隐患 B：冷却只在真切换时写；skip 之后真实命中仍能切', ['src/main/project/autoSwitch.ts'], ['tests/project/auto-switch.spec.ts']],
  ['冷却落库（schema V6 那一列）+ SCHEMA_VERSION 不变量', ['src/main/db/schema.ts', 'src/main/db/repos/unity.ts'], ['tests/db/migration-v6.spec.ts', 'tests/project/auto-switch.spec.ts']],
  ['每一次决策都留一行日志（switch 说凭什么，skip 说为什么没切）', ['src/main/project/autoSwitch.ts'], ['tests/project/auto-switch.spec.ts']],
  // ---------------------------------------------------------------- ④ 补建（第一入口）
  ['⚠隐患 A：按库里出现过的模型补建 = 第一入口，排在横幅之前能用', ['src/renderer/components/chrome.tsx', 'src/renderer/components/ModelBackfillDialog.tsx'], []],
  ['补建数据源：variant ∪ tag（只看一处就会漏掉只打标签的那批）', ['src/main/library/modelCollections.ts'], ['tests/library/model-backfill.spec.ts']],
  ['预览只读 → 确认才写库；apply 只认预览名单（后门闸门）', ['src/main/library/modelCollections.ts', 'src/shared/modelCollections.ts'], ['tests/library/model-backfill.spec.ts', 'tests/shared/model-collections.spec.ts']],
  ['通用值不建但留痕 / 平票不取全大写 / 已建过的不重复建', ['src/shared/modelCollections.ts'], ['tests/shared/model-collections.spec.ts']],
  ['补建预览的三种状态（loading / ready / 空手而归说清为什么）', ['src/shared/backfillState.ts'], ['tests/shared/backfill-state.spec.ts']],
  ['一次补建一条 journal，Ctrl+Z 整批退回；只按 id 删、挂了素材的不删', ['src/main/db/repos/journal.ts', 'src/main/library/undo.ts'], ['tests/library/model-backfill.spec.ts']],
  // ---------------------------------------------------------------- ⑤ 横幅
  ['横幅判据全在纯函数里，组件只做薄壳映射', ['src/shared/bannerState.ts', 'src/renderer/components/ProjectBanner.tsx'], ['tests/shared/banner-state.spec.ts']],
  ['R-52：切视图不清搜索框，横幅多一句「仍在搜索…」', ['src/renderer/stores/ui.ts', 'src/shared/bannerState.ts'], ['tests/renderer/auto-switch-store.spec.ts', 'tests/shared/banner-state.spec.ts']],
  ['Q4（偏离规格原文）：busy = 有模态框 / 正在拖拽 / 导入在跑 → 不切但要说', ['src/renderer/stores/ui.ts'], ['tests/renderer/auto-switch-store.spec.ts']],
  ['10 秒淡出 + 固定不淡（数字单独钉了一条）', ['src/shared/bannerState.ts'], ['tests/shared/banner-state.spec.ts']],
  ['三按钮语义：换个集合只切视图不改规则 / 以后都这样写 projectPaths', ['src/renderer/stores/ui.ts'], ['tests/renderer/auto-switch-store.spec.ts']],
  // ---------------------------------------------------------------- ⑥ 托盘唤醒 + Q3
  ['Q6：托盘唤醒置顶 1.2 秒，取消置顶走 finally', ['src/main/window.ts', 'src/shared/constants.ts'], ['tests/renderer/auto-switch-store.spec.ts']],
  ['Q3：开机自启保持 false，只在应用内问一次，绝不动系统启动项', ['src/shared/bannerState.ts', 'src/renderer/components/AutoLaunchAsk.tsx'], ['tests/shared/banner-state.spec.ts', 'tests/renderer/auto-switch-store.spec.ts']],
  ['wake 注入而不是静态 import window.ts（node 环境会炸）', ['src/main/project/api.ts', 'src/main/index.ts'], ['tests/renderer/auto-switch-store.spec.ts']],
  // ---------------------------------------------------------------- 接线与活体
  ['IPC 通道 unity:auto-switch 在 preload 白名单里且界面真订阅了', ['src/shared/ipc.ts', 'src/renderer/stores/ui.ts'], ['tests/renderer/ipc-channels.spec.ts', 'tests/renderer/auto-switch-store.spec.ts']],
  ['沙盒活体（2026-10-06：唯一命中 / 5 分钟冷却 / 平手留痕 三个用例都有图）', ['tools/live-m6-banner-shot.cjs', 'tools/fake-unity-live.cjs', 'docs/screenshots/m6-banner-ambiguous.png'], []],
  ['活体一律带 AVCA_APP_HOME（不生效就会写到真库）', ['src/main/services/paths.ts'], ['tests/services/app-home.spec.ts']],
  ['三语文案（新增 key 全部走 add-i18n-keys）', ['src/renderer/i18n/zh-CN.json', 'src/renderer/i18n/en.json', 'src/renderer/i18n/ja.json'], ['tests/renderer/i18n.spec.ts']],
  ['文档：桥接降级口径 + 沙盒活体 + 仍未验证清单', ['docs/BRIDGE.md', 'docs/M6-DESIGN.md'], ['tests/docs.spec.ts']],
  ['回退验证器（46 处修复，每处撤掉都有用例变红）', ['tools/verify-red-m6.cjs'], []]
]

/** 数一个 spec 文件里的用例数 */
function cases(rel) {
  const p = path.join(REPO, rel)
  if (!fs.existsSync(p)) return -1
  return (fs.readFileSync(p, 'utf8').match(/\bit(?:\.\w+)?\s*\(/g) || []).length
}

/** 中文按两格宽对齐（否则表格会歪） */
function pad(s, n) {
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)
  return s + ' '.repeat(Math.max(0, n - w))
}

let bad = 0
const untested = []
console.log(pad('交付项', 62) + pad('实现', 8) + pad('测试', 26))
console.log('-'.repeat(104))
for (const [name, impls, tests] of items) {
  const missImpl = impls.filter((p) => !fs.existsSync(path.join(REPO, p)))
  const missTest = tests.filter((p) => cases(p) < 0)
  const n = tests.reduce((a, t) => a + Math.max(0, cases(t)), 0)
  if (missImpl.length || missTest.length) bad++
  if (!tests.length) untested.push(name)
  console.log(
    pad(name, 62) +
      pad(missImpl.length ? '缺 ' + missImpl.join(',') : 'OK', 8) +
      (tests.length ? (missTest.length ? '缺文件' : pad(String(n) + ' 项', 26)) : pad('(无自动化用例)', 26))
  )
}
console.log('-'.repeat(104))
if (untested.length) {
  console.log('没有自动化用例、只能靠沙盒活体或人点的项：')
  for (const u of untested) console.log('  · ' + u)
}
console.log(
  [
    '',
    '真机待验（沙盒证明不了的一批，别当已验证）：',
    '  · 真 Unity：桥接 ≥1.1.0 时 topFolders / avatarDescriptors 那一支（假 Unity 报 1.0.0-live，走的是 bridgeTooOld）',
    '  · 托盘唤醒置顶 1.2 秒：沙盒里窗口一直可见，走的是 already-visible 早退分支（Q6 明说这条只算"写完了"）',
    '  · 「以后都这样」之后第二次打开同一个工程按路径命中（写入与去重有用例，真机没点过）',
    '  · §8-9 / 10 / 11 / 14 / 15 那几条规格验收（沙盒形状对得上，真库 9 个工程的 Assets 顶层目录数没数过）',
    '  · 横幅/补建面板的"画法"（渲染层零 DOM 测试，只有截图）'
  ].join('\n')
)
console.log(bad ? `\n有 ${bad} 项的证据文件缺失，别当交付完成。` : '\n证据文件都在。未验证的项上面已单独列出，不算通过。')
process.exit(bad ? 1 : 0)
