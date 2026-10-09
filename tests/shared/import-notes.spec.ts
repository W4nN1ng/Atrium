import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { importResultNote } from '../../src/shared/importNotes'

/**
 * 导入结果横幅上那句"备份"的判据（渲染层零 DOM 测试，所以判据必须在能测的地方）。
 *
 * 真机抓到的那条：冲突框说会覆盖 2 个文件，导入前实际 `备份 0 个被覆盖文件`
 * （那两个文件在盘上根本不存在 —— 上一次撤销把它们删掉了，而 Unity 的资源库还记着 GUID），
 * 可横幅照旧写「被覆盖的文件已备份」。用户按下撤销才发现没有退路。
 */
describe('importResultNote', () => {
  it('没走备份那一步（backupDir=null）→ 什么都不加', () => {
    expect(importResultNote(null)).toBeNull()
    expect(importResultNote({ backupDir: null, backupSaved: 0 })).toBeNull()
  })

  it('真存下了 N 个 → 说"已备份 N 个"，不许只说"已备份"', () => {
    expect(importResultNote({ backupDir: '/x/1', backupSaved: 3 })).toEqual({ key: 'library.backedUpCount', params: { count: 3 } })
  })

  it('一个都没存下 → 明说"没东西可备份"，不许写"已备份"', () => {
    expect(importResultNote({ backupDir: '/x/1', backupSaved: 0 })).toEqual({ key: 'library.backedUpNothing', params: {} })
  })

  it('老数据没带数字 → 退回那句不含数量的"已备份"，不承诺个数', () => {
    expect(importResultNote({ backupDir: '/x/1' })).toEqual({ key: 'library.backedUp', params: {} })
    expect(importResultNote({ backupDir: '/x/1', backupSaved: -1 })).toEqual({ key: 'library.backedUp', params: {} })
  })

  it('三语都得有这三个 key（横幅是直接 t() 出来的）', () => {
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/renderer/i18n', loc + '.json'), 'utf8')) as {
        library: Record<string, string>
      }
      for (const k of ['backedUp', 'backedUpCount', 'backedUpNothing', 'rollbackDeleteFailed']) {
        expect(typeof j.library[k], loc + ' 缺 library.' + k).toBe('string')
        expect(j.library[k].length, loc + ' 的 library.' + k + ' 是空的').toBeGreaterThan(0)
      }
      /** 占位符必须成对双花括号（单花括号 i18next 原样吐出来，这坑踩过两次） */
      expect(j.library.backedUpCount).toContain('{{count}}')
      expect(j.library.rollbackDeleteFailed).toContain('{{count}}')
    }
  })
})
