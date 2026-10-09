import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CategoryConfig } from '../../src/shared/types'
import { resolveDirNames } from '../../src/main/library/dirAliases'

const cfg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../resources/lexicon/categories.json'), 'utf8')
) as CategoryConfig
const base = Object.fromEntries(cfg.categories.map((c) => [c.key, c.label['zh-CN']]))

let root = ''
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-alias-'))
})
afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('resolveDirNames —— 尊重用户自建目录', () => {
  it('空库里用分类表本名', () => {
    const r = resolveDirNames(root, base, cfg)
    expect(r.names.clothing).toBe('服装')
    expect(r.reused).toEqual([])
  })

  it('库里已经有"衣服"就用"衣服"，不再新建"服装"', () => {
    const dir = path.join(root, 'has-clothes')
    fs.mkdirSync(path.join(dir, '衣服'), { recursive: true })
    fs.mkdirSync(path.join(dir, '插件'), { recursive: true })
    fs.mkdirSync(path.join(dir, '贴图'), { recursive: true })
    const r = resolveDirNames(dir, base, cfg)
    expect(r.names.clothing).toBe('衣服')
    expect(r.names.plugin).toBe('插件')
    expect(r.names.texture).toBe('贴图')
    // 没建过的分类仍用本名
    expect(r.names.shader).toBe('着色器')
    // 只有 衣服→clothing 是真别名；贴图/插件本来就是分类表本名，算"直接配中"
    expect(r.reused.map((x) => x.category).sort()).toEqual(['clothing'])

  })

  it('本名已经对上的不算别名复用', () => {
    const dir = path.join(root, 'exact')
    fs.mkdirSync(path.join(dir, '服装'), { recursive: true })
    const r = resolveDirNames(dir, base, cfg)
    expect(r.names.clothing).toBe('服装')
    expect(r.reused).toEqual([])
  })

  it('库根不存在 / 为 null 时不炸', () => {
    expect(resolveDirNames(null, base, cfg).names.clothing).toBe('服装')
    expect(resolveDirNames(path.join(root, '没有这个目录'), base, cfg).names.clothing).toBe('服装')
  })

  it('一个已有目录不会被两个分类抢走', () => {
    const dir = path.join(root, 'one-dir')
    fs.mkdirSync(path.join(dir, '道具'), { recursive: true })
    const r = resolveDirNames(dir, base, cfg)
    const taken = Object.values(r.names).filter((v) => v === '道具')
    expect(taken.length).toBe(1)
  })

  it('分类表里用户自己加的口语也算（R4 ④：检索认、归档也认，不许只认一半）', () => {
    /**
     * 内置 `ALIASES` 里没有"图包"这种词 —— 它只可能来自 `cfg.synonyms`。
     * 库里已经有一个 `图包/`，那归档就该往里放，而不是再建一个 `贴图/`。
     */
    const own = JSON.parse(JSON.stringify(cfg)) as CategoryConfig
    const tex = own.categories.find((c) => c.key === 'texture')
    expect(tex, '分类表里没有 texture 了？').toBeTruthy()
    tex!.synonyms = ['图包', ...(tex!.synonyms ?? [])]
    const dir = path.join(root, 'user-alias')
    fs.mkdirSync(path.join(dir, '图包'), { recursive: true })
    const r = resolveDirNames(dir, base, own)
    expect(r.names.texture).toBe('图包')
    expect(r.reused.find((x) => x.category === 'texture')).toEqual({ category: 'texture', dir: '图包' })
  })

  it('内置别名排在前面：同一批已有目录里两个都能配时，用内置那个（可预期）', () => {
    const own = JSON.parse(JSON.stringify(cfg)) as CategoryConfig
    const tex = own.categories.find((c) => c.key === 'texture')
    expect(tex, '分类表里没有 texture 了？').toBeTruthy()
    tex!.synonyms = ['纹理']
    const dir = path.join(root, 'both-hit')
    fs.mkdirSync(path.join(dir, '纹理'), { recursive: true })
    const r = resolveDirNames(dir, base, own)
    /** `纹理` 本来就在内置表里，所以这条走的是内置路径；关键是它不许因为口语而改判到别的目录 */
    expect(r.names.texture).toBe('纹理')
  })
})
