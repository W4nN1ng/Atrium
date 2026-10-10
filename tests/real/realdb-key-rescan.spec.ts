/**
 * 真库**只读**：拿现在的键规则把全部顶层卡重算一遍，量 B4 存量重并的**真实作用面积**。
 *
 * ## 为什么会要这么个东西
 *
 * `docs/PROMPT-R9-REVIEW-MERGE.md` §一 写的根因是"词表不认的模型名留在了归并键里"，
 * 并据此排了 B1（改判据）→ B2（学模型名）→ B4（重并存量）。2026-10-10 拿真库量完，
 * 三条都不成立：
 *
 *  - **判据已经是对的**：20 个 Libero 名字现在的代码全认得，算出来是**同一个键**；
 *  - **库里存的键违反"键与变体一致"的组：0 组**（那 12 张散卡的变体值是 `UNIVERSAL`，不是模型名）；
 *  - **`variantUnknown` 全库 0 行** —— B2 那台"从同族位置学模型名"的机器，目标人群是空集。
 *
 * 也就是说症状 100% 出在**存量**：键规则在 §B2/§B3 之后就修好了，可老行没人重算
 * （`reanalyze.ts` 的 `recompute()` 刻意只改 name/version/variant_raw，**不动 group_key**）。
 * 这个结论决定 ② 做什么，所以留在仓里可复跑，别让它只活在一次对话里。
 *
 * ## 用法（默认跳过，要显式点头才读真库）
 *
 *   AVCA_KEY_RESCAN=1 npx vitest run tests/real/realdb-key-rescan.spec.ts
 *
 * 全程 `readonly: true`，一个字都不写；跑完还会核对库文件字节数与 mtime 没变。
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
// vite 解析不了 node:sqlite（"Failed to load url sqlite"），这里用仓库自带的 better-sqlite3
import Database from 'better-sqlite3'
import { deriveGroupKey } from '../../src/main/classify/groupKey'
import { loadLexicon } from '../../src/main/classify/lexicon'

const DB = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'A', 'library.db')
const USER_LEX = path.join(path.dirname(DB), 'lexicon.user.json')
const GO = process.env.AVCA_KEY_RESCAN === '1'

describe.skipIf(!GO)('真库只读 · 键规则重算一遍会塌出什么', () => {
  it('打印四组数字，并证明扫描本身不改一行', () => {
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
    const rows = db
      .prepare(
        `SELECT a.id, a.name, a.raw_name, a.group_id, g.group_key, g.dir_key,
                (SELECT group_concat(v.variant_value, '|') FROM variant v
                  WHERE v.group_id = a.group_id AND v.variant_kind='avatar') av_variants
           FROM asset a LEFT JOIN asset_group g ON g.id = a.group_id
          WHERE a.parent_asset_id IS NULL AND a.is_bundle = 0 AND a.attachment_kind IS NULL`
      )
      .all() as unknown as Array<{
      id: string
      name: string
      raw_name: string | null
      group_id: string | null
      group_key: string | null
      dir_key: string | null
      av_variants: string | null
    }>

    /** ① 存量违反"键与变体一致"的组 */
    const badGroups = new Map<string, { key: string; models: string[]; n: number }>()
    for (const r of rows) {
      if (!r.group_key || !r.av_variants) continue
      const models = r.av_variants.split('|').filter(Boolean)
      const inside = models.filter((m) => r.group_key!.toLowerCase().split(' ').includes(m.toLowerCase()))
      if (inside.length) {
        const cur = badGroups.get(r.group_key!) ?? { key: r.group_key!, models: [], n: 0 }
        cur.n++
        for (const m of inside) if (!cur.models.includes(m)) cur.models.push(m)
        badGroups.set(r.group_key!, cur)
      }
    }
    console.log('顶层单卡：' + rows.length + ' 张')
    console.log('① 存量里"键含着本族模型变体名"的组：' + badGroups.size + ' 组')
    for (const [k, v] of [...badGroups].slice(0, 15)) console.log(`   ${k}　(${v.n} 张)　模型名=${v.models.join(',')}`)

    /** ② 用现在的代码重算：按（目录，新键）分桶，桶里就是"重并之后会在同一组的那些行" */
    const buckets = new Map<string, { dir: string; key: string; rows: typeof rows }>()
    let noRaw = 0
    let newKeyCount = 0
    for (const r of rows) {
      const raw = r.raw_name || r.name
      if (!raw) {
        noRaw++
        continue
      }
      const nk = deriveGroupKey(raw, lex).groupKey
      const dir = r.dir_key ?? '(无目录键)'
      const id = dir + ' § ' + nk
      const cur = buckets.get(id) ?? { dir, key: nk, rows: [] as typeof rows }
      cur.rows.push(r)
      buckets.set(id, cur)
      if (cur.rows.length === 1) newKeyCount++
    }
    const nowGroups = new Set(rows.filter((r) => r.group_id).map((r) => r.group_id)).size
    /**
     * "要重并的组数" = 桶里成员**现在分属好几个组**的那些。
     * 不能拿"成员数 - 1"当收益：库里有一批 zip + 已解压目录的成对行本来就并在同一组里
     * （裁定 #16），按行数算会把它们重复计一次，报出来的数虚高。
     */
    const merges: Array<{ dir: string; key: string; fromGroups: number; cards: number; rows: typeof rows }> = []
    for (const b of buckets.values()) {
      if (b.rows.length < 2) continue
      const gids = new Set(b.rows.map((r) => r.group_id ?? '(无组)'))
      if (gids.size > 1) merges.push({ dir: b.dir, key: b.key, fromGroups: gids.size, cards: gids.size - 1, rows: b.rows })
    }
    merges.sort((a, b) => b.cards - a.cards)
    console.log('② 归并组数：现在 ' + nowGroups + ' 个　→　按现在的代码重算 ' + newKeyCount + ' 个')
    console.log(
      '   真的会合并的：' + merges.length + ' 处，能少掉 ' + merges.reduce((n, m) => n + m.cards, 0) + ' 张卡' +
        '（成员>1 但现在已同组的那些不算收益）　raw_name 缺失：' + noRaw
    )

    /** ②b 有多少行会落进 variantUnknown —— B2「从同族位置学模型名」的目标人群到底有多大 */
    const unk = rows
      .map((r) => ({ raw: r.raw_name || r.name, u: deriveGroupKey(r.raw_name || r.name, lex).variantUnknown }))
      .filter((x) => x.u.length)
    console.log('②b 括号里有"词表不认的模型名"的行：' + unk.length + ' / ' + rows.length)
    for (const u of unk.slice(0, 12)) console.log('   ' + u.u.join(',') + '　←　' + u.raw.slice(0, 56))

    /** ②c 每一处要合并的，逐条列出"现在的键 → 新的键"（B4 的预览清单就是这个形状） */
    console.log('②c 要合并的组全列：')
    for (const m of merges) {
      console.log(`   ${m.rows.length} 张 / 现在分属 ${m.fromGroups} 组　${m.key}　@ ${m.dir}`)
      for (const r of m.rows) console.log('        ' + (r.group_key || '(无组)').padEnd(46) + '→ ' + (r.raw_name || r.name).slice(0, 44))
    }

    /**
     * ③ 只读自证：扫完一遍库文件的字节数与 mtime 都不许动。
     * （`readonly: true` 不等于"碰不到盘" —— WAL 合回就会改 mtime，那就不能叫只读探针了。）
     */
    db.close()
    const after = fs.statSync(DB)
    console.log(`③ 只读核对：库文件 ${before.size} → ${after.size} 字节，mtime ${before.mtimeMs === after.mtimeMs ? '未变' : '变了'}`)
    expect(after.size, '只读探针把库文件大小改动了').toBe(before.size)
    expect(before.mtimeMs === after.mtimeMs, '只读探针改动了库文件 mtime').toBe(true)
  })
})
