import { describe, expect, it } from 'vitest'
import { isFlattenedBasket, unitRawName, unitSourcePath } from '../../src/shared/flattenUnits'

/**
 * 第 10 轮 C 的**后半程**判据（活体抓出来的那条断链）。
 *
 * `classify()` 把筐摊成 N 个单元只是前半程；登记那一步要知道每件东西
 * **在父目录里的哪一层**，否则 22 件全被记到筐那一层目录上、
 * 或者更糟 —— 只记第一件（就是他界面上看到的"一个筐一张卡"）。
 */
describe('isFlattenedBasket · 这批要不要逐件登记', () => {
  it('⭐ 没有合集树却有多个单元 = 摊平的筐 → 逐件', () => {
    expect(isFlattenedBasket([{ a: 1 }, { a: 2 }], false)).toBe(true)
  })

  it('有树就交给三级那条路（`commitBundleAsset`），不许两条路都走一遍', () => {
    expect(isFlattenedBasket([{ a: 1 }, { a: 2 }], true)).toBe(false)
  })

  it('单件不是摊平（普通素材、合集自己那一行都从这里出去）', () => {
    expect(isFlattenedBasket([{ a: 1 }], false)).toBe(false)
    expect(isFlattenedBasket([], false)).toBe(false)
    expect(isFlattenedBasket(null, false)).toBe(false)
    expect(isFlattenedBasket(undefined, false)).toBe(false)
  })

  it('非数组（脏值）不炸也不当成摊平', () => {
    expect(isFlattenedBasket('道具22件' as unknown as unknown[], false)).toBe(false)
    expect(isFlattenedBasket({ length: 3 } as unknown as unknown[], false)).toBe(false)
  })
})

describe('unitSourcePath · 这一件的源路径', () => {
  it('⭐ 首选引擎标好的 sourceRelPath（正斜杠、反斜杠都吃）', () => {
    expect(unitSourcePath('D:\\fix\\道具22件', { sourceRelPath: '件1', filePaths: [] })).toBe('D:\\fix\\道具22件\\件1')
    expect(unitSourcePath('D:/fix/道具22件', { sourceRelPath: '4533350/护目镜', filePaths: [] })).toBe('D:\\fix\\道具22件\\4533350\\护目镜')
  })

  it('父目录带尾斜杠时不许拼出双斜杠', () => {
    expect(unitSourcePath('D:\\fix\\道具22件\\', { sourceRelPath: '件2', filePaths: [] })).toBe('D:\\fix\\道具22件\\件2')
    expect(unitSourcePath('D:\\fix\\道具22件/', { sourceRelPath: '/件2', filePaths: [] })).toBe('D:\\fix\\道具22件\\件2')
  })

  it('⭐ 没标 relPath 时退回"它的第一个文件所在目录"（老数据不许全记到筐那一层）', () => {
    expect(unitSourcePath('D:\\f\\筐', { filePaths: ['件3/RKPlayer 3.2.unitypackage'] })).toBe('D:\\f\\筐\\件3')
    expect(unitSourcePath('D:\\f\\筐', { filePaths: ['a/x.prefab', 'a/y.mat'] })).toBe('D:\\f\\筐\\a')
  })

  it('散文件（没有目录）就用父目录本身，宁可粗一点也不丢件', () => {
    expect(unitSourcePath('D:\\f\\筐', { filePaths: ['SPS.zip'] })).toBe('D:\\f\\筐')
    expect(unitSourcePath('D:\\f\\筐', { filePaths: [] })).toBe('D:\\f\\筐')
    expect(unitSourcePath('D:\\f\\筐', { filePaths: [''] })).toBe('D:\\f\\筐')
  })

  it('sourceRelPath 是空白串时不许拼出一个尾反斜杠的假目录', () => {
    expect(unitSourcePath('D:\\f\\筐', { sourceRelPath: '   ', filePaths: [] })).toBe('D:\\f\\筐')
  })
})

describe('unitRawName · 原名那一行该写什么', () => {
  it('取 relPath 的最后一段（`4533350\\护目镜` → 护目镜）', () => {
    expect(unitRawName({ sourceRelPath: '4533350/护目镜' })).toBe('护目镜')
    expect(unitRawName({ sourceRelPath: '件1' })).toBe('件1')
  })

  it('没标 relPath 就返回 null，让调用方按老办法兜底（不许在这里编一个名字）', () => {
    expect(unitRawName({})).toBeNull()
    expect(unitRawName({ sourceRelPath: null })).toBeNull()
    expect(unitRawName({ sourceRelPath: '  ' })).toBeNull()
  })
})
