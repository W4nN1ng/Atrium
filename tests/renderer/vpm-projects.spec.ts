import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8')

function localeKeys(locale: string): Record<string, unknown> {
  return JSON.parse(read(`src/renderer/i18n/${locale}.json`)).vpm.projects
}

describe('VPM project page wiring', () => {
  it('lazy-loads the project panel and leaves the core project page VPM-static-free', () => {
    const page = read('src/renderer/pages/Project.tsx')
    expect(page).toContain("import('../vpm/components/projects/VpmProjectsSection')")
    expect(page).toContain('<Suspense fallback={null}>')
    expect(page).toContain('<VpmProjectsSection')
    expect(page).toContain('targetProjectId={connection.targetProjectId}')
    expect(page).toContain('targetPending={connection.targetPending === true}')
    expect(page).not.toMatch(/from '\.\.\/vpm\//)
  })

  it('keeps the project panel focused: open/manage/⋯ with no install actions', () => {
    const panel = read('src/renderer/vpm/components/projects/VpmProjectsSection.tsx')
    const hook = read('src/renderer/vpm/hooks/useProjects.ts')
    expect(hook).toContain('vpmApi.projectDetail')
    expect(hook).toContain('vpmApi.projectAdd')
    expect(hook).toContain('vpmApi.projectRemove')
    for (const action of ['select', 'rescan', 'openFolder', 'remove']) {
      expect(panel, action).toContain(`projects.${action}`)
    }
    expect(panel).toContain('projects.add')
    expect(panel).toContain('vpm.projects.removeBody')
    expect(panel).not.toMatch(/\b(installPackage|vpmInstall|upgradePackage|uninstallPackage)\b/)
    expect(panel).toContain('vpm.projects.openFolder')
    // R3/R8：行内只留「打开 / 管理 / ⋯」，其余进菜单；详情 footer 只留两个按钮
    expect(panel).toContain('vpm.projects.open')
    expect(panel).toContain('vpm.projects.manage')
    expect(panel).not.toContain('vpm.projects.readOnly')
    expect(panel).not.toContain('vpm.projects.legacyHint')
    expect(panel).toContain('vpm.projects.advanced')
  })

  it('exposes the project API through the renderer wrapper only', () => {
    const api = read('src/renderer/vpm/api.ts')
    for (const method of [
      'projectsList',
      'projectDetail',
      'projectAdd',
      'projectRemove',
      'projectRescan',
      'projectOpenFolder'
    ]) {
      expect(api, method).toContain(`${method}(`)
    }
    expect(api).toContain('window.a.system.pickDirectory')
  })

  it('has complete trilingual project labels and state labels', () => {
    for (const locale of ['zh-CN', 'en', 'ja']) {
      const keys = localeKeys(locale)
      for (const key of [
        'title',
        'readOnly',
        'add',
        'empty',
        'detailTitle',
        'openFolder',
        'rescan',
        'remove',
        'removeBody',
        'legacyHint',
        'stateLabel',
        'state',
        'match',
        'confidence'
      ]) {
        expect(keys, `${locale} missing ${key}`).toHaveProperty(key)
      }
      expect(keys).toMatchObject({
        state: {
          installed: expect.any(String),
          missing: expect.any(String),
          unlisted: expect.any(String),
          mismatch: expect.any(String),
          protected: expect.any(String)
        },
        match: {
          packageJson: expect.any(String),
          legacyFolder: expect.any(String),
          legacyFile: expect.any(String),
          legacyPackage: expect.any(String)
        }
      })
    }
  })
})
