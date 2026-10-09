import { describe, it, expect } from 'vitest'
import { STAGE_PENDING, STAGE_TERMINAL, queueActionFor } from '../../src/main/ingest/queuePolicy'
import type { IngestItemState } from '../../src/shared/api'

/**
 * 收件箱持久化的阶段策略。
 *
 * 这份测试存在的理由：`STAGE_PENDING` / `STAGE_TERMINAL` 如果写错，
 * 表现是"重启后卡片凭空消失"或者"丢掉的卡片自己爬回来"，两种都很难在开发机上碰见
 * （要真重启程序）。所以把策略抽成纯函数在这里钉死。
 */

const ALL_STAGES: Array<IngestItemState['stage']> = [
  'queued',
  'hashing',
  'detecting',
  'extracting',
  'fingerprinting',
  'classifying',
  'awaiting_confirm',
  'committing',
  'done',
  'failed',
  'cancelled',
  'duplicate'
]

describe('阶段 → 队列动作', () => {
  it('等人处理的三个阶段落盘', () => {
    for (const st of ['awaiting_confirm', 'duplicate', 'failed'] as const) {
      expect(queueActionFor(st, 'E:\\a.zip')).toEqual({ op: 'add', path: 'E:\\a.zip' })
    }
  })

  it('有结论的两个阶段划掉', () => {
    for (const st of ['done', 'cancelled'] as const) {
      expect(queueActionFor(st, 'E:\\a.zip')).toEqual({ op: 'remove', path: 'E:\\a.zip' })
    }
  })

  it('正在跑的中间态不动队列', () => {
    for (const st of ['queued', 'hashing', 'detecting', 'extracting', 'fingerprinting', 'classifying', 'committing'] as const) {
      expect(queueActionFor(st, 'E:\\a.zip'), `${st} 不该动队列`).toEqual({ op: 'none', path: 'E:\\a.zip' })
    }
  })

  it('每一个阶段都有明确归类（加阶段时忘了更新这里会被抓住）', () => {
    for (const st of ALL_STAGES) {
      const op = queueActionFor(st, 'E:\\a.zip').op
      const known = STAGE_PENDING.has(st) || STAGE_TERMINAL.has(st) || op === 'none'
      expect(known, `阶段 ${st} 没有归类`).toBe(true)
    }
    /** 反过来：pending 与 terminal 不许重叠，否则同一次落盘会既加又删 */
    for (const st of STAGE_PENDING) expect(STAGE_TERMINAL.has(st)).toBe(false)
  })

  it('路径原样带回去（归一化交给 inboxQueue，这里不做第二遍）', () => {
    const weird = 'e:/vrc/A/子目录/包 v1.2.zip'
    expect(queueActionFor('awaiting_confirm', weird).path).toBe(weird)
  })
})
