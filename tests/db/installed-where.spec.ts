import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { ensureGroup } from '../../src/main/db/repos/product'
import { insertImportLog, patchImportLog } from '../../src/main/db/repos/journal'
import { installedProjects, upsertProject } from '../../src/main/db/repos/unity'

/**
 * R4 ⑥ · 跨工程反查的取数口径。
 *
 * 这块最容易骗人的地方是"看起来有答案"：日志表里躺着几条记录，
 * 界面就能列出一串工程名，可它回答的其实只是"A 导过哪几次"。
 * 所以这些用例钉的全是**边界**：手动导入的查不到、退回过的不能算装过但要看得见、
 * 组里兄弟行导过 = 这张卡装过、工程被删了不能显示成空名字、时间缺失不能显示成 1970。
 */

let root = ''
let db: Db

const P1 = 'E:\\projects\\Alpha'
const P2 = 'E:\\projects\\Beta'
/**
 * ⚠ `import_log.project_id` 存的是 `project.id`（ULID），**不是路径**。
 * 测试里图省事直接写路径的话，JOIN 不上、名字全空 —— 看着像实现坏了，其实是夹具错。
 * （真库里这条之所以没出错：桥接那边一直是先查工程再拿 id。）
 */

function projectIdOf(pathOrId: string): string {
  const hit = db.prepare(`SELECT id FROM project WHERE path = ? OR id = ?`).get(pathOrId, pathOrId) as { id?: string } | undefined
  if (hit?.id) return hit.id
  throw new Error(`夹具里的工程不存在：${pathOrId}`)
}

function okImport(projectPath: string, assetId: string, opts: { created?: string[]; overwritten?: string[]; at?: number | null; status?: 'ok' | 'rolledback' | 'failed' } = {}): void {
  const row = insertImportLog(db, { projectId: projectIdOf(projectPath), assetId, unitypackagePath: 'x.unitypackage' })
  patchImportLog(db, row.id, {
    status: opts.status ?? 'ok',
    created_guids_json: opts.created ? JSON.stringify(opts.created) : null,
    overwritten_json: opts.overwritten ? JSON.stringify(opts.overwritten) : null,
    finished_at: opts.at === undefined ? Date.now() : opts.at
  })
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-installed-'))
  db = openDatabase(path.join(root, 'library.db'))
  upsertProject(db, { path: P1, name: 'Alpha' })
  upsertProject(db, { path: P2, name: 'Beta' })
})

afterAll(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('installedProjects', () => {
  it('从没导过的素材 → 空数组（界面上要据此说出"A 的日志里没有记录"，而不是显示一片空白）', () => {
    const a = makeAssetRow({ name: 'Never', raw_name: 'never.zip', category: 'texture', status: 'classified' })
    upsertAsset(db, a)
    expect(installedProjects(db, a.id)).toEqual([])
  })

  it('按工程聚合：两个工程各一条，取最后一次时间倒序，包数与 GUID 数累加', () => {
    const g = ensureGroup(db, { groupKey: 'grimoir-x', name: 'Grimoir', category: 'clothing' })
    const a = makeAssetRow({ name: 'Grimoir', raw_name: 'g1.zip', category: 'clothing', group_id: g.id, status: 'classified' })
    upsertAsset(db, a)
    okImport(P1, a.id, { created: ['g1', 'g2'], at: 1000 })
    okImport(P1, a.id, { created: ['g3'], overwritten: ['o1'], at: 2000 })
    okImport(P2, a.id, { created: ['g9'], at: 1500 })

    const rows = installedProjects(db, a.id)
    /** Alpha 最后一次 2000 > Beta 的 1500 → Alpha 在前（数的是"最后一次"，不是"第一次"） */
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta'])
    const alpha = rows.find((r) => r.projectId === (db.prepare(`SELECT id FROM project WHERE path = ?`).get(P1) as { id: string }).id)
    expect(alpha?.packages).toBe(2)
    expect(alpha?.created).toBe(3)
    expect(alpha?.overwritten).toBe(1)
    expect(alpha?.at).toBe(2000)
    expect(alpha?.known).toBe(true)
  })

  it('退回过的不算"装过"，但次数要带回去（发生过的事不许抹掉）', () => {
    const a = makeAssetRow({ name: 'Rolled', raw_name: 'r.zip', category: 'texture', status: 'classified' })
    upsertAsset(db, a)
    okImport(P1, a.id, { created: ['x'], at: 3000 })
    okImport(P1, a.id, { status: 'rolledback', at: 4000 })
    const rows = installedProjects(db, a.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].packages).toBe(1)
    expect(rows[0].rolledBack).toBe(1)
  })

  it('同组兄弟行导过 = 这张卡装过（只查代表行的 asset_id 会漏报"没装过"）', () => {
    const g = ensureGroup(db, { groupKey: 'sibling', name: 'Sib', category: 'hair' })
    const rep = makeAssetRow({ name: 'Sib', raw_name: 'sib-a.zip', category: 'hair', group_id: g.id, status: 'classified' })
    const other = makeAssetRow({ name: 'Sib', raw_name: 'sib-b.zip', category: 'hair', group_id: g.id, status: 'classified' })
    upsertAsset(db, rep)
    upsertAsset(db, other)
    okImport(P2, other.id, { created: ['only-sibling'], at: 5000 })
    const rows = installedProjects(db, rep.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Beta')
    expect(rows[0].created).toBe(1)
  })

  it('别的组、别的素材的记录不许串进来', () => {
    const a = makeAssetRow({ name: 'Alone', raw_name: 'alone.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, a)
    const b = makeAssetRow({ name: 'Other', raw_name: 'other.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, b)
    okImport(P1, b.id, { at: 6000 })
    expect(installedProjects(db, a.id)).toEqual([])
  })

  it('工程记录被删了（VCC 里移掉）→ known=false，不许显示成空名字', () => {
    const a = makeAssetRow({ name: 'Ghost', raw_name: 'ghost.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, a)
    const row = insertImportLog(db, { projectId: 'P-GONE', assetId: a.id })
    patchImportLog(db, row.id, { status: 'ok', finished_at: 7000 })
    const rows = installedProjects(db, a.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].known).toBe(false)
    expect(rows[0].projectId).toBe('P-GONE')
  })

  it('finished_at 缺失 → at=0（界面据此显示"时间未知"，不许显示成 1970/1/1）', () => {
    const a = makeAssetRow({ name: 'NoTime', raw_name: 'nt.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, a)
    const row = insertImportLog(db, { projectId: projectIdOf(P1), assetId: a.id })
    patchImportLog(db, row.id, { status: 'ok' })
    const rows = installedProjects(db, a.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].at).toBe(0)
  })

  it('guids 列里是坏 JSON 时不炸、按 0 计（老版本写坏过一列，别让它把详情面板拖崩）', () => {
    const a = makeAssetRow({ name: 'BadJson', raw_name: 'bad.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, a)
    const row = insertImportLog(db, { projectId: projectIdOf(P1), assetId: a.id })
    patchImportLog(db, row.id, { status: 'ok', created_guids_json: '{not json', finished_at: 8000 })
    const rows = installedProjects(db, a.id)
    expect(rows[0].created).toBe(0)
    expect(rows[0].packages).toBe(1)
  })

  it('只有"导过又被 A 退回"的工程也要列出来（packages=0 + rolledBack>0），但只失败过的不列', () => {
    const a = makeAssetRow({ name: 'Undo', raw_name: 'undo.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, a)
    const b = makeAssetRow({ name: 'Failed', raw_name: 'failed.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, b)
    /* Alpha：导过一次又退回 */
    okImport(P1, a.id, { created: ['x'], at: 10000 })
    okImport(P1, a.id, { status: 'rolledback', at: 11000 })
    /* Beta：只有失败尝试 */
    okImport(P2, b.id, { status: 'failed', at: 12000 })
    const rows = installedProjects(db, a.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].packages).toBe(1)
    expect(rows[0].rolledBack).toBe(1)
    expect(installedProjects(db, b.id)).toEqual([])
    /** 纯退回（一次都没成功过）也要看得见：沙盒 `D:\avca-r4-live` 整批退回之后就是这个形状 */
    const c = makeAssetRow({ name: 'PureRollback', raw_name: 'pr.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, c)
    okImport(P1, c.id, { status: 'rolledback', at: 13000 })
    const pr = installedProjects(db, c.id)
    expect(pr).toHaveLength(1)
    expect(pr[0].packages).toBe(0)
    expect(pr[0].rolledBack).toBe(1)
    expect(pr[0].at, '退回过不算"最后一次装"的时间').toBe(0)
  })

  it('装桥接那类记录（kind=bridge_install）不许算成"这个素材装过"', () => {
    const a = makeAssetRow({ name: 'BridgeOnly', raw_name: 'b.zip', category: 'audio', status: 'classified' })
    upsertAsset(db, a)
    const row = insertImportLog(db, { projectId: P1, assetId: null, kind: 'bridge_install' })
    patchImportLog(db, row.id, { status: 'ok', finished_at: 9000 })
    expect(installedProjects(db, a.id)).toEqual([])
  })
})
