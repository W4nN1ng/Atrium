/**
 * M5-B 交付自查（**只读**，不写任何东西）。
 *
 * 和 `selfcheck-m5a.cjs` 一个套路：把"这一里程碑声称做了什么、证据在哪"打成一张表，
 * 缺文件就报错。**没有测试的项一律标 (无自动化用例)**，不许混在"有测试"里充数 ——
 * 这一版最容易虚报的就是界面那部分（本仓库渲染层零 DOM 测试）。
 *
 * 用法：node tools/selfcheck-m5b.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')

const items = [
  ['定点抽取层（永不整包解压 / 返回 localPath）', ['src/main/unpack/members.ts', 'src/main/unpack/entryMatch.ts'], ['tests/unpack/members.spec.ts']],
  ['容器成员清单（stat 优先 / 两个上限记账 / 只钻一层）', ['src/main/import/containerPackages.ts'], ['tests/import/container-packages.spec.ts']],
  ['抽取根 + 三道硬闸门（库内 / C 盘 / 空间）在落盘之前', ['src/main/import/extractRoot.ts'], ['tests/import/extract-root.spec.ts']],
  ['命名空间写法不绕闸门（\\\\?\\C:\\ 实测能写）', ['src/main/import/extractRoot.ts'], ['tests/import/extract-root.spec.ts']],
  ['releaseMemberDir 只删抽取根之内（库里原件的护身符）', ['src/main/import/extractRoot.ts'], ['tests/import/extract-root.spec.ts', 'tests/import/member-import.spec.ts']],
  ['主链路：抽取 → 预扫描 → 串行导入 → 记账 → 清副本', ['src/main/import/memberImport.ts'], ['tests/import/member-import.spec.ts']],
  ['失败停下不自动回滚 + "未执行"如实分开报', ['src/main/import/memberImport.ts'], ['tests/import/member-import.spec.ts']],
  ['一包一条 import_log + batch_id + V5 三列', ['src/main/db/schema.ts', 'src/main/db/repos/journal.ts'], ['tests/db/migration-v5.spec.ts', 'tests/import/member-import.spec.ts']],
  ['整批倒序撤销（顺序借 journal.id，不靠 ULID 比大小）', ['src/main/db/repos/journal.ts'], ['tests/import/member-import.spec.ts']],
  ['Ctrl+Z 不撞 import 行；撤销 journal 不带 assetIds', ['src/main/db/repos/journal.ts', 'src/main/import/coordinator.ts'], ['tests/import/member-import.spec.ts']],
  ['IPC 六条新通道接真 BridgeManager + FakeUnity', ['src/main/bridge/ipc.ts'], ['tests/bridge/ipc.spec.ts', 'tests/renderer/ipc-channels.spec.ts']],
  ['成员选择面板的状态转移（关窗退副本 / 一次一批 / 顺序 / 闸门原因上屏）', ['src/renderer/stores/ui.ts'], ['tests/renderer/member-picker-store.spec.ts']],
  ['成员选择面板的画法（列表 / 勾选框 / 两张卡）', ['src/renderer/components/MemberPicker.tsx'], []],
  ['沙盒活体（2026-10-06 真程序点过：三步 + 冲突展开 + 取消退副本 + 整批退回倒序）', ['tools/fake-unity-live.cjs', 'tools/make-m5b-live-tree.cjs', 'tools/probe-m5b-live-state.cjs'], []],
  ['闸门话术的插值占位符写法（{name} 会原样显示在界面上）', ['src/renderer/i18n/zh-CN.json'], ['tests/renderer/i18n.spec.ts']],
  ['活体用的运行时目录重定向 AVCA_APP_HOME（不生效就会写到真库）', ['src/main/services/paths.ts'], ['tests/services/app-home.spec.ts']],
  ['预勾只按名字匹配 + 太宽就不勾（纯函数）', ['src/shared/memberPick.ts'], ['tests/shared/member-pick.spec.ts']],
  ['三语文案（新增 key 全部走 add-i18n-keys）', ['src/renderer/i18n/zh-CN.json', 'src/renderer/i18n/en.json', 'src/renderer/i18n/ja.json'], ['tests/renderer/i18n.spec.ts']],
  ['协议文档 + 临时副本生命周期 + 数据落在哪', ['docs/BRIDGE.md'], ['tests/docs.spec.ts']],
  ['设计文档（十问十答 + 落地后的偏离记录）', ['docs/M5B-DESIGN.md'], []]
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
let untested = []
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
console.log(bad ? `\n有 ${bad} 项的证据文件缺失，别当交付完成。` : '\n证据文件都在。未验证的项上面已单独列出，不算通过。')
process.exit(bad ? 1 : 0)
