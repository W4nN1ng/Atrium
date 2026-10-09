/** 只读：把"M5-A 目标各项与其证据"打出来，用于交付前自查 */
const fs = require('node:fs')
const path = require('node:path')

const items = [
  ['文件信箱协议', ['src/main/bridge/mailbox.ts'], ['tests/bridge/mailbox.spec.ts']],
  ['文件信箱时序 + busy 退避', ['src/main/bridge/manager.ts'], ['tests/bridge/manager.spec.ts']],
  ['桥接安装/卸载', ['src/main/bridge/installer.ts'], ['tests/bridge/installer.spec.ts', 'tests/bridge/real-template.spec.ts']],
  ['IPC 接线（白名单对账）', ['src/main/bridge/ipc.ts'], ['tests/renderer/ipc-channels.spec.ts']],
  ['IPC 接线（真实集成）', ['src/main/bridge/ipc.ts'], ['tests/bridge/ipc.spec.ts']],
  ['三路工程探测（锁文件）', ['src/main/project/lockfile.ts'], ['tests/bridge/lockfile.spec.ts']],
  ['三路工程探测（WMI 兜底）', ['src/main/project/wmi.ts'], ['tests/bridge/lockfile.spec.ts']],
  ['三路工程探测（合并）', ['src/main/project/running.ts'], []],
  ['单包导入 / 冲突预扫描 / 撤销', ['src/main/import/coordinator.ts'], ['tests/import/coordinator.spec.ts']],
  ['顶栏工程切换器', ['src/renderer/components/chrome.tsx'], []],
  ['重叠导入流程界面', ['src/renderer/components/ImportFlow.tsx'], []],
  ['C# 桥接包', ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], []],
  ['协议文档 + 已知限制', ['docs/BRIDGE.md'], []],
  ['真包解析回归（./ 前缀 bug）', ['src/main/unpack/unitypackage.ts'], ['tests/classify/unitypackage.spec.ts']]
]

let missing = 0
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)))
console.log(pad('交付项', 34) + pad('实现', 8) + pad('测试', 8) + '测试项数')
console.log('-'.repeat(78))
for (const [name, impls, tests] of items) {
  const implOk = impls.every((p) => fs.existsSync(p))
  const testsOk = tests.every((p) => fs.existsSync(p))
  if (!implOk || !testsOk) missing++
  let n = 0
  for (const t of tests) {
    if (!fs.existsSync(t)) continue
    const src = fs.readFileSync(t, 'utf8')
    n += (src.match(/\n\s*it\(/g) || []).length
  }
  console.log(
    pad(name, 34) + pad(implOk ? 'OK' : '缺失', 8) + pad(tests.length ? (testsOk ? 'OK' : '缺失') : '(真机/CDP)', 8) + (n || '-')
  )
}
console.log('-'.repeat(78))
console.log(missing === 0 ? '所有交付项的实现与测试文件都在' : `有 ${missing} 项缺文件`)

/** 统计测试总数（粗略：it( 出现次数） */
const walk = (d, acc = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.spec.ts')) acc.push(p)
  }
  return acc
}
let total = 0
for (const f of walk('tests')) total += (fs.readFileSync(f, 'utf8').match(/\n\s*it\(/g) || []).length
console.log(`tests/ 下 it() 总数 ≈ ${total}`)
