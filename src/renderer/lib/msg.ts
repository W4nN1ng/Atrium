import i18next from 'i18next'

/**
 * 主进程只回传 i18n key + 参数，文案在渲染进程出（第 1 份 F11：不允许硬编码字符串）。
 * key 缺失时退回主进程给的原文，至少不会显示成空白或 key 名。
 */
export function msg(
  key: string | undefined,
  params: Record<string, string | number> | undefined,
  fallback: string | undefined
): string {
  if (key && i18next.exists(key)) return String(i18next.t(key, params ?? {}))
  return fallback ?? ''
}

export interface ToastPayload {
  tone?: 'ok' | 'warn' | 'bad' | 'info'
  text?: string
  textKey?: string
  textParams?: Record<string, string | number>
}

export function toastText(p: ToastPayload): string {
  return msg(p.textKey, p.textParams, p.text)
}

/** 拖放被拒的原因：code 是 err.* 键 */
export function rejectText(r: {
  path: string
  code?: string
  params?: Record<string, string | number>
  reason: string
}): string {
  const why = msg(r.code, r.params, r.reason)
  const name = r.path.split(/[\\/]/).pop() ?? r.path
  return `${name}：${why}`
}
