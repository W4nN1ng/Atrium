import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addUserTerm, readUserTerms, removeUserTerm } from '../../src/main/services/userLexicon'
import { loadLexicon } from '../../src/main/classify/lexicon'
import { P } from '../../src/main/services/paths'
import type { CategoryKeys } from '../../src/main/services/userLexicon'

const cfg = require('../../resources/lexicon/categories.json') as CategoryKeys

/**
 * 用户词典：设置页"分类"那一栏写的那份文件。
 * 单独测是因为它同时被两边读 —— 主进程写、worker 读，格式对不上就是静默失灵。
 */

let tmpUser = ''

beforeAll(() => {
  tmpUser = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'avca-userlex-')), 'lexicon.user.json')
})

afterAll(() => {
  try {
    if (fs.existsSync(P.userLexicon())) fs.rmSync(P.userLexicon(), { force: true })
  } catch {
    /* 临时目录交给系统 */
  }
  void tmpUser
})

describe('自定义词条', () => {
  it('加一条就能读回来，同名重复加是覆盖不是叠两条', () => {
    const before = readUserTerms().length
    const r = addUserTerm({ term: '  ZZZ测试词  ', cat: 'audio', sub: 'se' }, cfg)
    expect(r.ok).toBe(true)
    expect(r.entries.length).toBe(before + 1)
    const hit = r.entries.find((e) => e.term === 'zzz测试词')
    expect(hit, '词条要归一化成小写').toBeTruthy()
    expect(hit?.cat).toBe('audio')
    expect(hit?.sub).toBe('se')
    // 内置词典里 'physbone' 是 插件/骨骼类，这里故意覆盖成别的，验证"后读的赢"
    const again = addUserTerm({ term: 'zzz测试词', cat: 'prop', sub: null }, cfg)
    expect(again.entries.filter((e) => e.term === 'zzz测试词')).toHaveLength(1)
    expect(again.entries.find((e) => e.term === 'zzz测试词')?.cat).toBe('prop')
    removeUserTerm('zzz测试词')
    expect(readUserTerms().find((e) => e.term === 'zzz测试词')).toBeUndefined()
  })

  it('空词条 / 空分类要报错而不是写坏文件', () => {
    const r = addUserTerm({ term: '   ', cat: '' }, cfg)
    expect(r.ok).toBe(false)
    expect(r.errorKey).toBe('settings.termEmpty')
  })

  it('分类表里没有的 key 要拒（写进去就是一条永远命中不了的规则）', () => {
    const r = addUserTerm({ term: 'zz-怪分类', cat: 'not_a_category' }, cfg)
    expect(r.ok).toBe(false)
    expect(r.errorKey).toBe('settings.termUnknownCat')
    const bad = addUserTerm({ term: 'zz-怪二级', cat: 'audio', sub: 'not_a_sub' }, cfg)
    expect(bad.errorKey).toBe('settings.termUnknownCat')
  })

  it('带路径分隔符之类的怪字符一律拒（这份文件会被 JSON.parse 读）', () => {
    const r = addUserTerm({ term: '坏"词\\', cat: 'audio' }, cfg)
    expect(r.ok).toBe(false)
    expect(r.errorKey).toBe('settings.termBad')
  })

  it('worker 那边读词典时，用户词条确实盖住内置的同名词', () => {
    addUserTerm({ term: 'physbone', cat: 'clothing', sub: 'outfit', w: 5 }, cfg)
    try {
      const lex = loadLexicon({
        builtin: path.join(process.cwd(), 'resources', 'lexicon', 'lexicon.json'),
        user: P.userLexicon()
      })
      const e = lex.lookup('physbone')
      expect(e, 'physbone 本来就在内置词典里').toBeTruthy()
      expect(e?.cat, '用户词条要赢过内置').toBe('clothing')
      expect(e?.sub).toBe('outfit')
    } finally {
      removeUserTerm('physbone')
    }
  })

  it('没有用户文件时读内置词典不受影响（文件不存在 = 空词典，不抛）', () => {
    expect(readUserTerms()).toBeInstanceOf(Array)
    const lex = loadLexicon({
      builtin: path.join(process.cwd(), 'resources', 'lexicon', 'lexicon.json'),
      user: path.join(os.tmpdir(), 'avca-userlex-none', 'lexicon.user.json')
    })
    expect(lex.size()).toBeGreaterThan(500)
    expect(lex.lookup('physbone')?.cat).not.toBe('clothing')
  })
})
