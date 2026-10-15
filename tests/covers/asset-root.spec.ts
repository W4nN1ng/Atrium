import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { assetRootDirectory } from '../../src/main/covers/assetRoot'

/**
 * `assetRootDirectory` —— 素材在磁盘上的根目录。
 *
 * 这个函数是 2026-10-15 那个 bug 的修复核心：
 * 封面编辑器点「选择本地图片」时，对话框要停在**当前素材**的目录，
 * 而 Windows 在没给 `defaultPath` 时会沿用上一次用过的目录
 * （用户实测：给 `RealKissSystem` 设封面，对话框开在上一个素材 `…史莱姆化` 里）。
 *
 * ⚠ 素材路径**两种形态都有**，而且会出现在同一个合集里 —— 所以不能直接把
 * `source_path` 丢给对话框：
 *   - `5354575真实亲吻Realkisssystem`        → `source_path` 是**目录**
 *   - `RealKissSystemV1.4.0-beta.2.zip`     → `source_path` 是**文件**
 * 这两条正是真库里的实际数据，下面用等价夹具覆盖。
 */

let root: string
let db: Db

/** 造一条素材记录。`libraryPath` / `sourcePath` 传 null 表示该列为空 */
function insertAsset(id: string, libraryPath: string | null, sourcePath: string | null, name = 'Demo'): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, library_path, source_path, created_at, updated_at)
     VALUES (?, ?, ?, 'plugin', 0.9, 'classified', 'indexed', ?, ?, ?, ?)`
  ).run(id, name, name, libraryPath, sourcePath, now, now)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-assetroot-'))
  db = openDatabase(path.join(root, 'library.db'))
})

afterEach(() => {
  closeDatabase()
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      return
    } catch {
      /* Windows 偶尔还占着句柄，留给系统 */
    }
  }
})

describe('assetRootDirectory', () => {
  it('source_path 是**目录**时直接返回它（真实例子：5354575真实亲吻Realkisssystem）', () => {
    const dir = path.join(root, '插件17件', '5354575真实亲吻Realkisssystem')
    fs.mkdirSync(dir, { recursive: true })
    insertAsset('a1', null, dir, 'RealKissSystem')
    expect(assetRootDirectory(db, 'a1')).toBe(path.resolve(dir))
  })

  it('source_path 是**文件**时返回它的**父目录**（真实例子：同目录下的 RealKissSystemV1.4.0-beta.2.zip）', () => {
    const dir = path.join(root, '插件17件', '5354575真实亲吻Realkisssystem')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'RealKissSystemV1.4.0-beta.2.zip')
    fs.writeFileSync(file, 'x')
    insertAsset('a2', null, file, 'RealKissSystem-beta.2')
    /** 关键：给的是**目录**而不是那个 zip 文件 —— 对话框要停在素材所在的文件夹 */
    expect(assetRootDirectory(db, 'a2')).toBe(path.resolve(dir))
  })

  it('`library_path` 优先于 `source_path`（与 covers 找包的顺序一致）', () => {
    const lib = path.join(root, 'lib', '归档后')
    const src = path.join(root, 'src', '原始')
    fs.mkdirSync(lib, { recursive: true })
    fs.mkdirSync(src, { recursive: true })
    insertAsset('a3', lib, src)
    expect(assetRootDirectory(db, 'a3')).toBe(path.resolve(lib))
  })

  it('`library_path` 不在盘上时退回 `source_path`（别把不存在的目录给对话框）', () => {
    const src = path.join(root, 'src', '还在')
    fs.mkdirSync(src, { recursive: true })
    insertAsset('a4', path.join(root, 'lib', '已经被移走'), src)
    expect(assetRootDirectory(db, 'a4')).toBe(path.resolve(src))
  })

  it('两条路径都不在盘上 → null（界面据此不传 defaultPath，退回系统行为）', () => {
    insertAsset('a5', path.join(root, 'ghost-lib'), path.join(root, 'ghost-src'))
    expect(assetRootDirectory(db, 'a5')).toBeNull()
  })

  it('两列都为空 → null', () => {
    insertAsset('a6', null, null)
    expect(assetRootDirectory(db, 'a6')).toBeNull()
  })

  it('素材不存在 → null（不抛，调用方不必先判存在）', () => {
    expect(assetRootDirectory(db, 'no-such-asset')).toBeNull()
  })

  it('返回的是**绝对路径**（相对路径也要能定位）', () => {
    const dir = path.join(root, '相对', '目录')
    fs.mkdirSync(dir, { recursive: true })
    insertAsset('a7', null, dir)
    const got = assetRootDirectory(db, 'a7')
    expect(got).not.toBeNull()
    expect(path.isAbsolute(got as string)).toBe(true)
    /** 拿它当 defaultPath 时说的就是这个目录 */
    expect(fs.statSync(got as string).isDirectory()).toBe(true)
  })

  it('只读：不创建一个原本不存在的目录', () => {
    const missing = path.join(root, '不该被建出来')
    insertAsset('a8', null, missing)
    expect(assetRootDirectory(db, 'a8')).toBeNull()
    expect(fs.existsSync(missing)).toBe(false)
  })
})
