import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * P9-B：恢复入口的静态合同。
 *
 * - 三语都必须有每个恢复原因的文案，不能只做中文；
 * - 操作对话框必须把"原因/能否执行"渲染出来，并提供恢复按钮；
 * - 历史行必须能打开同一条恢复动作；
 * - 渲染层不能自己拼 action（动作只能由主进程判定）。
 */

const ROOT = path.resolve(__dirname, '../..')

const REASONS = [
  'terminal',
  'manifest_committed',
  'before_commit',
  'journal_missing',
  'journal_invalid',
  'journal_mismatch',
  'project_missing',
  'project_changed',
  'project_busy',
  'unity_running'
] as const

function readLocale(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src/renderer/i18n', `${name}.json`), 'utf8')
  ) as Record<string, unknown>
}

function at(value: unknown, pathParts: readonly string[]): unknown {
  let current: unknown = value
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

describe('P9-B recovery UI contract', () => {
  for (const locale of ['zh-CN', 'en', 'ja']) {
    it(`${locale} explains every recovery reason and offers the same actions`, () => {
      const json = readLocale(locale)
      for (const reason of REASONS) {
        const text = at(json, ['vpm', 'packages', 'run', 'recovery', 'reason', reason])
        expect(typeof text, `${locale}: ${reason}`).toBe('string')
        expect(String(text).trim().length, `${locale}: ${reason}`).toBeGreaterThan(0)
      }
      for (const key of ['recover', 'recovering', 'recoveringTitle', 'recheck']) {
        expect(typeof at(json, ['vpm', 'packages', 'run', key]), `${locale}: run.${key}`).toBe(
          'string'
        )
      }
      expect(
        typeof at(json, ['vpm', 'packages', 'run', 'recovery', 'runningHint']),
        `${locale}: runningHint`
      ).toBe('string')
      expect(typeof at(json, ['vpm', 'packages', 'history', 'recover'])).toBe('string')
    })
  }

  it('renders the decision and a retry button in the result dialog', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'src/renderer/vpm/components/packages/VpmOperationDialog.tsx'),
      'utf8'
    )
    expect(source).toContain('data-vpm-operation-recovery')
    expect(source).toContain('result.recovery.reason')
    expect(source).toContain('result.recovery.canApply')
    expect(source).toContain('onRecover')
  })

  it('exposes recovery from both history and the shared operation hook', () => {
    const panel = fs.readFileSync(
      path.join(ROOT, 'src/renderer/vpm/components/packages/VpmPackagesPanel.tsx'),
      'utf8'
    )
    expect(panel).toContain('ops.recover(item.operationId)')
    expect(panel).toContain('onRecover=')
    const hook = fs.readFileSync(
      path.join(ROOT, 'src/renderer/vpm/hooks/useVpmOperations.ts'),
      'utf8'
    )
    expect(hook).toContain('vpmApi.operationRecover(operationId)')
    // 动作参数不能从渲染层传下去：只传 operationId。
    expect(hook).not.toMatch(/operationRecover\([^)]*,\s*\{/)
  })
})
