import type { AApi } from '../shared/api'

declare global {
  interface Window {
    /** preload 暴露的唯一入口，白名单外的东西拿不到 */
    a: AApi
  }
}

export {}
