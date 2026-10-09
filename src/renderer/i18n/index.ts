import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './zh-CN.json'
import en from './en.json'
import ja from './ja.json'
import type { LocaleKey } from '../../shared/types'

export const LOCALES: LocaleKey[] = ['zh-CN', 'en', 'ja']
export const LOCALE_LABELS: Record<LocaleKey, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語'
}

const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
  ja: { translation: ja }
}

export async function initI18n(lang: LocaleKey): Promise<typeof i18next> {
  if (i18next.isInitialized) {
    await i18next.changeLanguage(lang)
    return i18next
  }
  await i18next.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: 'zh-CN',
    supportedLngs: LOCALES,
    interpolation: { escapeValue: false },
    returnNull: false
  })
  return i18next
}

export function changeLocale(lang: LocaleKey): Promise<unknown> {
  return i18next.changeLanguage(lang)
}

export default i18next
