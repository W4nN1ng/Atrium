/**
 * 活体调试用：从 DOM 的 React fiber 往上爬，把 zustand 里 `memberPicker` 那块状态挖出来打印。
 *
 * 为什么要有这个：渲染层零 DOM 测试，而"主进程把参数发过来了、界面上却没插值"
 * 这种问题只有站在**运行时**看才分得清是 IPC 掉了还是 store 掉了（2026-10-06 沙盒活体
 * 就撞上一个：闸门文案里的 `{extractRoot}` 原样显示）。
 *
 * 用法（配合 dev 的 --remote-debugging-port）：
 *   node tools/cdp-eval.cjs "$(cat tools/dump-member-picker-state.cjs | tr -d '\n')"
 * 或者直接：AVCA_CDP_PORT=9223 node tools/dump-member-picker-state.cjs
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const EXPR = `(async () => {
  const want = ['open','assetId','packages','picked','reasons','plan','outcome','queue','running','reasonKey','reasonParams','loading','containerName']
  const seen = new Set()
  let out = null
  const roots = []
  for (const el of document.querySelectorAll('*')) {
    for (const k of Object.keys(el)) {
      if (k.startsWith('__reactFiber$')) { let f = el[k]; while (f && f.return) f = f.return; roots.push(f) }
    }
  }
  const stack = roots
  while (stack.length && !out) {
    const f = stack.pop()
    if (!f || seen.has(f)) continue
    seen.add(f)
    let h = f.memoizedState
    let guard = 0
    while (h && guard++ < 40) {
      const v = h.memoizedState
      if (v && typeof v === 'object' && want.every((k) => k in v)) { out = v; break }
      h = h.next
    }
    if (f.child) stack.push(f.child)
    if (f.sibling) stack.push(f.sibling)
  }
  if (!out) return '没在 fiber 里找到 memberPicker 状态'
  return JSON.stringify({
    open: out.open, reasonKey: out.reasonKey, reasonParams: out.reasonParams,
    plan: !!out.plan, outcome: !!out.outcome, queue: out.queue, picked: out.picked, running: out.running
  })
})()`

const port = process.env.AVCA_CDP_PORT || '9222'
const script = path.join(process.cwd(), 'tools', 'cdp-eval.cjs')
console.log(
  execFileSync(process.execPath, [script, EXPR], { encoding: 'utf8', env: { ...process.env, AVCA_CDP_PORT: port } })
)
void fs
