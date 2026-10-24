import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from '../../src/renderer/i18n/zh-CN.json'
import { TemplateEditorPanel } from '../../src/renderer/vpm/components/settings/TemplateEditorPanel'
import type { VpmTemplateDto } from '../../src/shared/vpm/dto'

const templates: VpmTemplateDto[] = [
  {
    id: 'builtin.blank',
    name: '空白工程',
    description: '只有最小骨架，不装任何依赖。',
    source: 'builtin',
    base: null,
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: {},
    unitypackages: [],
    favorite: false,
    visible: true,
    lastUsedAt: null,
    builtin: true,
    broken: false,
    issues: []
  },
  {
    id: 'builtin.avatars',
    name: '角色工程',
    description: '带 VRChat 角色 SDK 的最小工程。',
    source: 'builtin',
    base: 'builtin.blank',
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: { 'com.vrchat.avatars': '>=3.0.0 <4.0.0' },
    unitypackages: [],
    favorite: false,
    visible: true,
    lastUsedAt: null,
    builtin: true,
    broken: false,
    issues: []
  },
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    name: '我的角色工程',
    description: '角色 SDK + 常用工具包。',
    source: 'user',
    base: 'builtin.avatars',
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: { 'com.vrchat.avatars': '>=3.0.0 <4.0.0', 'com.example.tools': '^1.2.0' },
    unitypackages: [{ path: 'files/tools.unitypackage', name: 'tools' }],
    favorite: true,
    visible: true,
    lastUsedAt: 1_700_000_000_000,
    builtin: false,
    broken: false,
    issues: []
  },
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    name: '旧的世界模板',
    description: '暂时从列表移除，文件仍在。',
    source: 'user',
    base: null,
    unity: { min: '2022.3', max: '2022.3', recommended: null },
    dependencies: { 'com.vrchat.worlds': '>=3.0.0 <4.0.0' },
    unitypackages: [],
    favorite: false,
    visible: false,
    lastUsedAt: null,
    builtin: false,
    broken: false,
    issues: []
  },
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    name: '损坏的模板',
    description: 'template.json 被手动改坏了。',
    source: 'user',
    base: null,
    unity: { min: '2022.3', max: null, recommended: null },
    dependencies: {},
    unitypackages: [],
    favorite: false,
    visible: true,
    lastUsedAt: null,
    builtin: false,
    broken: true,
    issues: ['notObject:template.json']
  }
]

const stub = {
  vpm: {
    templateList: async (input?: { includeHidden?: boolean }) =>
      input?.includeHidden ? templates : templates.filter((item) => item.visible || item.builtin),
    templateFavorite: async (input: { id: string; favorite: boolean }) => {
      const item = templates.find((entry) => entry.id === input.id)
      if (item) item.favorite = input.favorite
      return item
    },
    templateCreate: async () => templates[2],
    templateUpdate: async () => templates[2],
    templateDuplicate: async () => templates[2],
    templateRemoveReference: async () => templates[3],
    templateRestore: async () => templates[3]
  },
  system: { pickDirectory: async () => null, openExternal: async () => undefined },
  on: () => () => undefined
}
;(window as unknown as { a: unknown }).a = stub

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: { 'zh-CN': { translation: zh } },
  interpolation: { escapeValue: false }
})

function App(): JSX.Element {
  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto max-w-[1000px] rounded border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <TemplateEditorPanel />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
