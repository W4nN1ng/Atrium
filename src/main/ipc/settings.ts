import { app } from 'electron'
import log from 'electron-log'
import type { AppSettings, CategoryConfig } from '../../shared/types'
import { getSettings, resetSettings, setSettings, onSettingsChanged } from '../services/settings'
import { loadCategories, saveCategories } from '../services/categories'
import { libraryRootProblem } from '../security/libraryRoot'
import { getDb } from '../db'
import { listLearning, deleteLearning } from '../db/repos/journal'
import { addUserTerm, builtinLexiconCount, readUserTerms, removeUserTerm } from '../services/userLexicon'
import { assetIndex, rebuildIndex, setCategoryConfig } from '../search'
import type { IpcRegistrar } from './types'

export function registerSettings({ ipc, broadcast }: IpcRegistrar): void {
  const validate = (patch: Partial<AppSettings>): void => {
    if (patch.libraryRoot) {
      const problem = libraryRootProblem(patch.libraryRoot)
      if (problem) throw new Error('i18n:' + problem)
    }
    for (const key of ['confidenceAuto', 'confidenceConfirm'] as const) {
      const value = patch[key]
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error('i18n:settings.invalidThreshold')
      }
    }
  }
  ipc.handle('settings:get-all', (): AppSettings => getSettings())

  ipc.handle('settings:set', (key: unknown, value: unknown): AppSettings => {
    if (typeof key !== 'string') throw new Error('设置项名无效')
    const patch = { [key]: value } as Partial<AppSettings>
    validate(patch)
    return setSettings(patch)
  })

  ipc.handle('settings:set-many', (patch: unknown): AppSettings => {
    if (!patch || typeof patch !== 'object') throw new Error('设置项无效')
    const p = patch as Partial<AppSettings>
    validate(p)
    const next = setSettings(p)
    if (p.autoLaunch !== undefined) {
      // 开机自启由首启向导确认后才会被打开，绝不由程序擅自写启动项
      app.setLoginItemSettings({ openAtLogin: next.autoLaunch, args: [] })
      log.info('登录自启动：' + (next.autoLaunch ? '开' : '关'))
    }
    return next
  })

  ipc.handle('settings:reset', (): AppSettings => resetSettings())

  ipc.handle('categories:list', (): CategoryConfig => loadCategories())

  /**
   * 保存分类表（设置 → 分类）。
   *
   * ⚠ 光写文件是"看着存下了、其实没生效"：
   *  - 检索那边缓存着一份 cfg（`search.setCategoryConfig`），不换就继续用旧标签/旧口语；
   *  - 别名是**入库时**算好存表的，不重建索引，新加的 `synonyms` 一个也搜不到；
   *  - 不 broadcast，界面侧栏那些分类名还挂着旧的。
   * 三件一起做，和 `health:apply-reanalyze` 那条同一个套路。
   */
  ipc.handle('categories:save', (cfg: unknown): CategoryConfig => {
    if (!cfg || typeof cfg !== 'object') throw new Error('分类表无效')
    const next = saveCategories(cfg as CategoryConfig)
    setCategoryConfig(next)
    try {
      rebuildIndex(getDb(), next, assetIndex)
    } catch (e) {
      log.warn('保存分类表后重建索引失败：' + (e instanceof Error ? e.message : String(e)))
    }
    broadcast('data:changed', { reason: 'categories' })
    return next
  })

  /**
   * 词典与已学规则（第 2 份 §5.4）。
   * 这两样都会影响"下次怎么分类"，所以必须看得见、删得掉 ——
   * 用户教错一次，得能自己撤销那次教学，不然只能等它撞够次数自己翻车。
   */
  ipc.handle('taxonomy:learning-list', () => listLearning(getDb()))
  ipc.handle('taxonomy:learning-delete', (id: unknown) => {
    if (typeof id !== 'number') throw new Error('规则 id 无效')
    deleteLearning(getDb(), id)
    return listLearning(getDb())
  })
  ipc.handle('taxonomy:user-terms', () => readUserTerms())
  ipc.handle('taxonomy:term-add', (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('词条无效')
    const r = addUserTerm(input as { term: string; cat: string; sub?: string | null }, loadCategories())
    if (!r.ok) {
      // 错误只回 key，中文文案归渲染进程拼（主进程不许回传文案）
      throw new Error('i18n:' + (r.errorKey ?? 'settings.termBad'))
    }
    broadcast('data:changed', { reason: 'lexicon' })
    return r.entries
  })
  ipc.handle('taxonomy:term-remove', (term: unknown) => {
    if (typeof term !== 'string') throw new Error('词条无效')
    broadcast('data:changed', { reason: 'lexicon' })
    return removeUserTerm(term)
  })
  ipc.handle('taxonomy:builtin-count', () => builtinLexiconCount())

  onSettingsChanged((next, changed) => {
    broadcast('settings:changed', next)
    if (changed.includes('language')) log.info('界面语言切换为 ' + next.language)
  })
}
