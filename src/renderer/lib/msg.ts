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

/** Electron prefixes thrown IPC errors; translate the embedded key, preserving unknown errors. */
/** 从错误里拆出 `i18n:<key>` 与主进程附带的 params（`key|{...}`）。 */
export function errorParts(error: unknown): {
  key: string | null
  params: Record<string, string | number>
} {
  const text = error instanceof Error ? error.message : String(error)
  const key = text.match(/i18n:([A-Za-z0-9_.]+)/)?.[1] ?? null
  const tail = text.match(/\|(\{[\s\S]*\})\s*$/)?.[1]
  let params: Record<string, string | number> = {}
  if (tail) {
    try {
      const parsed: unknown = JSON.parse(tail)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        params = parsed as Record<string, string | number>
      }
    } catch {
      /* 解析失败就当没有参数 */
    }
  }
  return { key, params }
}

export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const { key, params } = errorParts(error)
  if (key && i18next.exists(key)) return String(i18next.t(key, params))
  const legacy = text.match(/\b(project\.connection[A-Za-z]+)\b/)?.[1]
  return legacy && i18next.exists(legacy) ? String(i18next.t(legacy)) : text
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
