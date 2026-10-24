import type { TemplateManifest } from '../../../shared/vpm/domain/template'

/**
 * 内置模板：**代码生成，不落盘、不入库**。
 *
 * 清房约束（`docs/VPM-CLEANROOM.md` §3.3）：
 * - 不含任何第三方美术/场景/材质/图标/ProjectSettings；
 * - 只写包 ID + 版本范围，SDK 在安装时从官方仓库取；
 * - 名称/描述用我们自己的文案，三语显示名由界面映射，不写进模板文件。
 *
 * 依赖范围刻意用宽区间（不是具体版本）：具体版本可能被 yank，
 * 让解析器在"当前稳定版"里挑。
 */
export const BUILTIN_TEMPLATES: readonly TemplateManifest[] = [
  {
    schemaVersion: 1,
    id: 'builtin.blank',
    name: '空白工程',
    description: '只有最小工程骨架（Packages/、ProjectSettings/、Assets/ 与版本文件），不含任何包。',
    base: null,
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: {},
    unitypackages: [],
    settings: {},
    extra: {}
  },
  {
    schemaVersion: 1,
    id: 'builtin.avatars',
    name: '角色工程',
    description: '空白骨架 + VRChat Avatars SDK 依赖（安装时从官方仓库获取）。',
    base: 'builtin.blank',
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: { 'com.vrchat.avatars': '>=3.0.0 <4.0.0' },
    unitypackages: [],
    settings: {},
    extra: {}
  },
  {
    schemaVersion: 1,
    id: 'builtin.worlds',
    name: '世界工程',
    description: '空白骨架 + VRChat Worlds SDK 依赖（安装时从官方仓库获取）。',
    base: 'builtin.blank',
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: { 'com.vrchat.worlds': '>=3.0.0 <4.0.0' },
    unitypackages: [],
    settings: {},
    extra: {}
  }
]

export function builtinTemplate(id: string): TemplateManifest | null {
  return BUILTIN_TEMPLATES.find((item) => item.id === id) ?? null
}
