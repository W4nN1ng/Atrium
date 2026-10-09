import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CategoryConfig, LocaleKey } from '../../shared/types'
import { addSynonym, deadSynonyms, removeSynonym, synonymsDirty } from '../../shared/synonymEdit'
import { useUi } from '../stores/ui'
import { Button } from './ui'

/**
 * R4 ④ · 分类口语同义词（设置 → 分类）。
 *
 * ## 为什么要给分类表加这一栏
 *
 * 他的库里管 `clothing` 叫"衣服"，而分类表的标签是"服装" —— 检索层只认标签，
 * 于是搜"衣服"什么都搜不到。`docs/SEARCH.md` §4 早就写了补法：**给分类表加 synonyms**，
 * 而不是在检索层硬编码词表。加了之后 `searchForms` 会把每个词展开成
 * "原文 + 拼音 + 罗马字 + 假名"，所以写一条 `衣服` 就同时能被 `yifu` 命中。
 *
 * ## 界面上刻意做的两件事
 *
 *  1. **单字当场拒绝**：`aliases.ts:pushUnique` 丢掉长度 < 2 的别名，
 *     所以「包」存进去也不生效 —— 那是最坏的一种"看着有其实没有"，必须当场说；
 *  2. **保存之后立刻重建索引**（主进程 `categories:save` 里做的），
 *     不然改完要重启才能搜到，用户会以为这个输入框是摆设。
 *
 * 判据（能不能加、算不算改过）全在 `shared/synonymEdit.ts`，这里只管排版。
 */
export function SynonymEditor({ categories }: { categories: CategoryConfig | null }): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const toast = useUi((s) => s.toast)
  const [draft, setDraft] = useState<CategoryConfig | null>(null)
  const [picked, setPicked] = useState('')
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!categories) return
    setDraft(JSON.parse(JSON.stringify(categories)) as CategoryConfig)
    setPicked((cur) => cur || categories.categories[0]?.key || '')
  }, [categories])

  const locale = i18n.language as LocaleKey
  const cat = useMemo(() => draft?.categories.find((c) => c.key === picked) ?? null, [draft, picked])
  const dirty = synonymsDirty(draft, categories)

  if (!draft || !categories) return null
  /**
   * 收窄过一次就固定成 `cfg`：`function` 声明会被提升，TS 不看提升点之后的收窄，
   * 闭包里写 `draft` 照样报 "possibly null"。
   */
  const cfg = draft

  const nameOf = (x: { key: string; label: Partial<Record<LocaleKey, string>> }): string =>
    x.label[locale] ?? x.label['zh-CN'] ?? x.key

  function add(nodePath: string, word: string): void {
    const [ck, sk] = nodePath.split('/')
    const c = cfg.categories.find((x) => x.key === ck)
    if (!c) return
    const target = sk ? c.subcategories.find((s) => s.key === sk) : c
    if (!target) return
    /**
     * 判据先在外面跑完再 setState。
     * 把 `toast()` 塞进 `setDraft( updater )` 里是错的：updater 可能被调用两次
     * （StrictMode 就是专门来测这个的），同一条拒绝会弹两次。
     */
    const r = addSynonym(target.synonyms, word)
    if (r.rejected) {
      toast('warn', t(r.rejected.key, r.rejected.params ?? {}))
      setInputs((cur) => ({ ...cur, [nodePath]: '' }))
      return
    }
    setDraft((cur) => {
      if (!cur) return cur
      const next = JSON.parse(JSON.stringify(cur)) as CategoryConfig
      const nc = next.categories.find((x) => x.key === ck)
      if (!nc) return cur
      const nt = sk ? nc.subcategories.find((s) => s.key === sk) : nc
      if (!nt) return cur
      nt.synonyms = r.list
      return next
    })
    setInputs((cur) => ({ ...cur, [nodePath]: '' }))
  }

  function remove(nodePath: string, word: string): void {
    setDraft((cur) => {
      if (!cur) return cur
      const next = JSON.parse(JSON.stringify(cur)) as CategoryConfig
      const [ck, sk] = nodePath.split('/')
      const c = next.categories.find((x) => x.key === ck)
      if (!c) return cur
      const target = sk ? c.subcategories.find((s) => s.key === sk) : c
      if (!target) return cur
      target.synonyms = removeSynonym(target.synonyms, word)
      return next
    })
  }

  async function save(): Promise<void> {
    setBusy(true)
    try {
      const next = await window.a.categories.save(cfg)
      setDraft(JSON.parse(JSON.stringify(next)) as CategoryConfig)
      toast('ok', t('settings.synonymsSaved'))
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 一行：节点名 + 现有口语（可删）+ 一个加词输入框。
   *
   * ⚠ 这是**普通函数调用**（`{row({...})}`），不是组件（不是 `<Row/>`）。
   * 定义在 render 里的组件每次渲染都是新的类型，React 会整棵重挂 ——
   * 表现是"输入框打一个字就掉焦点"，而这种界面 bug 单元测试永远看不见。
   */
  const row = (props: { nodePath: string; title: string; words: string[] }): JSX.Element => (
    <div key={props.nodePath} className="flex flex-col gap-1 border-t py-1.5" style={{ borderColor: 'var(--line)' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-[11px]" style={{ color: 'var(--muted)', minWidth: 96 }}>
          {props.title}
        </span>
        {props.words.map((w) => {
          const dead = deadSynonyms([w]).length > 0
          return (
            <span
              key={w}
              className="chip"
              title={dead ? t('settings.synonymDeadWarn') : w}
              style={dead ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : undefined}
            >
              {w}
              <button type="button" className="ml-1" disabled={busy} onClick={() => remove(props.nodePath, w)}>
                ×
              </button>
            </span>
          )
        })}
        {!props.words.length ? <span className="faint text-[11px]">{t('settings.synonymsNone')}</span> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="input"
          style={{ width: 160 }}
          placeholder={t('settings.synonymsAddPh')}
          value={inputs[props.nodePath] ?? ''}
          onChange={(e) => setInputs({ ...inputs, [props.nodePath]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (inputs[props.nodePath] ?? '').trim()) add(props.nodePath, inputs[props.nodePath])
          }}
        />
        <Button disabled={busy || !(inputs[props.nodePath] ?? '').trim()} onClick={() => add(props.nodePath, inputs[props.nodePath])}>
          {t('settings.synonymsAdd')}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="rounded border p-2" style={{ borderColor: 'var(--line)' }}>
      <div className="text-[12px] font-medium">{t('settings.synonymsTitle')}</div>
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        {t('settings.synonymsHint')}
      </div>
      {/* Q5 的裁定：不引汉字→日语读音的词典（几 MB、多音字照样错），
          但把"这条路怎么走"写在界面上，不然用户只会以为程序搜不到是 bug。 */}
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--faint)' }}>
        {t('settings.synonymsKanjiHint')}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select className="input" style={{ width: 160 }} value={picked} onChange={(e) => setPicked(e.target.value)}>
          {draft.categories.map((c) => (
            <option key={c.key} value={c.key}>
              {nameOf(c)}
            </option>
          ))}
        </select>
        {dirty ? <span className="faint text-[11px]">{t('settings.synonymsUnsaved')}</span> : null}
        <Button variant="accent" disabled={busy || !dirty} onClick={() => void save()}>
          {t('common.save')}
        </Button>
        <Button disabled={busy} onClick={() => setDraft(JSON.parse(JSON.stringify(categories)) as CategoryConfig)}>
          {t('settings.synonymsRevert')}
        </Button>
      </div>

      {cat ? (
        <div className="mt-1">
          {row({ nodePath: cat.key, title: nameOf(cat), words: cat.synonyms ?? [] })}
          {cat.subcategories.map((s) =>
            row({ nodePath: cat.key + '/' + s.key, title: nameOf(s), words: s.synonyms ?? [] })
          )}
        </div>
      ) : null}
    </div>
  )
}
