/**
 * 真库**只读**：⑥ 那个"自动并完"装到他机器上、第一次启动时**到底会并几处**。
 *
 * ## 为什么必须先量这个
 *
 * 2026-10-10 下午他批了"升级后自动并完 + 事后告知"，紧接着问"为什么我本地那件衣服还散着"。
 * 装了含 ⑥ 的版本之后，**第一次启动就会自己动他库里的账** —— 判据里那道"向导开着不跑"
 * 拦不住他（`wizardState.ts:63-69`：库根非空 = 老用户 = 直接放行主界面）。
 * 所以"会动多少"这个数字必须在装之前拿到，不能等告知条弹出来才知道。
 *
 * ## 用法（默认跳过，要显式点头才读真库）
 *
 *   AVCA_REMERGE_PREVIEW=1 npx vitest run tests/real/realdb-remerge-preview.spec.ts
 *
 * 全程 `readonly: true`；跑完核对库文件字节数与 mtime 没变（和 `realdb-key-rescan.spec.ts` 同一套护栏）。
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
// vite 解析不了 node:sqlite，用仓库自带的 better-sqlite3
import Database from 'better-sqlite3'
import { planRemerge } from '../../src/main/library/remerge'
import { loadLexicon } from '../../src/main/classify/lexicon'
import type { Db } from '../../src/main/db'

const DB = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'A', 'library.db')
const USER_LEX = path.join(path.dirname(DB), 'lexicon.user.json')
const GO = process.env.AVCA_REMERGE_PREVIEW === '1'

describe.skipIf(!GO)('真库只读 · ⑥ 自动并完会动几处', () => {
  it('打印簇数与每一簇的形状，并证明扫描本身不改一行', () => {
    if (!fs.existsSync(DB)) {
      console.log(' 真库不在，跳过：' + DB)
      expect(1).toBe(1)
      return
    }
    const before = fs.statSync(DB)
    const db = new Database(DB, { readonly: true })
    const lex = loadLexicon({
      builtin: path.join(process.cwd(), 'resources', 'lexicon', 'lexicon.json'),
      user: fs.existsSync(USER_LEX) ? USER_LEX : null
    })
    const plan = planRemerge(db as unknown as Db, lex)
    console.log('人口（顶层、非合集、非附属）：' + plan.scanned + ' 张')
    console.log('⑥ 会并的簇：' + plan.clusters.length + ' 处　歧义闸门挡掉：' + plan.skippedAmbiguous + ' 处')
    let moved = 0
    for (const c of plan.clusters) {
      moved += c.moveAssetIds.length
      console.log(`   「${c.name}」 ${c.rows.length} 张 → 键 ${c.groupKey}　改挂 ${c.moveAssetIds.length} 张 / 合并掉 ${c.dropGroupIds.length} 个组${c.keepGroupId ? '' : '（要新建组）'}`)
      for (const r of c.rows.slice(0, 6)) console.log(`      ${(r.fromKey ?? '(无组)').padEnd(44)} → ${r.toKey}　${r.name}`)
      if (c.rows.length > 6) console.log(`      …还有 ${c.rows.length - 6} 张`)
    }
    console.log('合计改挂：' + moved + ' 张卡（这就是界面上会"少掉"的卡数）')
    db.close()

    const after = fs.statSync(DB)
    expect(after.size, '只读扫描把库文件改大了 —— 立刻停手').toBe(before.size)
    expect(after.mtimeMs, '只读扫描碰过库文件的 mtime —— 立刻停手').toBe(before.mtimeMs)
  })
})
