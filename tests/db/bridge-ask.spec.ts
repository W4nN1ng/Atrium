import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { getBridgeAsk, listBridgeAsk, setBridgeAsk } from '../../src/main/db/repos/bridgeAsk'
import { upsertProject } from '../../src/main/db/repos/unity'

/**
 * R4 ⑦ · 用户对"要不要给这个工程装桥接"的答案怎么存。
 *
 * 裁定 Q7：存 `setting` 表键 `bridgeAsk:<projectId>`，**不为这一件事动 schema**。
 * 所以这一层的风险不在逻辑（`shared/bridgeAsk.ts` 已经钉过），全在**存取的边角**：
 * 脏值不能抛、清答案要真删行、不能把别人的 setting 键带下水。
 */

let root = ''
let db: Db

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-bridge-ask-db-'))
  db = openDatabase(path.join(root, 'library.db'))
})

afterEach(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* Windows 上句柄没放干净就留给系统，不影响正确性 */
  }
})

/** 真实形状：`upsertProject` 自己生成 ULID，测试必须把 id 读回来（写路径当 id 用会 JOIN 不上） */
function newProject(name = 'shinano-Main2'): string {
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1', 'utf8')
  const row = upsertProject(db, { path: dir, name, unityVersion: '2022.3.22f1' })
  return row.id
}

describe('bridgeAsk 的存取', () => {
  it('没答过 → null（不是 never：没问过和问过并拒了是两件事）', () => {
    expect(getBridgeAsk(db, newProject())).toBeNull()
  })

  it('always / never 各存各的，读回来一模一样', () => {
    const a = newProject('A')
    const b = newProject('B')
    setBridgeAsk(db, a, 'always')
    setBridgeAsk(db, b, 'never')
    expect(getBridgeAsk(db, a)).toBe('always')
    expect(getBridgeAsk(db, b)).toBe('never')
  })

  it('改答案走覆盖，不留下第二条行（setting 的键就是工程维度的唯一约束）', () => {
    const id = newProject()
    setBridgeAsk(db, id, 'always')
    setBridgeAsk(db, id, 'never')
    expect(getBridgeAsk(db, id)).toBe('never')
    const n = db.prepare(`SELECT COUNT(*) AS n FROM setting WHERE key = ?`).get(`bridgeAsk:${id}`) as { n: number }
    expect(n.n).toBe(1)
  })

  it('⭐ 传 null = 把答案删掉，回到"没问过"（下次第一次发现还会问）', () => {
    const id = newProject()
    setBridgeAsk(db, id, 'never')
    setBridgeAsk(db, id, null)
    expect(getBridgeAsk(db, id)).toBeNull()
    const row = db.prepare(`SELECT value_json FROM setting WHERE key = ?`).get(`bridgeAsk:${id}`)
    expect(row, '只是把值写成 null 不算删：读回来仍该是"没答过"，行也要真的没了').toBeUndefined()
  })

  it('⭐ 脏值不抛：手改过库 / 上一版写的别的形状，都当成"没答过"', () => {
    const id = newProject()
    for (const dirty of ['not json at all', '"maybe"', 'null', '{}', '123', '"  "']) {
      db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(`bridgeAsk:${id}`, dirty)
      expect(getBridgeAsk(db, id), `脏值 ${dirty} 必须收成 null 而不是抛`).toBeNull()
    }
  })

  it('listBridgeAsk 只列答过的、只列 bridgeAsk: 前缀的，并把 id 还原出来', () => {
    const a = newProject('A')
    const b = newProject('B')
    const c = newProject('C')
    setBridgeAsk(db, a, 'always')
    setBridgeAsk(db, c, 'never')
    /** 别的 setting 键（同前缀开头也不行，必须是完整段 `bridgeAsk:`） */
    db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run('bridgeAskExtra', '"always"')
    db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run('projectGuids:' + b, '"{}"')
    /** 脏的那条不进清单：列出来也没法显示成答案 */
    db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(`bridgeAsk:${b}`, 'garbage')

    const list = listBridgeAsk(db).sort((x, y) => (x.projectId < y.projectId ? -1 : 1))
    /** ⚠ 不按插入序断言：`setting` 没有 ORDER BY，返回顺序是 SQLite 的实现细节 */
    expect(list).toEqual([
      { projectId: a, answer: 'always' },
      { projectId: c, answer: 'never' }
    ].sort((x, y) => (x.projectId < y.projectId ? -1 : 1)))
  })

  it('删掉工程行不会自动清 setting（这里不承诺级联，但也不能因为缺行而读挂）', () => {
    const id = newProject('要删的')
    setBridgeAsk(db, id, 'always')
    db.prepare(`DELETE FROM project WHERE id = ?`).run(id)
    expect(getBridgeAsk(db, id), '答案还在就照实读回来，不许抛').toBe('always')
  })
})
