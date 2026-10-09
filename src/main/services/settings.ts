import Store from 'electron-store'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_HOTKEY } from '../../shared/constants'
import { P } from './paths'

/**
 * 设置持久化用 electron-store（第 1 份 §3）。
 * 这里锁 8.x：v10+ 是纯 ESM，主进程产物是 CJS，混用会在打包后炸。
 *
 * 两处刻意的默认值偏离，README 里也写了：
 *  - autoExtract 默认 false：实测库 25 GB、E 盘只剩 53 GB，全量解压会把盘写满；
 *  - autoLaunch 默认 false：首启向导（M7）里再让他确认一次，不由程序擅自写注册表启动项。
 */
import { DEFAULTS } from '../../shared/settingsDefaults'

export { DEFAULTS }

type Listener = (next: AppSettings, changed: Array<keyof AppSettings>) => void

let store: Store<AppSettings> | null = null
const listeners = new Set<Listener>()

export function initSettings(): Store<AppSettings> {
  if (store) return store
  store = new Store<AppSettings>({
    name: 'settings',
    cwd: P.root(),
    defaults: DEFAULTS,
    clearInvalidConfig: true,
    accessPropertiesByDotNotation: false
  })
  return store
}

function requireStore(): Store<AppSettings> {
  if (!store) return initSettings()
  return store
}

export function getSettings(): AppSettings {
  const s = requireStore()
  const out = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as Array<keyof AppSettings>) {
    const v = s.get(k as string) as AppSettings[keyof AppSettings] | undefined
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const s = requireStore()
  const changed: Array<keyof AppSettings> = []
  for (const k of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[k]
    s.set(k as string, value)
    changed.push(k)
  }
  if (changed.length) {
    const next = getSettings()
    for (const cb of listeners) {
      try {
        cb(next, changed)
      } catch {
        /* 监听器出错不影响写入 */
      }
    }
  }
  return getSettings()
}

export function resetSettings(): AppSettings {
  const s = requireStore()
  s.clear()
  return getSettings()
}

export function onSettingsChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * 库根没设过就不许往库里写东西 —— **所有写路径都走这一个函数**。
 *
 * ## 为什么强调"一个函数"
 *
 * M7 之前它定义了但**全仓零调用**，而 `ingest/api.ts` 的 `commit()` 里自己写了一句
 * `if (!s.libraryRoot) throw new Error('还没设置库根目录（设置 → 库）')`。
 * 那句本身是对的，问题是它把口径散在了调用点上：以后再加写路径（收编、批量入库、
 * 首启向导之后的"接管"）就会各写各的一句，或者干脆忘了写。
 * 现在文案只有这一处，`tests/services/library-root-guard.spec.ts` 既钉这个函数会抛，
 * 也钉 `ingest/api.ts` 真的调了它（读源码那条是防它再变成死代码 ——
 * 和 `bridge-ask-wiring.spec.ts` 钉 `bridgeAutoInstall` 是同一个套路）。
 */
export function libraryRootOrThrow(): string {
  const root = getSettings().libraryRoot
  if (!root || !root.trim()) throw new Error('还没设置库根目录（首次启动向导 → 设置 → 库）')
  return root
}
