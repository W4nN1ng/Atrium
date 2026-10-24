import type { TemplateManifest, TemplateSource } from '../../../shared/vpm/domain/template'

/** `vpm_template` 的一行；文件才是用户模板的真相，这里只是索引。 */
export interface TemplateRow {
  id: string
  name: string
  description: string | null
  source: TemplateSource
  format: 'atrium'
  baseId: string | null
  unityRange: string | null
  dependenciesJson: string
  unitypackagesJson: string
  settingsJson: string
  favorite: boolean
  visible: boolean
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface TemplateListEntry {
  id: string
  name: string
  description: string | null
  source: TemplateSource
  base: string | null
  unity: TemplateManifest['unity']
  dependencies: Record<string, string>
  unitypackages: TemplateManifest['unitypackages']
  favorite: boolean
  visible: boolean
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
  /** 内置模板：代码生成，不落盘、不可编辑/删除。 */
  builtin: boolean
  /** 用户模板文件缺失/损坏；界面要显示"需要修复"，不要假装正常。 */
  broken: boolean
  issues: string[]
}

export interface TemplateListOptions {
  includeHidden?: boolean
}

export interface CreateTemplateInput {
  id?: string
  name: string
  description?: string | null
  base?: string | null
  unity?: Partial<TemplateManifest['unity']>
  dependencies?: Record<string, string>
  unitypackages?: TemplateManifest['unitypackages']
  settings?: Record<string, unknown>
}

export interface UpdateTemplateInput {
  name?: string
  description?: string | null
  base?: string | null
  unity?: Partial<TemplateManifest['unity']>
  dependencies?: Record<string, string>
  unitypackages?: TemplateManifest['unitypackages']
  settings?: Record<string, unknown>
}
