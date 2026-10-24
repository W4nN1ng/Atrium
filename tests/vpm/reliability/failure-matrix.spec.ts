import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TRANSACTION_HOOK_POINTS } from '../../../src/main/vpm/install'

/**
 * P9-B：失败注入点不能"声明了但永远不触发"。
 *
 * 这类死点会让失败矩阵看起来是 24/24，实际却少一格。
 * 用源码计数做静态闸门：每个点至少出现两次（常量表 + `point(...)` 调用）。
 */

const ROOT = path.resolve(__dirname, '../../..')

describe('P9-B failure hook matrix', () => {
  it('declares 24 unique points', () => {
    expect(TRANSACTION_HOOK_POINTS).toHaveLength(24)
    expect(new Set(TRANSACTION_HOOK_POINTS).size).toBe(24)
  })

  it('fires every declared hook point from the transaction', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'src/main/vpm/install/transaction.ts'),
      'utf8'
    )
    const dead = TRANSACTION_HOOK_POINTS.filter(
      (point) => source.split(`'${point}'`).length - 1 < 2
    )
    expect(dead, `声明但未触发：${dead.join(', ')}`).toEqual([])
  })
})
