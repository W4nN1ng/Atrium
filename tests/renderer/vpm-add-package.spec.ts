import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 项目包管理必须能直接添加仓库里的包。
 *
 * 这不是 ALCOM 独有行为：工程里已安装的包列表之外，还需要一个按仓库搜索、
 * 选版本、再走现有变更预览的入口。这里锁住入口与数据来源，避免以后又只剩
 * “从本地装包”。
 */

const ROOT = path.resolve(__dirname, '../..')

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function locale(name: string): Record<string, unknown> {
  return JSON.parse(read(`src/renderer/i18n/${name}.json`)) as Record<string, unknown>
}

function at(value: unknown, pathParts: readonly string[]): unknown {
  let current: unknown = value
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

describe('P9 hotfix: add repository package from project panel', () => {
  for (const language of ['zh-CN', 'en', 'ja']) {
    it(`${language} has the add-package copy`, () => {
      const json = locale(language)
      expect(typeof at(json, ['vpm', 'packages', 'add'])).toBe('string')
      for (const key of ['title', 'intro', 'cancel', 'add', 'installed', 'version', 'select']) {
        expect(typeof at(json, ['vpm', 'addPackage', key]), `${language}: ${key}`).toBe('string')
      }
    })
  }

  it('opens a repository picker from the project package panel', () => {
    const panel = read('src/renderer/vpm/components/packages/VpmPackagesPanel.tsx')
    expect(panel).toContain("t('vpm.packages.add')")
    expect(panel).toContain('<VpmAddPackageDialog')
    expect(panel).toContain('catalogByName')
    expect(panel).toContain('actionFor(current, pick.version)')
  })

  it('queries the package catalog and reuses the normal plan sheet', () => {
    const dialog = read('src/renderer/vpm/components/packages/VpmAddPackageDialog.tsx')
    expect(dialog).toContain('vpmApi.catalogQuery')
    expect(dialog).toContain('vpmApi.packageDetail')
    expect(dialog).toContain('onPick({ name: selected, version })')
    // 不直接调窗口 API，也不自己写计划。
    expect(dialog).not.toContain('window.a')
    expect(dialog).not.toContain('planApply')
    const panel = read('src/renderer/vpm/components/packages/VpmPackagesPanel.tsx')
    expect(panel).toContain("sheet === 'add'")
    expect(panel).toContain('addRequests')
  })
})
