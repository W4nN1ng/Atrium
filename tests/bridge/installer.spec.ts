import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import {
  BRIDGE_PACKAGE_NAME,
  checkBridgeTemplate,
  installBridge,
  installedProjects,
  uninstallBridge,
  uninstallBridgeFromAll
} from '../../src/main/bridge/installer'
import { isBridgeInstalled } from '../../src/main/bridge/mailbox'
import { journalPayload } from '../../src/main/db/repos/journal'

/**
 * 桥接的安装 / 卸载。
 *
 * 两条不能违反的约束在这里钉死：
 *  - 装到 **`Packages/`** 而不是 `Assets/`（§1.2：否则会跟着 Avatar 传上 VRChat）
 *  - 卸载**走回收站**，不永久删除（01§F4 / 00§五-5）
 */

let root: string
let template: string
let project: string
let db: Db

/** 造一份完整的桥接模板 */
function makeTemplate(dir: string, opts: { complete?: boolean; version?: string } = {}): void {
  const complete = opts.complete ?? true
  fs.mkdirSync(path.join(dir, 'Editor'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: BRIDGE_PACKAGE_NAME, version: opts.version ?? '1.0.0', unity: '2022.3' }, null, 2),
    'utf8'
  )
  if (complete) {
    fs.writeFileSync(path.join(dir, 'Editor', 'AVCABridge.cs'), '// bridge', 'utf8')
    fs.writeFileSync(path.join(dir, 'Editor', 'AVCA.Bridge.asmdef'), '{}', 'utf8')
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-bridgeinst-'))
  template = path.join(root, 'tpl')
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(project, { recursive: true })
  db = openDatabase(path.join(root, 'library.db'))
  upsertProject(db, { path: project, name: 'shinano-Main2' })
})

afterEach(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('模板自检', () => {
  it('齐全 → ok', () => {
    makeTemplate(template)
    const r = checkBridgeTemplate(template)
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('缺文件 → 列出缺哪些（不能假装能装）', () => {
    makeTemplate(template, { complete: false })
    const r = checkBridgeTemplate(template)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('Editor/AVCABridge.cs')
    expect(r.missing).toContain('Editor/AVCA.Bridge.asmdef')
    expect(r.missing).not.toContain('package.json')
  })

  it('模板目录整个不存在 → 全部算缺', () => {
    const r = checkBridgeTemplate(path.join(root, 'ghost'))
    expect(r.ok).toBe(false)
    expect(r.missing).toHaveLength(3)
  })
})

describe('安装（§1.2：必须进 Packages/，不能进 Assets/）', () => {
  it('装到 Packages/com.avca.bridge，且**不在** Assets/ 下建任何东西', () => {
    makeTemplate(template)
    const r = installBridge(db, project, template)
    expect(r.ok).toBe(true)
    expect(r.copied).toBeGreaterThan(0)

    const target = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME)
    expect(r.target).toBe(target)
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'Editor', 'AVCABridge.cs'))).toBe(true)
    expect(isBridgeInstalled(project)).toBe(true)

    /** 关键：绝不能污染资源树 */
    const assetsDir = path.join(project, 'Assets')
    if (fs.existsSync(assetsDir)) {
      expect(fs.readdirSync(assetsDir)).not.toContain(BRIDGE_PACKAGE_NAME)
    }
    expect(fs.existsSync(path.join(project, 'Assets', BRIDGE_PACKAGE_NAME))).toBe(false)
  })

  it('写 journal（op = bridge_install），带上目标路径（R-11）', () => {
    makeTemplate(template)
    const r = installBridge(db, project, template)
    const row = db.prepare(`SELECT * FROM journal ORDER BY id DESC LIMIT 1`).get() as
      | { op: string; payload_json: string }
      | undefined
    expect(row?.op).toBe('bridge_install')
    expect(journalPayload(row as never).to).toBe(r.target)
  })

  it('已经装过 → 不重复复制（别把用户改过的桥接覆盖回去）', () => {
    makeTemplate(template)
    installBridge(db, project, template)
    /** 用户手改一下 */
    const cs = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME, 'Editor', 'AVCABridge.cs')
    fs.writeFileSync(cs, '// 用户改过的', 'utf8')

    const again = installBridge(db, project, template)
    expect(again.ok).toBe(true)
    expect(again.alreadyInstalled).toBe(true)
    expect(again.copied).toBe(0)
    expect(fs.readFileSync(cs, 'utf8')).toBe('// 用户改过的')
  })

  it('force 时覆盖重装', () => {
    makeTemplate(template)
    installBridge(db, project, template)
    const cs = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME, 'Editor', 'AVCABridge.cs')
    fs.writeFileSync(cs, '// 用户改过的', 'utf8')
    const r = installBridge(db, project, template, { force: true })
    expect(r.ok).toBe(true)
    expect(r.alreadyInstalled).toBe(false)
    expect(fs.readFileSync(cs, 'utf8')).toBe('// bridge')
  })

  it('模板缺失 → 明确失败并列出缺的文件，不在工程里留下一半', () => {
    makeTemplate(template, { complete: false })
    const r = installBridge(db, project, template)
    expect(r.ok).toBe(false)
    expect(r.missingTemplateFiles.length).toBeGreaterThan(0)
    expect(r.error).toContain('模板不完整')
    /** 失败时不该把目标目录建出来 */
    expect(isBridgeInstalled(project)).toBe(false)
    /** 也不该写 journal */
    const n = db.prepare(`SELECT COUNT(*) AS n FROM journal`).get() as { n: number }
    expect(Number(n.n)).toBe(0)
  })

  it('Packages/ 不存在时自动建', () => {
    makeTemplate(template)
    expect(fs.existsSync(path.join(project, 'Packages'))).toBe(false)
    const r = installBridge(db, project, template)
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(project, 'Packages'))).toBe(true)
  })

  it('installedProjects 只列出装着的工程', () => {
    makeTemplate(template)
    const other = path.join(root, 'Milfy-Main')
    fs.mkdirSync(other, { recursive: true })
    installBridge(db, project, template)
    expect(installedProjects([project, other])).toEqual([project])
  })
})

describe('卸载（R-13：走回收站，不永久删除）', () => {
  it('trashFn 被调用，且目标从磁盘上消失', async () => {
    makeTemplate(template)
    installBridge(db, project, template)
    const target = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME)

    const trashed: string[] = []
    const r = await uninstallBridge(db, project, async (p) => {
      trashed.push(p)
      fs.rmSync(p, { recursive: true, force: true })
    })
    expect(r.ok).toBe(true)
    expect(trashed).toEqual([target])
    expect(fs.existsSync(target)).toBe(false)
    expect(isBridgeInstalled(project)).toBe(false)
  })

  it('写 journal（op = bridge_uninstall）', async () => {
    makeTemplate(template)
    installBridge(db, project, template)
    await uninstallBridge(db, project, async (p) => fs.promises.rm(p, { recursive: true, force: true }))
    const row = db.prepare(`SELECT op, payload_json FROM journal ORDER BY id DESC LIMIT 1`).get() as {
      op: string
      payload_json: string
    }
    expect(row.op).toBe('bridge_uninstall')
    expect(journalPayload(row as never).from).toContain(BRIDGE_PACKAGE_NAME)
  })

  it('本来就没装 → ok 且 notInstalled=true，不报错', async () => {
    const trashed: string[] = []
    const r = await uninstallBridge(db, project, async (p) => {
      trashed.push(p)
    })
    expect(r.ok).toBe(true)
    expect(r.notInstalled).toBe(true)
    expect(trashed).toEqual([])
  })

  it('回收站拒绝（Unity 占用）→ 报错并给出人能看懂的提示，且目录还在', async () => {
    makeTemplate(template)
    installBridge(db, project, template)
    const target = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME)
    const r = await uninstallBridge(db, project, async () => {
      const e = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException
      e.code = 'EBUSY'
      throw e
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('EBUSY')
    expect(r.error).toContain('Unity')
    /** 失败时目录必须还完整地在那儿 */
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true)
  })

  it('**绝不自己 rm**：卸载只经由注入的 trashFn', async () => {
    makeTemplate(template)
    installBridge(db, project, template)
    const target = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME)
    let called = 0
    await uninstallBridge(db, project, async () => {
      called++
      /** 故意什么都不做 —— 模拟"送回收站成功但磁盘上还在"这种不可能的情形 */
    })
    expect(called).toBe(1)
    /** 因为 trashFn 没真删，目录当然还在；这证明代码没有绕过 trashFn 自己删 */
    expect(fs.existsSync(target)).toBe(true)
  })
})

describe('从所有工程卸载（R-15）', () => {
  it('清掉所有装着的，一个失败不影响其余的', async () => {
    makeTemplate(template)
    const a = project
    const b = path.join(root, 'Milfy-Main')
    const c = path.join(root, 'shinano-Loli')
    const clean = path.join(root, 'clean-project')
    for (const p of [b, c, clean]) {
      fs.mkdirSync(p, { recursive: true })
      upsertProject(db, { path: p, name: path.basename(p) })
    }
    for (const p of [a, b, c]) installBridge(db, p, template)

    const trashed: string[] = []
    const r = await uninstallBridgeFromAll(db, [a, b, c, clean], async (p) => {
      /** b 上模拟"Unity 占着" */
      if (p.includes('Milfy')) throw new Error('EBUSY: locked')
      trashed.push(path.basename(path.dirname(p)))
      fs.rmSync(p, { recursive: true, force: true })
    })

    expect(r.uninstalled.sort()).toEqual([a, c].sort())
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].projectPath).toBe(b)
    /** 没装的那个算 skipped，不算失败 */
    expect(r.skipped).toBe(1)
    expect(r.ok).toBe(false)
    expect(installedProjects([a, b, c])).toEqual([b])
  })

  it('全都没装 → ok 且全部 skipped', async () => {
    const r = await uninstallBridgeFromAll(db, [project], async () => undefined)
    expect(r.ok).toBe(true)
    expect(r.uninstalled).toEqual([])
    expect(r.skipped).toBe(1)
  })
})
