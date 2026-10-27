import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDatabase, openDatabase, getDb } from '../../src/main/db'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import {
  appendImportName,
  clearImportNames,
  getProjectLayout,
  listImportNames,
  recordImportName,
  setProjectLayout
} from '../../src/main/db/repos/uiPrefs'
import { MAX_IMPORT_NAME_HISTORY } from '../../src/shared/importNames'
import { registerUiPrefs } from '../../src/main/ipc/uiPrefs'

vi.mock('electron', () => ({
  app: { commandLine: { hasSwitch: () => false }, getPath: () => process.env.TEMP },
  BrowserWindow: {},
  shell: {}
}))

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-uiprefs-')))
  setAppPathsForTest(root)
  openDatabase(P.db())
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('项目顺序存 setting，不动 schema', () => {
  it('默认空；存进去能原样读回', () => {
    expect(getProjectLayout(getDb())).toEqual({ order: [], pinned: [] })
    const saved = setProjectLayout(getDb(), { order: ['p2', 'p1'], pinned: ['p2'] })
    expect(saved).toEqual({ order: ['p2', 'p1'], pinned: ['p2'] })
    expect(getProjectLayout(getDb())).toEqual({ order: ['p2', 'p1'], pinned: ['p2'] })
  })

  it('手改库塞了垃圾也不崩（当成没设置过）', () => {
    getDb().prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run('ui.projectLayout', 'not json{{')
    expect(getProjectLayout(getDb())).toEqual({ order: [], pinned: [] })
  })

  it('不碰任何导入记录表', () => {
    setProjectLayout(getDb(), { order: ['x'], pinned: [] })
    const tables = getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).toContain('import_log')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
  })
})

describe('导入名字历史', () => {
  it('清空 IPC 在写入完成后通知其他窗口；不改撤销台账', () => {
    appendImportName(getDb(), { at: 1, assetName: '糖果', projectName: 'p', names: ['Candy'] })
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const events: string[] = []
    registerUiPrefs({
      ipc: { handle: (channel, fn) => { handlers.set(channel, fn as (...args: unknown[]) => unknown) } },
      broadcast: (event) => {
        expect(listImportNames(getDb())).toEqual([])
        events.push(event)
      }
    })
    const undoBefore = getDb().prepare('SELECT * FROM import_log').all()
    expect(handlers.get('ui:import-names-clear')?.()).toEqual([])
    expect(events).toEqual(['data:changed'])
    expect(getDb().prepare('SELECT * FROM import_log').all()).toEqual(undoBefore)
  })

  it('追加后按新→旧排列', () => {
    appendImportName(getDb(), { at: 1, assetName: '糖果', projectName: 'shinano-Main4', names: ['shinano Candy'] })
    appendImportName(getDb(), { at: 2, assetName: '史莱姆', projectName: 'shinano-Main4', names: ['Slime'] })
    expect(listImportNames(getDb()).map((row) => row.assetName)).toEqual(['史莱姆', '糖果'])
  })

  it(`最多留 ${MAX_IMPORT_NAME_HISTORY} 条`, () => {
    for (let i = 0; i < MAX_IMPORT_NAME_HISTORY + 8; i++) {
      appendImportName(getDb(), { at: i, assetName: `a${i}`, projectName: 'p', names: [`n${i}`] })
    }
    const rows = listImportNames(getDb())
    expect(rows).toHaveLength(MAX_IMPORT_NAME_HISTORY)
    expect(rows[0].assetName).toBe(`a${MAX_IMPORT_NAME_HISTORY + 7}`)
  })

  it('清空只清这张表：项目顺序与 projectGuids: 之类的键都还在', () => {
    setProjectLayout(getDb(), { order: ['p1'], pinned: ['p1'] })
    getDb().prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run('projectGuids:p1', '[1]')
    appendImportName(getDb(), { at: 1, assetName: '糖果', projectName: 'p', names: ['shinano Candy'] })

    clearImportNames(getDb())

    expect(listImportNames(getDb())).toEqual([])
    expect(getProjectLayout(getDb())).toEqual({ order: ['p1'], pinned: ['p1'] })
    const kept = getDb().prepare(`SELECT value_json FROM setting WHERE key = ?`).get('projectGuids:p1') as {
      value_json: string
    }
    expect(kept.value_json).toBe('[1]')
  })
})

describe('recordImportName：导入成功时记一笔', () => {
  function seedAsset(id: string, name: string): void {
    getDb()
      .prepare(
        `INSERT INTO asset (id, name, raw_name, category, subcategory, confidence, status, library_path, source_path, storage_mode, kind, content_type, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, '模型', NULL, 1, 'ok', ?, ?, 'copy', 'file', 'archive', 1, 1, 1)`
      )
      .run(id, name, name, path.join(root, name), path.join(root, name))
  }

  function seedProject(id: string, name: string): void {
    getDb().prepare(`INSERT INTO project (id, path, name) VALUES (?, ?, ?)`).run(id, path.join(root, id), name)
  }

  it('名字来自包内真实落点的一级目录，素材名与工程名从库里取', () => {
    seedAsset('a1', '糖果')
    seedProject('p1', 'shinano-Main4')
    recordImportName(getDb(), {
      assetId: 'a1',
      projectId: 'p1',
      unityPaths: ['Assets/shinano Candy/Prefab/Candy.prefab'],
      packagePath: path.join(root, 'candy.unitypackage')
    })
    const rows = listImportNames(getDb())
    expect(rows).toHaveLength(1)
    expect(rows[0].assetName).toBe('糖果')
    expect(rows[0].projectName).toBe('shinano-Main4')
    expect(rows[0].names).toEqual(['shinano Candy'])
  })

  it('取不到名字就不记（纯代码包不刷空白行）', () => {
    seedAsset('a1', 'MeshSplitter')
    seedProject('p1', 'p')
    recordImportName(getDb(), { assetId: 'a1', projectId: 'p1', unityPaths: [], packagePath: 'x.unitypackage' })
    expect(listImportNames(getDb())).toEqual([])
  })

  it('素材行没了就退回包名，不让记录整条丢掉', () => {
    seedProject('p1', 'p')
    recordImportName(getDb(), {
      assetId: 'missing',
      projectId: 'p1',
      unityPaths: ['Assets/Foo/bar.prefab'],
      packagePath: path.join(root, 'some-pack.unitypackage')
    })
    expect(listImportNames(getDb())[0].assetName).toBe('some-pack')
  })
})
