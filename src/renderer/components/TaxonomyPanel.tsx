import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CategoryConfig, LearningRow } from '../../shared/types'
import { useUi } from '../stores/ui'
import { Button } from './ui'
import { SynonymEditor } from './SynonymEditor'

/** 词条形状（和主进程 services/userLexicon 一致；渲染进程不 import 主进程文件） */
interface Term {
  term: string
  cat: string | null
  sub: string | null
  dim: string
  w: number
}

/**
 * 词典与已学规则管理（设置 → 分类）。
 *
 * 两块都是"会影响下次怎么分类"的东西，所以必须看得见、删得掉：
 * - 已学规则 = 用户改分类改出来的（改一次记一条），删掉就恢复成不记得；
 * - 自定义词条 = 用户自己加的硬词条，优先级高于内置词典（loadLexicon 里后读的赢）。
 */

function labelOf(cfg: CategoryConfig | null, cat: string | null, sub: string | null, locale: string): string {
  if (!cfg || !cat) return cat ?? '—'
  const c = cfg.categories.find((x) => x.key === cat)
  if (!c) return cat
  const cname = c.label[locale as keyof typeof c.label] ?? c.label['zh-CN']
  if (!sub) return cname
  const s = c.subcategories.find((x) => x.key === sub)
  const sname = s ? s.label[locale as keyof typeof s.label] ?? s.label['zh-CN'] : sub
  return cname + ' / ' + sname
}

export function TaxonomyPanel({ categories }: { categories: CategoryConfig | null }): JSX.Element {
  const { t, i18n } = useTranslation()
  const toast = useUi((s) => s.toast)
  const [learning, setLearning] = useState<LearningRow[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [builtin, setBuiltin] = useState(0)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ term: '', cat: '', sub: '' })

  const load = useCallback(async () => {
    try {
      const [l, u, n] = await Promise.all([
        window.a.taxonomy.learningList(),
        window.a.taxonomy.userTerms(),
        window.a.taxonomy.builtinCount()
      ])
      setLearning(l)
      setTerms(u as Term[])
      setBuiltin(n)
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const wrap = (fn: () => Promise<void>): void => {
    setBusy(true)
    void fn().finally(() => setBusy(false))
  }

  async function addTerm(): Promise<void> {
    const cat = draft.cat || categories?.categories[0]?.key || ''
    try {
      const next = await window.a.taxonomy.termAdd({ term: draft.term, cat, sub: draft.sub || null })
      setTerms(next as Term[])
      setDraft({ term: '', cat: '', sub: '' })
      toast('ok', t('settings.termAdded'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast('bad', msg.startsWith('i18n:') ? t(msg.slice(5)) : msg)
    }
  }

  const catOptions = categories?.categories ?? []
  const chosen = catOptions.find((c) => c.key === (draft.cat || catOptions[0]?.key))
  const locale = i18n.language as 'zh-CN' | 'en' | 'ja'

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* R4 ④：分类的口语叫法。放在最上面，因为它是"搜不到东西"时第一个该被改的地方 */}
      <SynonymEditor categories={categories} />

      <div className="rounded border p-2" style={{ borderColor: 'var(--line)' }}>
        <div className="text-[12px] font-medium">{t('settings.userTerms')}</div>
        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('settings.userTermsHint', { builtin })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <input
            className="input"
            style={{ width: 150 }}
            placeholder={t('settings.termPlaceholder')}
            value={draft.term}
            onChange={(e) => setDraft({ ...draft, term: e.target.value })}
          />
          <select
            className="input"
            style={{ width: 120 }}
            value={draft.cat || catOptions[0]?.key || ''}
            onChange={(e) => setDraft({ ...draft, cat: e.target.value, sub: '' })}
          >
            {catOptions.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label[locale] ?? c.label['zh-CN']}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ width: 120 }}
            value={draft.sub}
            onChange={(e) => setDraft({ ...draft, sub: e.target.value })}
          >
            <option value="">{t('settings.termAnySub')}</option>
            {(chosen?.subcategories ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label[locale] ?? s.label['zh-CN']}
              </option>
            ))}
          </select>
          <Button disabled={busy || !draft.term.trim()} onClick={() => wrap(addTerm)}>
            {t('settings.termAdd')}
          </Button>
        </div>
        {terms.length ? (
          <div className="mt-2 max-h-[150px] overflow-y-auto">
            {terms.map((e) => (
              <div key={e.term} className="flex items-center gap-2 border-b py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
                <span className="min-w-0 flex-1 truncate" title={e.term}>
                  {e.term}
                </span>
                <span className="faint shrink-0">{labelOf(categories, e.cat, e.sub, locale)}</span>
                <span className="faint shrink-0">w{e.w}</span>
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[11px]"
                  disabled={busy}
                  onClick={() =>
                    wrap(async () => {
                      setTerms((await window.a.taxonomy.termRemove(e.term)) as Term[])
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded border p-2" style={{ borderColor: 'var(--line)' }}>
        <div className="text-[12px] font-medium">
          {t('settings.learnedRules')} <span className="faint">({learning.length})</span>
        </div>
        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('settings.learnedRulesHint')}
        </div>
        {learning.length === 0 ? (
          <div className="mt-2 text-[11px] faint">{t('settings.learnedEmpty')}</div>
        ) : (
          <div className="mt-2 max-h-[190px] overflow-y-auto">
            {learning.map((r) => (
              <div key={r.id} className="flex items-center gap-2 border-b py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
                <span className="min-w-0 flex-1 truncate" title={r.token}>
                  {r.token}
                </span>
                <span className="shrink-0">{labelOf(categories, r.category, r.subcategory, locale)}</span>
                <span className="faint shrink-0">×{r.hits}</span>
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[11px]"
                  disabled={busy}
                  onClick={() =>
                    wrap(async () => {
                      setLearning(await window.a.taxonomy.learningDelete(r.id))
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
