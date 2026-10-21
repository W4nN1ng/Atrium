import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { initI18n } from '../../src/renderer/i18n'
import { cleanText, isHttpLink, repoErrorLabel, repoHost, vpmCodeLabel } from '../../src/renderer/vpm/lib/view'

const ROOT = path.resolve(__dirname, '../..')

beforeEach(async () => {
  await initI18n('zh-CN')
})

describe('VPM renderer helpers', () => {
  it('formats repository hosts and removes control characters from display text', () => {
    expect(repoHost('https://example.test:8443/repo.json')).toBe('example.test:8443')
    expect(repoHost('not a url')).toBe('not a url')
    expect(cleanText('\u0000a\nb\tc\u007f')).toBe('a\nb\tc')
    expect(cleanText(null)).toBe('')
  })

  it('accepts only credential-free http(s) external links', () => {
    expect(isHttpLink('https://example.test/docs')).toBe(true)
    expect(isHttpLink('http://example.test/docs')).toBe(true)
    expect(isHttpLink('https://user:pass@example.test/docs')).toBe(false)
    expect(isHttpLink('javascript:alert(1)')).toBe(false)
    expect(isHttpLink('file:///C:/secret')).toBe(false)
    expect(isHttpLink(null)).toBe(false)
  })

  it('maps repo error codes through i18n with a code fallback', () => {
    expect(repoErrorLabel('vpmHttpTimeout')).toBe('网络请求超时。')
    expect(repoErrorLabel('vpmFutureUnknownCode')).toBe('vpmFutureUnknownCode')
    expect(repoErrorLabel(null)).toBe('')
    expect(vpmCodeLabel('vpmProjectInvalid')).toBe('这不是有效的 Unity 工程，或工程版本文件损坏。')
    expect(vpmCodeLabel('vpmProjectScanTruncated')).toContain('扫描达到上限')
    expect(vpmCodeLabel('vpmFutureUnknownCode')).toBe('vpmFutureUnknownCode')
  })

  it('keeps the UI on the API wrapper and exposes no install action', () => {
    const files = [
      'src/renderer/vpm/VpmWorkspace.tsx',
      'src/renderer/vpm/hooks/useVpmRepos.ts',
      'src/renderer/vpm/components/ReposPanel.tsx',
      'src/renderer/vpm/components/CatalogDialog.tsx',
      'src/renderer/vpm/hooks/useProjects.ts',
      'src/renderer/vpm/components/projects/VpmProjectsSection.tsx'
    ]
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(text, `${file} 不得直接摸 preload`).not.toContain('window.a.vpm')
    }
    const catalog = fs.readFileSync(path.join(ROOT, 'src/renderer/vpm/components/CatalogDialog.tsx'), 'utf8')
    expect(catalog).toContain('vpmApi.catalogQuery')
    expect(catalog).toContain('vpmApi.packageDetail')
    expect(catalog).toContain('vpmApi.openExternal')
    expect(catalog).not.toMatch(/\b(installPackage|repoInstall|vpmInstall)\b/)
    const settings = fs.readFileSync(path.join(ROOT, 'src/renderer/vpm/VpmSettings.tsx'), 'utf8')
    expect(settings).toContain('VpmWorkspace')

    const projectHook = fs.readFileSync(path.join(ROOT, 'src/renderer/vpm/hooks/useProjects.ts'), 'utf8')
    expect(projectHook).toContain('vpmApi.projectDetail')
    expect(projectHook).toContain('vpmApi.projectAdd')
    expect(projectHook).toContain('vpmApi.projectRemove')
    const projectPanel = fs.readFileSync(
      path.join(ROOT, 'src/renderer/vpm/components/projects/VpmProjectsSection.tsx'),
      'utf8'
    )
    expect(projectPanel).not.toMatch(/\b(installPackage|vpmInstall|upgradePackage|uninstallPackage)\b/)
  })
})
