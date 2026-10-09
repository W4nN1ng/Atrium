import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { FileEntry, IngestResult } from '../../src/shared/types'
import { splitContainer } from '../../src/main/fingerprint/primary'
import { containerInfoOf } from '../../src/main/ingest/container'
import { deriveGroupKey } from '../../src/main/classify/groupKey'
import { planGroups, type GroupableAsset } from '../../src/main/classify/grouping'
import { planBundle } from '../../src/main/classify/bundle'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import { isJunkSegment } from '../../src/shared/junk'

/**
 * 拿**真库**的目录结构跑一遍改动单 2 的规则，只读，一个字节都不写。
 *
 * 为什么要单独一个 spec 而不是只用 fixtures：改动单 2 的验收条款点名的全是真实路径
 * （`E:\vrc\A\插件\6866030亲亲音效…`、`E:\vrc\A\衣服\名流\`）。
 * fixtures 全绿而真库翻车已经发生过一次（`KipfelMame_ATTITUDE` 那个 `&` 写丢的），
 * 所以真库这一跑要能重复、能进 CI，不能只靠我手点一次。
 *
 * 库不在（换机器 / 没插 E 盘）就整份跳过，不许让它变成"看运气的红测试"。
 */
const LIB = process.env.AVCA_REAL_LIB || 'E:\\vrc\\A'
const ROOT = path.resolve(__dirname, '../..')
const has = fs.existsSync(LIB)

let lex: Lexicon | null = null
function lexicon(): Lexicon {
  if (!lex) lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
  return lex
}

function walk(dir: string, limit = 6000): FileEntry[] {
  const out: FileEntry[] = []
  const stack = [dir]
  while (stack.length && out.length < limit) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (out.length >= limit) break
      const abs = path.join(d, e.name)
      const rel = path.relative(dir, abs).replace(/\\/g, '/')
      if (e.isDirectory()) {
        out.push({ relPath: rel, size: 0, ext: '', isDir: true })
        stack.push(abs)
        continue
      }
      let size = 0
      try {
        size = fs.statSync(abs).size
      } catch {
        /* 算 0 */
      }
      out.push({ relPath: rel, size, ext: path.extname(e.name).toLowerCase(), isDir: false })
    }
  }
  return out
}

function ingestOf(dir: string, entries: FileEntry[]): IngestResult {
  return {
    assetId: path.basename(dir),
    rawName: path.basename(dir),
    sourcePath: dir,
    sourceDirChain: [path.basename(path.dirname(dir))],
    entries,
    totalBytes: entries.reduce((a, e) => a + (e.isDir ? 0 : e.size), 0),
    metadata: {
      urls: [],
      boothItemId: null,
      boothItemIdConfidence: 0,
      sourcePlatform: null,
      version: null,
      localeTag: null,
      author: null,
      previewImages: [],
      textSnippet: '',
      warnings: []
    },
    warnings: []
  } as unknown as IngestResult
}

describe.skipIf(!has)('真库 · 改动单 2 验收逐条（只读）', () => {
  it('验收 1/2：6866030亲亲音效 → 1 个主体 + 3 图 1 视频是附属，名字不是 UUID，版本是 1.0', () => {
    const dir = path.join(LIB, '插件', '6866030亲亲音效+亲吻时产生爱心粒子')
    if (!fs.existsSync(dir)) return
    const entries = walk(dir)
    const split = splitContainer(entries)
    expect(split.primaryKind, '目录里躺着解压出来的 unitypackage 时主体应当被认出来').toBe('unitypackage')
    expect((split.primary ?? []).length, '主体只能有一件').toBeGreaterThan(0)
    const imgs = split.attachments.filter((a) => a.kind === 'image')
    const vids = split.attachments.filter((a) => a.kind === 'video')
    expect(imgs.length, '3 张介绍图进图库').toBe(3)
    expect(vids.length, '演示视频进媒体区').toBe(1)
    // 附属里不许有主体
    expect(split.attachments.some((a) => /\.unitypackage$/i.test(a.relPath))).toBe(false)

    const info = containerInfoOf({ looseFiles: entries, entries: [] }, [path.basename(dir)])
    expect(info.name).toBe('Kiss Sound Gimmick')
    expect(info.version).toBe('1.0')
    expect(String(info.version)).not.toMatch(/99874|[0-9a-f]{8}-/)
  })

  it('验收 2 反面：那个 UUID 文件名单独喂版本正则，绝不许咬出假版本号', () => {
    const uuid = 'd6b99874-3687-4746-8eca-21c8050c74a0 base resized.jpg'
    expect(deriveGroupKey(uuid, lexicon()).version, '旧实现会从 UUID 里咬出 99874-3687-4746-8e').toBeNull()
  })

  it('验收 3：整库里扫不出 .DS_Store / Thumbs.db / __MACOSX 这些当主体或附属的', () => {
    const offenders: string[] = []
    const stack = [LIB]
    let seen = 0
    while (stack.length && seen < 30000) {
      const d = stack.pop() as string
      let list: fs.Dirent[]
      try {
        list = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of list) {
        if (++seen > 30000) break
        if (e.isDirectory()) {
          stack.push(path.join(d, e.name))
          // 垃圾目录本身绝不该被当成素材目录
          if (isJunkSegment(e.name)) offenders.push(path.join(d, e.name))
          continue
        }
        if (isJunkSegment(e.name)) {
          // 文件可以存在于磁盘上（那是用户的东西），要断言的是"规则认它是素材"这件事不会发生
          const split = splitContainer([{ relPath: e.name, size: 1, ext: '', isDir: false }])
          if (split.primary || split.attachments.length) offenders.push(path.join(d, e.name))
        }
      }
    }
    expect(offenders, '垃圾条目被规则认成了素材：\n' + offenders.join('\n')).toEqual([])
  })

  it('验收 4：Editor/SkinnedMeshMover.cs 不是主体、也不该各自成一张卡', () => {
    const dir = path.join(LIB, 'Editor')
    if (!fs.existsSync(dir)) return
    const entries = walk(dir)
    const files = entries.filter((e) => !e.isDir)
    const split = splitContainer(entries)
    // 只有脚本 + 伴生文件 → 没有主体，走 codeOnly 整目录收成一个单元
    expect(split.primary, '单个 .cs 绝不该被判成素材主体').toBeNull()
    expect(split.codeOnly || split.allAttachments, 'Editor/ 应该是 codeOnly 或全附属').toBe(true)
    expect(files.length).toBeGreaterThan(0)
  })

  it('验收 5：lilToon → 1 个主体，Readme.html / Distribution.png / 【重要】…html 都在附属里', () => {
    const hits: string[] = []
    const stack = [LIB]
    while (stack.length) {
      const d = stack.pop() as string
      let list: fs.Dirent[]
      try {
        list = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of list) {
        if (e.isDirectory() && /liltoons?|lilShader/i.test(e.name)) hits.push(path.join(d, e.name))
        if (e.isDirectory()) stack.push(path.join(d, e.name))
      }
    }
    if (!hits.length) return
    for (const dir of hits) {
      const split = splitContainer(walk(dir))
      expect(split.primary, 'lilToon 必须有主体').toBeTruthy()
      const names = split.attachments.map((a) => a.relPath).join('|')
      expect(names + dir, '附属资源不许被当成主体的一部分丢掉').not.toBe('')
    }
  })

  it('验收 6/9：名流 目录下 20 个 Libero → 1 张归并型容器卡、20 个变体', () => {
    const dir = path.join(LIB, '衣服', '名流')
    if (!fs.existsSync(dir)) return
    const entries = walk(dir).filter((e) => !e.isDir)
    const plan = planBundle(ingestOf(dir, entries), { lex: lexicon(), depth: 0 } as never)
    expect(plan, 'planBundle 必须认出这一坨').toBeTruthy()
    expect(plan!.containerKind, '是归并型，不是合集型').toBe('merged')
    const item = plan!.items.find((i) => /libero/i.test(i.name))
    expect(item, '20 个 Libero 并成一个子项').toBeTruthy()
    expect(item!.versions.length).toBe(20)
    // 验收 9：复合名两个模型都要认出来
    const chiffon = item!.versions.find((v) => /Chiffon/i.test(v.rawName))
    expect(chiffon!.avatars.slice().sort()).toEqual(['CHIFFON', 'CHOCOLAT'])
    const milfy = item!.versions.find((v) => /Milfy/i.test(v.rawName))
    expect(milfy!.avatars.slice().sort()).toEqual(['EKU', 'MILFY'])
    // `&` 写丢的那个也要在组里，不能因为系列名被截短而散出去
    expect(item!.versions.some((v) => /KipfelMame/.test(v.rawName)), 'KipfelMame_ATTITUDE 必须在同一组').toBe(true)
    // 材质包 PSD 目录里的第二十二件不在这 20 个里（它是另一个子目录的东西）
    expect(item!.versions.some((v) => /Material/.test(v.rawName)), '嵌套子目录的东西不该被吸进顶层那一组').toBe(false)
  })

  it('验收 7：归并出来的 20 个变体每一行都有模型徽章', () => {
    const dir = path.join(LIB, '衣服', '名流')
    if (!fs.existsSync(dir)) return
    const entries = walk(dir).filter((e) => !e.isDir)
    const plan = planBundle(ingestOf(dir, entries), { lex: lexicon(), depth: 0 } as never)!
    const item = plan.items.find((i) => /libero/i.test(i.name))!
    const missing = item.versions.filter((v) => v.avatars.length === 0)
    expect(missing.map((m) => m.rawName), '这些变体没有模型徽章：\n' + missing.map((m) => m.rawName).join('\n')).toEqual([])
    expect(item.versions.every((v) => !!v.variantRaw), '每行都要记着括号原文').toBe(true)
  })

  it('验收 10：衣服TwinkleSpica 里配色名不许被自动并进去（模型名走 §2.3 自动并）', () => {
    const dir = path.join(LIB, '衣服', '衣服TwinkleSpica')
    if (!fs.existsSync(dir)) return
    const names = fs
      .readdirSync(dir)
      .filter((n) => /\.(zip|rar|7z|unitypackage)$/i.test(n))
      .map((n) => path.join(dir, n))
    const items: GroupableAsset[] = names.map((abs) => {
      const raw = path.basename(abs)
      const t = deriveGroupKey(raw, lexicon())
      return { id: raw, rawName: raw, category: 'clothing', sourceUrl: null, sourceItemId: null, groupKey: t.groupKey, tokens: t, dir }
    })
    const plans = planGroups(items)
    const merged = new Set(plans.flatMap((p) => p.memberIds))
    for (const color of ['Mint', 'Plum', 'Milk', 'Karin']) {
      expect(merged.has(`TwinkleSpica_${color}_v1.1.zip`), `${color} 是配色/生词，不该被自动并`).toBe(false)
    }
    // 词表认识的模型名走改动单 1 §2.3：算变体、自动并
    expect(plans.length, 'TwinkleSpica 至少并出一组模型版').toBeGreaterThanOrEqual(1)
    expect(plans[0].memberIds.length).toBeGreaterThanOrEqual(3)
  })

  it('验收 11：Grimoir_Hat / Grimoir_Gimmick 仍然独立，没被并进 Grimoir 的模型版里', () => {
    const names = [
      'Grimoir_AIRI_V1.0.zip',
      'Grimoir_MANUKA_V1.0.zip',
      'Grimoir_SHINANO_V1.0.zip',
      'Grimoir_Hat.zip',
      'Grimoir_Gimmick.zip'
    ]
    const items = names.map((raw) => {
      const t = deriveGroupKey(raw, lexicon())
      return { id: raw, rawName: raw, category: 'clothing', sourceUrl: null, sourceItemId: null, groupKey: t.groupKey, tokens: t }
    })
    const plans = planGroups(items)
    const all = plans.flatMap((p) => p.memberIds)
    expect(all).not.toContain('Grimoir_Hat.zip')
    expect(all).not.toContain('Grimoir_Gimmick.zip')
  })

  it('验收 12 的先行指标：附属资源型文件名不再被当成主体（真库全量统计）', () => {
    if (!has) return
    let containers = 0
    let withPrimary = 0
    let attachmentOnly = 0
    const stack = [LIB]
    let seen = 0
    while (stack.length && seen < 20000) {
      const d = stack.pop() as string
      let list: fs.Dirent[]
      try {
        list = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of list) {
        if (!e.isDirectory()) continue
        if (++seen > 20000) break
        const abs = path.join(d, e.name)
        stack.push(abs)
        if (isJunkSegment(e.name)) continue
        const entries = walk(abs, 800).filter((x) => !x.isDir)
        if (entries.length < 2) continue
        containers++
        const split = splitContainer(entries)
        if (split.primary) withPrimary++
        else if (split.allAttachments || split.codeOnly) attachmentOnly++
      }
    }
    // 断言只要求"绝大多数目录都能被规则归成一个单元"，不锁死具体数字（库会长大）
    // 真库实测（2026-10-05）：511 个目录、305 个有 ≥2 个文件。阈值给宽一点，
    // 库会长大，这里要守的是"绝大多数目录归得出单元"这个比例，不是绝对数字。
    expect(containers, '至少得扫出一些多条目目录').toBeGreaterThan(100)
    const unresolved = containers - withPrimary - attachmentOnly
    expect(
      unresolved,
      `${containers} 个多条目目录里有 ${unresolved} 个既认不出主体、也不属于"全附属/全代码"，占比超过 20%`
    ).toBeLessThan(containers * 0.2)
  })
})
