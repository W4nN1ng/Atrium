import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8')

describe('VPM plan preview wiring', () => {
  it('routes plan IPC through the API wrapper', () => {
    const api = read('src/renderer/vpm/api.ts')
    expect(api).toContain('planResolve(')
    expect(api).toContain('planExplain(')
    const sheet = read('src/renderer/vpm/components/plan/VpmPlanSheet.tsx')
    expect(sheet).not.toContain('window.a.vpm')
    const hook = read('src/renderer/vpm/hooks/useVpmPlan.ts')
    expect(hook).toContain('vpmApi.planResolve')
  })

  it('keeps the plan sheet read-only and makes apply visibly unavailable', () => {
    const sheet = read('src/renderer/vpm/components/plan/VpmPlanSheet.tsx')
    expect(sheet).toContain('vpm.plan.applyLater')
    expect(sheet).toContain('disabled')
    expect(sheet).toContain('vpm.plan.previewAll')
    expect(sheet).toContain('vpm.plan.previewPackage')
    expect(sheet).toContain('vpm.plan.conflicts')
    expect(sheet).toContain('vpm.plan.missing')
    expect(sheet).toContain('vpm.plan.downloads')
    expect(sheet).toContain('data-vpm-plan')
    expect(sheet).not.toMatch(/\b(installPackage|applyPlan|executePlan|vpmInstall)\b/)
  })

  it('opens the plan sheet from project details without duplicating parse logic', () => {
    const panel = read('src/renderer/vpm/components/projects/VpmProjectsSection.tsx')
    expect(panel).toContain('VpmPlanSheet')
    expect(panel).toContain('vpm.plan.preview')
    expect(panel).not.toMatch(/buildChangePlan|resolveVpmDependencies/)
  })

  it('has complete trilingual plan labels', () => {
    for (const locale of ['zh-CN', 'en', 'ja']) {
      const data = JSON.parse(read(`src/renderer/i18n/${locale}.json`))
      const plan = data.vpm.plan
      for (const key of [
        'title',
        'preview',
        'previewAll',
        'previewPackage',
        'apply',
        'applyLater',
        'blocked',
        'ready',
        'requiresUnityClosed',
        'conflicts',
        'missing',
        'warnings',
        'downloads',
        'action',
        'reason',
        'conflict',
        'risk'
      ]) {
        expect(plan, `${locale} missing vpm.plan.${key}`).toHaveProperty(key)
      }
      for (const action of ['install', 'upgrade', 'downgrade', 'reinstall', 'remove', 'keep']) {
        expect(plan.action[action], `${locale} ${action}`).toBeTruthy()
      }
    }
  })
})
