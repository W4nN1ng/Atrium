import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectProjectFiles, COLLECT_MAX_PATH } from '../../../src/main/vpm/backup/collector'
import { safeZipPath } from '../../../src/main/vpm/backup/zip'
import { UnityLaunchService } from '../../../src/main/vpm/unity/launch'
import type { UnityInstall } from '../../../src/main/vpm/unity'

/**
 * P9-C：兼容边界。
 *
 * 两类"看起来能跑、真机上会翻车"的东西：
 *
 * 1. **路径**：中文 / 空格 / `#` `&` 这类要转义的字符 / 超过 260 的长路径。
 *    Node 自己能处理长路径（libuv 会加 `\\?\`），但备份/解压策略上有一条 260 的线 ——
 *    这条线**必须报警而不是静默丢文件**，这里把它钉住。
 * 2. **Unity 版本**：2019/2021/2022/6000 各自的 base 匹配，不能跨大版本抓错编辑器。
 *
 * 真机（真 Unity 打开工程）不在这里，归 P9-D。
 */

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-compat-')))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function makeProject(dir: string, unityVersion = '2022.3.22f1'): string {
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Packages', 'manifest.json'), '{}')
  fs.writeFileSync(
    path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'),
    `m_EditorVersion: ${unityVersion}\n`
  )
  return dir
}

describe('P9-C 路径兼容', () => {
  it('中文 / 空格 / #& 的工程路径能正常收集，相对路径按 posix 返回', async () => {
    const project = makeProject(path.join(root, '我的 素材 #1 & 工程'))
    fs.mkdirSync(path.join(project, 'Assets', '角色 模型'), { recursive: true })
    fs.writeFileSync(path.join(project, 'Assets', '角色 模型', '模型 01.fbx'), 'x')

    const result = await collectProjectFiles({ root: project, mode: 'backup' })

    expect(result.truncated).toBe(false)
    expect(result.warnings).toEqual([])
    const paths = result.files.map((file) => file.relativePath)
    expect(paths).toContain('Assets/角色 模型/模型 01.fbx')
    // 相对路径一律 posix 分隔，跨平台比较/写进 manifest 才稳定
    expect(paths.every((item) => !item.includes('\\'))).toBe(true)
  })

  it('超过 260 的文件会带 longPath 警告被跳过，而不是静默消失', async () => {
    const project = makeProject(path.join(root, 'deep'))
    // 造一条刚好越过策略线的路径：每次加 25 个字符，直到文件绝对路径越线
    let dir = path.join(project, 'Assets')
    fs.mkdirSync(dir, { recursive: true })
    while (path.join(dir, 'f.txt').length < COLLECT_MAX_PATH) {
      dir = path.join(dir, 'd'.repeat(24))
      fs.mkdirSync(dir, { recursive: true })
    }
    const longFile = path.join(dir, 'f.txt')
    fs.writeFileSync(longFile, 'x')
    expect(longFile.length).toBeGreaterThanOrEqual(COLLECT_MAX_PATH)

    const result = await collectProjectFiles({ root: project, mode: 'backup' })

    // 文件不在清单里，但**必须**有警告说明为什么
    expect(result.files.map((file) => file.relativePath)).not.toContain(
      longFile.slice(project.length + 1).split(path.sep).join('/')
    )
    expect(result.warnings.map((warning) => warning.reason)).toContain('longPath')
  })

  it('解压路径策略：260 以内接受，越线/绝对路径/反斜杠一律拒绝', () => {
    expect(safeZipPath('Assets/Foo/bar.prefab')).toBe('Assets/Foo/bar.prefab')
    expect(safeZipPath('a/'.repeat(129) + 'b.txt')).toBeNull()
    expect(safeZipPath('/etc/passwd')).toBeNull()
    expect(safeZipPath('C:/Windows/system32')).toBeNull()
    expect(safeZipPath('Assets\\Foo')).toBeNull()
    expect(safeZipPath('Assets/../../evil')).toBeNull()
  })
})

describe('P9-C Unity 版本矩阵（解析侧）', () => {
  function install(version: string): UnityInstall {
    const exe = path.join(root, 'editors', version, 'Editor', 'Unity.exe')
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    fs.writeFileSync(exe, 'stub')
    return {
      id: `hub:${version}`,
      path: exe,
      version,
      versionWithRevision: version,
      versionUnknown: false,
      arch: 'x86_64',
      archInferred: true,
      source: 'hub',
      lastSeenAt: 1,
      missing: false
    } as UnityInstall
  }

  const service = (installs: UnityInstall[]): UnityLaunchService =>
    new UnityLaunchService({ installs: () => installs })

  /**
   * 真实语义是**精确版本**匹配（`unityVersionBase` 只去掉中国版 `cN` 后缀，
   * 不会把 2022.3.22f1 折成 2022.3）—— 这点和 `docs/VPM-P5D-HANDOVER.md` 里
   * "按 base 版本 2022.3 匹配"的说法不一致，**以代码为准**：
   * 不拿别的补丁版凑合，否则一开工程就悄悄改写了 ProjectVersion.txt。
   */
  it.each(['2019.4.31f1', '2021.3.16f1', '2022.3.22f1', '6000.0.23f1'])(
    '%s 的工程挑到同版本编辑器，不跨大版本也不跨补丁版',
    (projectVersion) => {
      const project = makeProject(path.join(root, `p-${projectVersion}`), projectVersion)
      const installs = ['2019.4.31f1', '2021.3.16f1', '2022.3.22f1', '6000.0.23f1'].map(install)

      const resolved = service(installs).resolveEditor(project)
      expect(resolved.install.version).toBe(projectVersion)
      expect(resolved.source).toBe('version')
    }
  )

  it('只有别的补丁版时报 vpmUnityNotFound，不凑合用一个去改工程版本', () => {
    const project = makeProject(path.join(root, 'p-patch'), '2022.3.22f1')
    expect(() => service([install('2022.3.10f1')]).resolveEditor(project)).toThrowError(
      /vpmUnityNotFound/
    )
  })

  it('中国版 cN 后缀按 base 归一：2022.3.22f1c1 的工程能用 2022.3.22f1 的编辑器', () => {
    const project = makeProject(path.join(root, 'p-china'), '2022.3.22f1c1')
    const resolved = service([install('2022.3.22f1')]).resolveEditor(project)
    expect(resolved.install.version).toBe('2022.3.22f1')
  })

  it('显式指定的编辑器优先于版本匹配（source=explicit）', () => {
    const project = makeProject(path.join(root, 'p-explicit'), '2022.3.22f1')
    const exact = install('2022.3.22f1')
    const other = install('6000.0.23f1')
    // 明确指定 6000 的编辑器：就用它，哪怕工程写的是 2022.3.22f1
    const resolved = service([exact, other]).resolveEditor(project, other.path)
    expect(resolved.source).toBe('explicit')
    expect(resolved.install.version).toBe('6000.0.23f1')

    // 指定了一个不在发现列表里的 exe：仍然用它，但版本未知（不编造版本号）
    const stray = install('2021.3.16f1')
    const synthetic = service([exact]).resolveEditor(project, stray.path)
    expect(synthetic.source).toBe('explicit')
    expect(synthetic.install.path).toBe(stray.path)
    expect(synthetic.install.version).toBeNull()
  })

  it('没有 ProjectVersion.txt 时报错，不猜版本', () => {
    const project = path.join(root, 'p-noversion')
    fs.mkdirSync(project, { recursive: true })
    expect(() => service([install('2022.3.22f1')]).resolveEditor(project)).toThrowError(
      /vpmUnityNotFound/
    )
  })
})
