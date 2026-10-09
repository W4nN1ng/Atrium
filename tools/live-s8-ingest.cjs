#!/usr/bin/env node
/**
 * §8 真 Unity 这一轮：把重造过的 5 个 .unitypackage 登记进沙盒库（只登记、不动盘）。
 * 用法：AVCA_CDP_PORT=9225 node tools/live-s8-ingest.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
if (!/avca-r4-live$/i.test(path.basename(ROOT))) {
  console.error('拒绝：沙盒根目录名不对（' + ROOT + '）')
  process.exit(1)
}
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const HERE = path.resolve(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ej = (expr) => {
  const raw = cp
    .execFileSync(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], { cwd: HERE, encoding: 'utf8', env: ENV, maxBuffer: 16 * 1024 * 1024 })
    .trim()
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const CARDS = [
  'library/道具/Shinano_Hair.unitypackage',
  'library/道具/Shinano_Face.unitypackage',
  'library/服装/Manuka_Dress.unitypackage',
  'library/贴图/Milfy_Makeup.unitypackage',
  'library/着色器/Liltoon_Shader.unitypackage'
].map((p) => path.join(ROOT, p))

async function main() {
  for (const f of CARDS) if (!fs.existsSync(f)) throw new Error('包不在：' + f)
  const ing = ej(`(async () => JSON.stringify(await window.a.ingest.fromPaths(${JSON.stringify(CARDS)})))()`)
  console.log('摄取：' + JSON.stringify(ing))
  let jobs = []
  for (let i = 0; i < 40; i++) {
    jobs = ej(`(async () => JSON.stringify((await window.a.ingest.queue() || []).map(j => ({ id: j.jobId, name: j.item && j.item.name, stage: j.stage }))))()`)
    if (Array.isArray(jobs) && jobs.length >= 5 && jobs.every((j) => j.stage === 'awaiting_confirm')) break
    await sleep(1500)
  }
  console.log('队列：' + JSON.stringify(jobs))
  const ids = (Array.isArray(jobs) ? jobs : []).filter((j) => j.stage === 'awaiting_confirm').map((j) => j.id)
  const c = ej(`(async () => JSON.stringify(await window.a.ingest.commitAll({ jobIds: ${JSON.stringify(ids)}, move: false })))()`)
  console.log('入库（只登记）：' + JSON.stringify(c))
  await sleep(3000)
  const cards = ej(`(() => { location.hash=''; return JSON.stringify({ nav: 'ok' }) })()`)
  console.log('收尾：' + JSON.stringify(cards))
}

main().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
