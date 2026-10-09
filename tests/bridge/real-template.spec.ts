import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { BRIDGE_PACKAGE_NAME, checkBridgeTemplate, installBridge, uninstallBridge } from '../../src/main/bridge/installer'
import { isBridgeInstalled } from '../../src/main/bridge/mailbox'

/**
 * 用**真模板**（`resources/unity-bridge/com.avca.bridge`）跑一遍安装/卸载。
 *
 * 为什么值得单测一遍真模板：`installer.spec.ts` 用的是现场造的假模板，
 * 它证明不了**仓库里那份模板本身是完整的**。如果 `AVCABridge.cs` 或 asmdef
 * 漏了/改名了，假模板测试照样全绿，而用户点了"安装"却得到一个编译不过的包。
 *
 * 装到临时目录，**不碰用户的真工程**。
 */

const TEMPLATE = path.resolve(__dirname, '../../resources/unity-bridge/com.avca.bridge')

describe('真模板自检', () => {
  it('仓库里的桥接模板齐全（缺文件会让用户装出一个坏包）', () => {
    const r = checkBridgeTemplate(TEMPLATE)
    expect(r.missing, `模板缺：${r.missing.join('、')}`).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('模板里的 package.json 名字必须是 com.avca.bridge（改了桥接与索引就对不上）', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'package.json'), 'utf8')) as {
      name: string
      version: string
    }
    expect(pkg.name).toBe(BRIDGE_PACKAGE_NAME)
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('C# 源码里两条最危险的禁令都没被违反', () => {
    const raw = fs.readFileSync(path.join(TEMPLATE, 'Editor', 'AVCABridge.cs'), 'utf8')
    /**
     * ⚠ 判断"有没有调用某个 API"必须**剥掉注释**。
     * 第一版我直接 `expect(raw).not.toContain('DisplayProgressBar')` ——
     * 结果被自己的文档注释绊倒：第 32 行正是一条"不要用 DisplayProgressBar"的说明。
     * 这类断言必须只扫代码行。
     */
    const code = raw
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n')

    /** 绝不能连发 ImportPackage：必须是事件驱动 + 串行（§6.3 / R-73） */
    expect(code).toContain('importPackageCompleted')
    expect(code).toContain('importPackageFailed')
    expect(code).toContain('importPackageCancelled')
    /** 绝不能手写 .meta：散文件导入必须走 FileUtil + Refresh（§6.5 / R-78） */
    expect(code).toContain('FileUtil.CopyFileOrDirectory')
    /** 不能调用会改变用户状态的操作（§6.7 / R-83） */
    expect(code).not.toMatch(/EditorApplication\.Exit\s*\(/)
    expect(code).not.toMatch(/EditorSceneManager\.SaveScene\s*\(/)
    /** 不能阻塞式进度条（§6.7 / R-82） */
    expect(code).not.toContain('DisplayProgressBar')
    /** 忙判定必须四个条件齐全（§6.2）—— 少一个都会误判"Unity 空闲" */
    expect(code).toContain('isCompiling')
    expect(code).toContain('isUpdating')
    expect(code).toContain('isPlayingOrWillChangePlaymode')
    expect(code).toContain('isPlaying')
  })

  it('asmdef 限定为 Editor-only（不能把编辑器脚本编进玩家包）', () => {
    const asm = JSON.parse(
      fs.readFileSync(path.join(TEMPLATE, 'Editor', 'AVCA.Bridge.asmdef'), 'utf8')
    ) as { includePlatforms: string[] }
    expect(asm.includePlatforms).toContain('Editor')
  })
})

describe('真模板安装到临时工程', () => {
  it('装出来的包结构与模板一致，且不在 Assets/ 下', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-realtpl-'))
    const project = path.join(root, 'FakeUnityProject')
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
    fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
    const db = openDatabase(path.join(root, 'library.db'))
    try {
      upsertProject(db, { path: project, name: 'FakeUnityProject' })
      const r = installBridge(db, project, TEMPLATE)
      expect(r.ok).toBe(true)
      expect(r.missingTemplateFiles).toEqual([])

      const target = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME)
      /** 模板里的文件一个不少地复制过去 */
      const walk = (d: string, base = ''): string[] =>
        fs
          .readdirSync(d, { withFileTypes: true })
          .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base + e.name + '/') : [base + e.name]))
      expect(walk(target).sort()).toEqual(walk(TEMPLATE).sort())

      expect(isBridgeInstalled(project)).toBe(true)
      expect(fs.existsSync(path.join(project, 'Assets', BRIDGE_PACKAGE_NAME))).toBe(false)

      /** 卸载（走注入的回收站）后目录消失 */
      const trashed: string[] = []
      const un = await uninstallBridge(db, project, async (p) => {
        trashed.push(path.basename(p))
        fs.rmSync(p, { recursive: true, force: true })
      })
      expect(un.ok).toBe(true)
      expect(trashed).toEqual([BRIDGE_PACKAGE_NAME])
      expect(fs.existsSync(target)).toBe(false)
    } finally {
      closeDatabase()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
