#!/usr/bin/env node
/**
 * §8-2 的**受控**复测：关掉真编辑器之后，A 到底几秒标退出。
 *
 * 上一轮我判"§8-2 没过"，但漏了一件事没测：**Unity 的进程是不是真的已经没了**。
 * `taskkill`（不带 `/F`）只是发关闭请求，编辑器还在导资源的话可以拖好几分钟，
 * 那期间 A 报"运行中"是对的。所以这一版把两边**同一时刻**的状态都记下来：
 *   左边：`Get-CimInstance` 里还有没有带 `-projectPath` 的 Unity.exe
 *   右边：A 的 `unity:list-projects` 怎么说
 * 只有"进程没了之后 A 还挂着 running:true"才算 §8-2 真红。
 *
 * 用法：node tools/live-s8-close-watch.cjs        # 自己发关闭请求并盯 6 分钟
 *       node tools/live-s8-close-watch.cjs --watch-only   # 不杀，只盯（我已经手动关了）
 */
const cp = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
const BRIDGE = path.join(ROOT, 'projects', 'Shinano-R4LiveTest', 'Temp', 'AVCABridge', 'bridge.json')
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const HERE = path.resolve(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 还有没有"带着 -projectPath 的 Unity.exe"（编辑器），排除 Unity Hub 的 serve */
function editorAlive() {
  const script = [
    'try {',
    "  Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" -ErrorAction SilentlyContinue 2>$null |",
    "    Where-Object { $_.CommandLine -like '*-projectPath*' } |",
    "    ForEach-Object { @($_.ProcessId, $_.CommandLine) -join '|' }",
    '} catch { }'
  ].join('\n')
  const enc = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const out = cp
      .execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
        encoding: 'utf8',
        timeout: 15000
      })
      .trim()
    const line = out.split(/\r?\n/).find((l) => /^\d+\|/.test(l))
    return line ? { alive: true, at: line.slice(0, 90) } : { alive: false, at: null }
  } catch (e) {
    return { alive: null, at: '查询失败：' + e.message.slice(0, 60) }
  }
}

function askA() {
  const expr = `(async () => {
    const l = await window.a.unity.listProjects()
    const p = l.find(x => /R4LiveTest/.test(x.name))
    return JSON.stringify(p ? { running: p.running, by: p.detectedBy } : { missing: true })
  })()`
  try {
    return JSON.parse(
      cp.execFileSync(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], { cwd: HERE, encoding: 'utf8', env: ENV }).trim()
    )
  } catch (e) {
    return { error: String(e.message).slice(0, 60) }
  }
}

async function main() {
  const watchOnly = process.argv.includes('--watch-only')
  let pid = null
  try {
    pid = JSON.parse(fs.readFileSync(BRIDGE, 'utf8')).pid
  } catch {
    /* 已经关了 */
  }
  if (!watchOnly) {
    if (!pid) {
      console.error('读不到 bridge.json 里的 pid（编辑器是不是已经关了？用 --watch-only 只盯不杀）')
      process.exit(1)
    }
    console.log(`发关闭请求给编辑器 pid=${pid}（不带 /F，让它自己收尾）`)
    try {
      console.log('  ' + cp.execSync(`taskkill /PID ${pid}`, { encoding: 'utf8' }).trim())
    } catch (e) {
      console.log('  taskkill：' + String(e.message).slice(0, 90))
    }
  } else {
    console.log('只盯不杀')
  }
  const t0 = Date.now()
  let goneAt = null
  let flippedAt = null
  for (let i = 0; i < 120; i++) {
    const e = editorAlive()
    const a = askA()
    const dt = Math.round((Date.now() - t0) / 1000)
    console.log(`+${dt}s  编辑器=${e.alive === null ? '?' : e.alive ? '在' : '没了'}  A={running:${a.running}, by:${JSON.stringify(a.by || a.error || a.missing)}}`)
    if (e.alive === false && goneAt === null) goneAt = dt
    if (a.running === false && flippedAt === null) flippedAt = goneAt === null ? null : dt - goneAt
    if (flippedAt !== null && dt > 40) break
    await sleep(3000)
  }
  console.log('\n—— 结论 ——')
  console.log('编辑器消失于 +' + goneAt + 's')
  if (goneAt === null) console.log('没等到编辑器消失（Unity 还在关），这一轮判不了')
  else if (flippedAt === null) console.log('❌ 编辑器没了之后 A 仍报 running:true —— §8-2 真红')
  else console.log(flippedAt <= 15 ? `✅ 编辑器消失后 ${flippedAt}s 内 A 标退出（§8-2 这条过）` : `⚠ 标退出太慢：编辑器消失后 ${flippedAt}s`)
}

main().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
