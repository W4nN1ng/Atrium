import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { appendJournal, markUndone, lastRevertible, getJournal } from '../../src/main/db/repos/journal'

/**
 * 撤销失败时 journal 该怎么记账。
 * 踩过：失败也写 undone=1 → 库里效果还在、账本却说撤过了 → 后面再也撤不动。
 */
let dir = ''
let db: Db

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-journal-'))
  db = openDatabase(path.join(dir, 't.db'))
})

afterAll(() => {
  closeDatabase()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('失败的撤销不许冒充成功', () => {
  it('markUndone 带 error 时保持 undone=0，只记状态和原因', () => {
    const id = appendJournal(db, { op: 'register', assetIds: ['A1'], label: '登记 A1' }, {})
    markUndone(db, id, null, 'FOREIGN KEY constraint failed')
    const row = getJournal(db, id)!
    expect(row.undone, '没撤成就不许标已撤销').toBe(0)
    expect(row.status).toBe('failed')
    expect(row.error).toContain('FOREIGN KEY')
  })

  it('成功的撤销照常标 undone=1 并清掉上一次的失败原因', () => {
    const id = appendJournal(db, { op: 'register', assetIds: ['A2'], label: '登记 A2' }, {})
    markUndone(db, id, null, '先失败一次')
    const marker = appendJournal(db, { op: 'register', label: '撤销：登记 A2' }, { undoOf: id, isUndo: true })
    markUndone(db, id, marker)
    const row = getJournal(db, id)!
    expect(row.undone).toBe(1)
    expect(row.status).toBe('done')
    expect(row.error).toBeNull()
  })

  it('failed 的行不会被 lastRevertible 当成可撤销', () => {
    const ok = appendJournal(db, { op: 'move', from: 'X/a', to: 'Y/a', label: '搬动' }, {})
    const bad = appendJournal(db, { op: 'move', from: 'X/b', to: 'Y/b', label: '搬动' }, {})
    markUndone(db, bad, null, '炸了')
    // 失败行状态是 failed，lastRevertible 只认 done → 跳过它，但**它的 undone 仍是 0**，
    // 所以账本上没撒谎：这条没撤过，将来修好前提仍能被重新处理
    expect(lastRevertible(db)?.id).toBe(ok)
    expect(getJournal(db, bad)!.undone).toBe(0)
  })
})
