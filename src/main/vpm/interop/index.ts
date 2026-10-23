/**
 * 互操作模块的公共入口。
 *
 * 跨模块（`ipc/`、`gate`、`main/index.ts`）只能从这里引 —— 架构闸门要求
 * 文件夹模块对外只暴露 `index`，直接引 `interop/vcc` 这类内部文件会被判红。
 */
export {
  deepLinksInArgv,
  parseDeepLink,
  type DeepLinkIntent,
  type DeepLinkRejection,
  type DeepLinkResult
} from './deeplink'
export { parseVccSettings, readVccSettings, type VccRepo, type VccSettings } from './vcc'
export {
  ATRIUM_TEMPLATE_SCHEMA,
  exportTemplate,
  parseTemplateFile,
  type ImportedTemplate,
  type TemplateSource
} from './templateIO'
