import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 第 10 轮 A + B + F 的**接线**（滚动、四颗假按钮、旧文案）。
 *
 * 这三块都是"后端没问题、界面上是假的/够不着"那一类，判据测不到，
 * 所以照 ①②⑥ 的老办法：源码级钉住形状 + 活体钉住真行为。
 */
const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 断言 API 存在/顺序之前先剥注释（注释里也写着函数名和旧文案） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

const bd = stripComments(read('src/renderer/components/BundleDetail.tsx'))
const locales = ['zh-CN', 'en', 'ja'].map((l) => JSON.parse(read(`src/renderer/i18n/${l}.json`)) as Record<string, unknown>)

function flat(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return [prefix]
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') out.push(...flat(v, key))
    else out.push(key)
  }
  return out
}

describe('A · 容器视图能滚', () => {
  it('⭐ 组件根那一层带 min-h-0（缺它就是"滚轮按下去没反应、最下面几行看不着"）', () => {
    /**
     * 列表那层自己一直有 `min-h-0 flex-1 overflow-y-auto`，坏在**它的父级**：
     * 列向 flex 里 `flex-1` 配 `min-height:auto` 会被内容撑开，
     * 于是 `overflow-y-auto` 永远拿不到有下界的盒子。
     */
    expect(bd).toMatch(/<div className="flex min-h-0 min-w-0 flex-1 flex-col">/)
    expect(bd).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('旧的那一层写法没有第二处（防止同一个组件里还留着别的容器）', () => {
    /** 组件里有好几个 `return (`（loading / missing / 主体），所以不按 return 定位，按 class 数 */
    expect(bd.match(/className="flex min-w-0 flex-1 flex-col"/g) ?? [], '还有一处列向容器没带 min-h-0').toHaveLength(0)
    expect(bd.match(/className="flex min-h-0 min-w-0 flex-1 flex-col"/g) ?? []).toHaveLength(1)
  })
})

describe('B · 容器里那四颗"Unity 导入在 M5 交付"的假按钮', () => {
  it('整个组件里不再出现那句占位文案的 key', () => {
    expect(bd).not.toContain('bundleImportSoon')
  })

  it('⭐ 行内那颗「导入」不再是 disabled，打的是 store 的 importAsset', () => {
    /**
     * ⚠ 别按注释定位 —— `stripComments` 会把 JSX 的 `{/* … *\/}` 一起剥掉，
     * 第一版拿注释当锚点，slice 出来是空串，断言"包含 onClick"当场红（红得毫无信息量）。
     */
    const at = bd.indexOf('onClick={() => void importAsset(r.id)}')
    expect(at, '行内那颗没接 importAsset').toBeGreaterThan(-1)
    const tag = bd.slice(bd.lastIndexOf('<Button', at), at)
    expect(tag, '这颗还是 disabled 的假按钮').not.toMatch(/\bdisabled\b/)
    expect(bd.slice(at, at + 160)).toContain("t('common.import')")
  })

  it('⭐ 行双击吃设置里的「双击行为」，和外面网格同一套（Q1 甲）', () => {
    const at = bd.indexOf('onDoubleClick=')
    const body = bd.slice(at, at + 320)
    expect(body).toContain('settings.doubleClickAction')
    expect(body).toContain("importAsset(r.id)")
    /** 先开详情再按设置走 —— 外面那张网格就是这个顺序（AssetGrid 的 onDoubleClick） */
    expect(body.indexOf('openDetail(r.id)')).toBeLessThan(body.indexOf('doubleClickAction'))
  })

  it('顶部那颗「整包导入 Unity」不再是假的：开面板 + 全预勾（Q3 甲）', () => {
    const at = bd.indexOf('{t(\'library.bundleImportWhole\')}')
    expect(at, '整包那颗没了？').toBeGreaterThan(-1)
    const body = bd.slice(Math.max(0, at - 700), at)
    expect(body).toContain('openMemberPicker(bundleId)')
    expect(body).toContain('pickAllMembers()')
    /** 顺序：预勾必须发生在清单拉回来之后 */
    expect(body.indexOf('pickAllMembers()')).toBeGreaterThan(body.indexOf('openMemberPicker(bundleId)'))
  })

  it('勾了成员按 Enter 有真动作（开面板），不是弹一句过期话', () => {
    const at = bd.indexOf("if (e.key === 'Enter'")
    const body = bd.slice(at, at + 260)
    expect(body).toContain('openMemberPicker(bundleId)')
    expect(body).not.toContain('toast(\'bad\'')
  })
})

describe('F · 旧文案删干净（他：不要再出现"Unity 导入在 M5 交付"类似的内容）', () => {
  const DEAD = [
    'library.importDeferred',
    'library.pickMembersFirst',
    'library.bundleImportSoon',
    'ingest.m1Note',
    'project.m1Note',
    'inbox.m1Note',
    'ingest.m1Stopped',
    'ingest.pauseLater',
    'undo.fsLater',
    'undo.importLater',
    /** 「该功能将在 {{milestone}} 交付」—— 编号在参数里，光按字面量找 M\d 抓不到它 */
    'common.notImplemented',
    'settings.exportLogs'
  ]

  it('⭐ 这批 key 三份语言文件里都不许再存在（留着就是等哪天被误用）', () => {
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const keys = new Set(flat(JSON.parse(read(`src/renderer/i18n/${loc}.json`))))
      const still = DEAD.filter((k) => keys.has(k))
      expect(still, `${loc} 里还有：${still.join(', ')}`).toEqual([])
    }
  })

  it('代码里不许再引用这批 key（引用了就是"界面上一句没人维护的话"）', () => {
    const blob = [
      'src/renderer/stores/ui.ts',
      'src/renderer/components/BundleDetail.tsx',
      'src/renderer/pages/Settings.tsx',
      'src/main/library/undo.ts'
    ]
      .map((f) => stripComments(read(f)))
      .join('\n')
    for (const k of DEAD) expect(blob, `还在引用 ${k}`).not.toContain(k.split('.')[1])
  })

  it('主进程那句 import 抛错改成了实话，不再预告里程碑', () => {
    /** 只看代码本体：注释里留着那句原文是有意的（记着它原来骗人） */
    const undo = stripComments(read('src/main/library/undo.ts'))
    expect(undo).not.toContain('将在 M5 交付')
    expect(undo).toContain('最近导入')
  })
})

describe('三份语言文件仍然对齐（删过 key 之后最容易漂）', () => {
  it('key 集合一模一样', () => {
    const base = new Set(flat(locales[0]))
    for (const [i, l] of locales.slice(1).entries()) {
      const other = new Set(flat(l))
      expect([...base].filter((k) => !other.has(k)), `第 ${i + 2} 份缺`).toEqual([])
      expect([...other].filter((k) => !base.has(k)), `第 ${i + 2} 份多`).toEqual([])
    }
  })
})
