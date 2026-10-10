/**
 * 真库**只读**：他这两个库根里到底有多少个"名字就是筐"的目录，按 C 的新判据各会摊出多少张卡。
 *
 * ## 为什么要先数这个再动手
 *
 * 第 10 轮 C 要把"目录名自己是筐"（`道具22件`、`ERP用12件`、`更新`、`重要！`）从
 * "做成一张合集卡"改成"往下摊平一层"。这条改判的影响面积**完全取决于他盘上有多少这种目录、
 * 每个里面有多少孩子** —— 一次能多出来几十张卡，也可能一处都没有。
 * 不量就改，等于闭着眼睛改判据。
 *
 * ## 用法（默认跳过）
 *
 *   AVCA_CONTAINER_SCAN=1 npx vitest run tests/real/container-dirs-scan.spec.ts
 *
 * 只读：只 `readdirSync`，不写、不移、不删。判据**从产品代码里 import**（`isCollectionName`），
 * 不在测试里另抄一份正则 —— 同一个规则写两遍必漂，这条在 M5-3 一天内犯过两次。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isCollectionName } from '../../src/main/classify/bundle'

const ROOTS = ['E:/vrc/A', 'E:/Atriumdate']
const MAX_DEPTH = 4
const GO = process.env.AVCA_CONTAINER_SCAN === '1'

interface Hit {
  dir: string
  depth: number
  kids: number
  kidDirs: number
  kidArchives: number
}

function scan(root: string, depth: number, out: Hit[]): void {
  if (depth > MAX_DEPTH) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  const archives = entries.filter((e) => e.isFile() && /\.(zip|rar|7z|unitypackage)$/i.test(e.name))
  if (isCollectionName(path.basename(root)) && dirs.length + archives.length >= 2) {
    out.push({ dir: root, depth, kids: dirs.length + archives.length, kidDirs: dirs.length, kidArchives: archives.length })
  }
  for (const d of dirs) scan(path.join(root, d.name), depth + 1, out)
}

describe.skipIf(!GO)('真库只读 · "名字就是筐"的目录有多少', () => {
  it('列出每一处，并给出按新判据会摊出多少项', () => {
    let total = 0
    for (const root of ROOTS) {
      if (!fs.existsSync(root)) {
        console.log(root + '  不在，跳过')
        continue
      }
      const hits: Hit[] = []
      scan(root, 1, hits)
      console.log(`\n=== ${root}：${hits.length} 处"筐"目录`)
      for (const h of hits.slice(0, 40)) {
        console.log(`   d${h.depth} ${h.kids} 项（目录 ${h.kidDirs} / 包 ${h.kidArchives}）　${h.dir}`)
      }
      if (hits.length > 40) console.log(`   …还有 ${hits.length - 40} 处`)
      total += hits.reduce((a, h) => a + h.kids, 0)
      console.log('   按新判据最多摊出：' + hits.reduce((a, h) => a + h.kids, 0) + ' 项')
    }
    console.log('\n两个库合计最多摊出：' + total + ' 项')
    /** 这条断言防的是"扫描器自己坏了报 0"：他盘上至少该有 `道具22件` 这一处（2026-10-10 亲眼见过） */
    expect(total > 0, '一处都没扫到 —— 大概率是扫描器或路径不对，不是真没有').toBe(true)
  })
})
