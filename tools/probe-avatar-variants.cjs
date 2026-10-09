#!/usr/bin/env node
/**
 * 只读量一下**真库**里 avatar 变体的形状 —— R4 ⑤「变体分列」到底能分出什么。
 *
 * 为什么要量：⑤ 的界面判据是"一个维度有多个取值才列出来"，而取值全在
 * `variant(variant_kind='avatar')` 里。沙盒活体第一次跑出来「适配模型」那一列**根本没出现**，
 * 才顺着查到分类器把同一个模型的大小写两种写法（`SHINANO` / `Shinano`）当成了两个模型，
 * 于是 `avatars.length === 1` 的闸门过不去、一条 avatar 变体都不写。
 * 这个脚本就是当时用来确认"不是沙盒特有、真库也有两种写法并存"的证据。
 *
 * ⚠ 只 SELECT，一个字都不写。真库路径来自 `%APPDATA%\A\library.db`。
 *
 * 用法：node tools/probe-avatar-variants.cjs
 */
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const DB = process.env.AVCA_PROBE_DB || path.join(process.env.APPDATA || '', 'A', 'library.db')
const db = new DatabaseSync(DB, { readOnly: true })
const all = (sql) => db.prepare(sql).all()
const get = (sql) => db.prepare(sql).get()

console.log('库：' + DB)
console.log('素材总数：' + JSON.stringify(get('SELECT COUNT(*) n FROM asset')))
console.log('variant 按 kind：' + JSON.stringify(all(`SELECT variant_kind, COUNT(*) n FROM variant GROUP BY 1 ORDER BY n DESC`)))
console.log('avatar 取值分布：' + JSON.stringify(all(`SELECT variant_value v, COUNT(*) n FROM variant WHERE variant_kind='avatar' GROUP BY 1 ORDER BY n DESC`)))
console.log(
  '同一组里 avatar 出现大小写双胞胎的组数：' +
    JSON.stringify(
      get(`SELECT COUNT(*) n FROM (SELECT group_id FROM variant WHERE variant_kind='avatar'
             GROUP BY group_id HAVING COUNT(DISTINCT variant_value) > COUNT(DISTINCT lower(variant_value)))`)
    )
)
console.log(
  '只有一个模型（标签去大小写后=1）却写不出 avatar 变体的素材数：' +
    JSON.stringify(
      get(`SELECT COUNT(*) n FROM (
             SELECT at.asset_id aid, COUNT(DISTINCT lower(t.name)) c
               FROM asset_tag at JOIN tag t ON t.id = at.tag_id WHERE t.kind='avatar'
              GROUP BY at.asset_id
           ) x JOIN asset a ON a.id = x.aid
           WHERE x.c = 1 AND a.group_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM variant v WHERE v.asset_id = a.id AND v.variant_kind='avatar')`)
    )
)
console.log(
  '一张卡挂着只差大小写的两个 avatar 标签的素材数：' +
    JSON.stringify(
      get(`SELECT COUNT(*) n FROM (
             SELECT at.asset_id FROM asset_tag at JOIN tag t ON t.id = at.tag_id
              WHERE t.kind='avatar' GROUP BY at.asset_id
             HAVING COUNT(*) > COUNT(DISTINCT lower(t.name))
           )`)
    )
)
/**
 * 那 5 张到底长什么样 —— 大小写双胞胎只是成因之一，别把结论说过头。
 * 如果它们的标签本来就只有一个写法，那是"入库时机比变体功能早"，得等重新归并/重新分析才补得上。
 */
console.log(
  '单模型却没有 avatar 变体的素材（名字 / 标签 / 组内成员数）：' +
    JSON.stringify(
      all(`SELECT a.raw_name name,
                  (SELECT group_concat(t.name, ',') FROM asset_tag at JOIN tag t ON t.id=at.tag_id
                    WHERE at.asset_id=a.id AND t.kind='avatar') tags,
                  (SELECT COUNT(*) FROM asset b WHERE b.group_id=a.group_id) members
             FROM asset a
            WHERE a.group_id IS NOT NULL
              AND (SELECT COUNT(DISTINCT lower(t.name)) FROM asset_tag at JOIN tag t ON t.id=at.tag_id
                    WHERE at.asset_id=a.id AND t.kind='avatar') = 1
              AND NOT EXISTS (SELECT 1 FROM variant v WHERE v.asset_id=a.id AND v.variant_kind='avatar')`)
    )
)
db.close()
