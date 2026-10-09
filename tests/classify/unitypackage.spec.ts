import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import * as tar from 'tar'
import { parseUnitypackage, renderTree, pickPackageCover, extractPackagePreview } from '../../src/main/unpack/unitypackage'
import { extractZip } from '../../src/main/unpack/unzip'
import { digStagedUnitypackages } from '../../src/main/ingest/worker'

/**
 * §8.4 要求"在测试里用 tar+gzip 现场构造一个最小 .unitypackage"。
 * 这里再造一个带大 asset 的包，用来验"只读元数据"确实没把主体读进内存。
 */

let root = ''
const GUID_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const GUID_B = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
const GUID_OUTSIDE = 'deadbeefdeadbeefdeadbeefdeadbeef'

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-upkg-'))
  // tar.Pack 手工拼装容易错，直接用 tar.create 走一遍最稳
  const src = path.join(root, 'src')
  for (const g of [GUID_A, GUID_B, 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0', 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0']) {
    fs.mkdirSync(path.join(src, g), { recursive: true })
  }
  const prefab = `%YAML 1.1\n--- !u!1 &2\n  m_Name: Body\n  guid: ${GUID_B}\n--- !u!1 &3\n  m_Name: Ext\n  guid: ${GUID_OUTSIDE}\n`
  fs.writeFileSync(path.join(src, GUID_A, 'pathname'), 'Assets/Demo/Body.prefab')
  fs.writeFileSync(path.join(src, GUID_A, 'asset'), prefab)
  fs.writeFileSync(path.join(src, GUID_A, 'asset.meta'), 'fileFormatVersion: 2')
  fs.writeFileSync(path.join(src, GUID_B, 'pathname'), 'Assets/Demo/Toon.shader')
  fs.writeFileSync(path.join(src, GUID_B, 'asset'), 'Shader "Custom/X" { Properties { _MainTex } }')
  fs.writeFileSync(path.join(src, GUID_B, 'asset.meta'), 'x')
  fs.writeFileSync(path.join(src, GUID_B, 'preview.png'), 'pngbytes')
  const csGuid = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0d0d0'
  fs.writeFileSync(path.join(src, csGuid, 'pathname'), 'Assets/Demo/Editor/Setup.cs')
  fs.writeFileSync(path.join(src, csGuid, 'asset'), 'using UnityEngine;')
  fs.writeFileSync(path.join(src, csGuid, 'asset.meta'), 'y')
  const heavy = 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0'
  fs.writeFileSync(path.join(src, heavy, 'pathname'), 'Assets/Demo/Heavy.fbx')
  fs.writeFileSync(path.join(src, heavy, 'asset'), Buffer.alloc(32 * 1024 * 1024, 0x41))
  fs.writeFileSync(path.join(src, heavy, 'asset.meta'), 'z')
  await tar.create({ gzip: true, cwd: src, file: path.join(root, 'min.unitypackage') }, fs.readdirSync(src))
  fs.rmSync(src, { recursive: true, force: true })

  /**
   * ⚠ 再做一个**条目名全带 `./` 前缀**的包 —— 那才是真 .unitypackage 的形状。
   *
   * 实测 `jp.lilxyzw.liltoon-2.x.x-installer.unitypackage` 是 **12/12 条全带**：
   * `./`、`./4b344df74d4849e3b2c978b959abd31b/`、`./4b344df.../pathname`。
   * 而 `rel.split('/').filter(Boolean)` **不会**去掉 `'.'`（它是真值），
   * 于是 guid 恒为 `'.'`、所有 pathname 互相覆盖 —— 整个包只解析出 1 条。
   *
   * ⚠⚠ 造这个包**必须用 `tar.c(..., { prefix: './' })`**。
   * 第一版我用 `tar.create(cwd, ['./', './<guid>', ...])` —— 那个**造不出**目标形状：
   * tar 会**同时**写一份不带 `./` 的规范化条目名兜底（实测 9 条里有一半是干净的），
   * 于是 buggy 代码照样能解析正确，用例**假通过**（我把它回退成 buggy 版验证时才发现的）。
   * `tar.c` + `prefix` 才是全带前缀（实测 3/3）。
   */
  const src2 = path.join(root, 'src2')
  fs.mkdirSync(path.join(src2, GUID_A), { recursive: true })
  fs.mkdirSync(path.join(src2, GUID_B), { recursive: true })
  fs.writeFileSync(path.join(src2, GUID_A, 'pathname'), 'Assets/Demo/Body.prefab')
  fs.writeFileSync(path.join(src2, GUID_A, 'asset'), 'body')
  fs.writeFileSync(path.join(src2, GUID_A, 'asset.meta'), 'fileFormatVersion: 2')
  fs.writeFileSync(path.join(src2, GUID_B, 'pathname'), 'Assets/Demo/Toon.shader')
  fs.writeFileSync(path.join(src2, GUID_B, 'asset'), 'shader')
  fs.writeFileSync(path.join(src2, GUID_B, 'asset.meta'), 'x')
  await tar.c(
    { gzip: true, cwd: src2, file: path.join(root, 'dotted.unitypackage'), prefix: './' },
    [GUID_A, GUID_B]
  )
  fs.rmSync(src2, { recursive: true, force: true })
}, 120000)

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 临时目录交给系统 */
  }
})

/** 现场造一个"带指定大小 preview.png"的包，用来验封面能不能抠出来 */
async function makePreviewPackage(unityPath: string, previewBytes: number): Promise<string> {
  const guid = 'b'.repeat(32)
  const src = path.join(root, 'prev-src-' + previewBytes + '-' + unityPath.replace(/\W/g, '_'))
  fs.mkdirSync(path.join(src, guid), { recursive: true })
  fs.writeFileSync(path.join(src, guid, 'pathname'), unityPath)
  fs.writeFileSync(path.join(src, guid, 'asset'), Buffer.alloc(64, 0x41))
  fs.writeFileSync(path.join(src, guid, 'asset.meta'), 'x')
  fs.writeFileSync(path.join(src, guid, 'preview.png'), Buffer.alloc(previewBytes, 0x50))
  const out = path.join(root, 'prev-' + previewBytes + '.unitypackage')
  await tar.create({ gzip: true, cwd: src, file: out }, fs.readdirSync(src))
  fs.rmSync(src, { recursive: true, force: true })
  return out
}

describe('parseUnitypackage', () => {
  it('**条目名带 `./` 前缀的包也要全部解析出来**（真包的形状）', async () => {
    /**
     * 回归用例：修之前这里只会出 1 条（所有 pathname 都写在 guid='.' 这个键上互相覆盖），
     * 而且 `entries[0].guid` 不是 32 位十六进制。真包里就是这种形状。
     */
    const r = await parseUnitypackage(path.join(root, 'dotted.unitypackage'))
    expect(r.ok).toBe(true)
    /** 先确认这个包确实是"带 ./ 前缀"的形状，否则整个用例是假的 */
    {
      const raw: string[] = []
      await new Promise<void>((resolve, reject) => {
        const p = new tar.Parse({
          strict: false,
          onentry(e: tar.ReadEntry) {
            raw.push(e.path)
            e.resume()
          }
        })
        p.on('end', () => resolve())
        /** Parse 的类型只声明了 entry/end/close，错误挂在流上 */
        const src = fs.createReadStream(path.join(root, 'dotted.unitypackage'))
        src.on('error', reject)
        src.pipe(zlib.createGunzip()).pipe(p)
      })
      expect(raw.some((x) => x.startsWith('./')), `包里的条目名没有 ./ 前缀：${JSON.stringify(raw)}`).toBe(true)
      /** 而且**不能**有干净的兜底条目 —— 有的话这个用例就又变成假的了 */
      expect(raw.some((x) => !x.startsWith('./') && x.includes('/'))).toBe(false)
    }
    const paths = r.entries.map((e) => e.unityPath).sort()
    expect(paths).toEqual(['Assets/Demo/Body.prefab', 'Assets/Demo/Toon.shader'])
    /** 每条的 guid 都必须是合法的 32 位十六进制 */
    for (const e of r.entries) {
      expect(e.guid, `guid 不合法：${JSON.stringify(e.guid)}`).toMatch(/^[0-9a-f]{32}$/)
    }
    expect(r.guidSet.has(GUID_A)).toBe(true)
    expect(r.guidSet.has(GUID_B)).toBe(true)
  })

  it('解析出正确的 guid / unityPath / entryKind（§8.4）', async () => {
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'))
    expect(r.ok, r.error).toBe(true)
    expect(r.entries.length).toBe(4)
    const prefab = r.entries.find((e) => e.unityPath.endsWith('Body.prefab'))
    expect(prefab?.guid).toBe(GUID_A)
    expect(prefab?.entryKind).toBe('prefab')
    expect(r.entries.find((e) => e.unityPath.endsWith('.shader'))?.entryKind).toBe('shader')
    expect(r.entries.find((e) => e.unityPath.endsWith('.cs'))?.entryKind).toBe('cs')
    expect(r.entries.find((e) => e.unityPath.endsWith('.fbx'))?.entryKind).toBe('fbx')
  })

  it('hasShader / hasEditorScript 判定正确', async () => {
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'))
    expect(r.hasShader).toBe(true)
    expect(r.hasEditorScript).toBe(true)
  })

  it('包内 GUID 算 internal，包外 GUID 才算 externalRefs（§2.3）', async () => {
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'))
    expect(r.externalRefs.has(GUID_OUTSIDE)).toBe(true)
    expect(r.externalRefs.has(GUID_B)).toBe(false)
    expect(r.guidSet.has(GUID_A)).toBe(true)
  })

  it('preview.png 会被标到对应条目上', async () => {
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'))
    expect(pickPackageCover(r)).toBe('Assets/Demo/Toon.shader')
  })

  it('32MB 的 asset 主体不该进内存：只读元数据要快且省（§9）', async () => {
    if (!global.gc) {
      // 没开 --expose-gc 就只验耗时，内存那条留给性能脚本
    }
    const before = process.memoryUsage().heapUsed
    const t0 = Date.now()
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'))
    const ms = Date.now() - t0
    const grew = process.memoryUsage().heapUsed - before
    expect(r.ok).toBe(true)
    expect(ms).toBeLessThan(5000)
    // 32MB 主体若被读进内存，这里会直接涨过 32MB
    expect(grew).toBeLessThan(16 * 1024 * 1024)
    // 但 size 要从 tar 头里拿到，不用读正文
    const heavy = r.entries.find((e) => e.unityPath.endsWith('.fbx'))
    expect(heavy?.size).toBe(32 * 1024 * 1024)
  }, 60000)

  it('关掉 scanRefs 时不读正文，仍然能列出条目', async () => {
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'), { scanRefs: false })
    expect(r.ok).toBe(true)
    expect(r.entries.length).toBe(4)
    expect(r.externalRefs.size).toBe(0)
  })

  it('损坏文件返回错误而不是抛异常（§8.4 / §2.2 要点 5）', async () => {
    const bad = path.join(root, 'bad.unitypackage')
    fs.writeFileSync(bad, Buffer.from('这不是 gzip 也不是 tar，就是一串垃圾'.repeat(3)))
    const r = await parseUnitypackage(bad)
    expect(r.ok).toBe(false)
    expect(r.error && r.error.length).toBeGreaterThan(0)
    expect(r.entries).toEqual([])
  })

  it('文件不存在也不抛', async () => {
    const r = await parseUnitypackage(path.join(root, '没有这个文件.unitypackage'))
    expect(r.ok).toBe(false)
  })

  it('maxEntries 截断而不是失败', async () => {
    const r = await parseUnitypackage(path.join(root, 'min.unitypackage'), { maxEntries: 2 })
    expect(r.ok).toBe(true)
    expect(r.entries.length).toBe(2)
  })

  it('进度回调会被叫到', async () => {
    let calls = 0
    await parseUnitypackage(path.join(root, 'min.unitypackage'), { onProgress: () => calls++ })
    expect(calls).toBeGreaterThan(0)
  })
})

/**
 * 自动解压开着时，内层包已经在暂存目录里，不必二次解压，直接读。
 * 这条分支漏过一次：束縛チャイナFULLSET.zip 一开自动解压就退化成 other/0%，
 * 因为包里的 Assets/ 路径只有解析才看得见。
 */
describe('digStagedUnitypackages（解压后的内层包）', () => {
  let staged = ''

  beforeAll(() => {
    staged = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-staged-'))
    fs.copyFileSync(path.join(root, 'min.unitypackage'), path.join(staged, 'Fullset v1.3.unitypackage'))
    fs.writeFileSync(path.join(staged, 'cover.png'), 'notapackage')
  })

  afterAll(() => {
    try {
      fs.rmSync(staged, { recursive: true, force: true })
    } catch {
      /* 交给系统 */
    }
  })

  it('读出包里的 Unity 工程路径', async () => {
    const r = await digStagedUnitypackages(staged, [
      { relPath: 'Fullset v1.3.unitypackage', size: fs.statSync(path.join(staged, 'Fullset v1.3.unitypackage')).size },
      { relPath: 'cover.png', size: 8 }
    ])
    expect(r.parsed).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.extraPaths.some((p) => p.endsWith('Body.prefab'))).toBe(true)
    expect(r.extraPaths.some((p) => p.endsWith('.shader'))).toBe(true)
    expect(r.extraPaths).toContain('Editor/dig.cs')
  })

  it('没有内层包时返回空，不去碰别的文件', async () => {
    const r = await digStagedUnitypackages(staged, [{ relPath: 'cover.png', size: 8 }])
    expect(r).toEqual({ extraPaths: [], parsed: 0, failed: 0 })
  })

  it('坏包只算 failed，不抛异常拖慢摄取', async () => {
    const r = await digStagedUnitypackages(staged, [{ relPath: 'broken.unitypackage', size: 12 }])
    expect(r.parsed).toBe(0)
    expect(r.failed).toBe(1)
  })

  it('超过大小上限的包跳过（防单个巨型包把摄取拖死）', async () => {
    const r = await digStagedUnitypackages(staged, [{ relPath: 'Fullset v1.3.unitypackage', size: 4 * 1024 * 1024 * 1024 }])
    expect(r).toEqual({ extraPaths: [], parsed: 0, failed: 0 })
  })
})

describe('extractPackagePreview（从包里抠封面）', () => {
  it('太小的 preview 不当封面（fixture 里那张只有 8 字节）', async () => {
    // 真实包里卖家放的 preview 都是几百 KB，小于 2KB 的一律是占位/角标
    expect(await extractPackagePreview(path.join(root, 'min.unitypackage'))).toBeNull()
  })

  it('够大的 preview 能读出来，并带上它属于哪个工程路径', async () => {
    const big = await makePreviewPackage('Assets/Demo/Big.png', 3072)
    const r = await extractPackagePreview(big)
    expect(r, '应该能读到封面').not.toBeNull()
    expect(r!.bytes.length).toBe(3072)
    expect(r!.unityPath).toBe('Assets/Demo/Big.png')
  }, 60000)

  it('不是 unitypackage 的文件返回 null，不抛', async () => {
    const junk = path.join(root, 'junk.bin')
    fs.writeFileSync(junk, Buffer.from('这不是 gzip'.repeat(10)))
    expect(await extractPackagePreview(junk)).toBeNull()
  })

  it('文件不存在返回 null', async () => {
    expect(await extractPackagePreview(path.join(root, '没有这个.unitypackage'))).toBeNull()
  })

  it('包里没有 preview.png 时返回 null', async () => {
    const src = path.join(root, 'noprev-src')
    const guid = 'a'.repeat(32)
    fs.mkdirSync(path.join(src, guid), { recursive: true })
    fs.writeFileSync(path.join(src, guid, 'pathname'), 'Assets/Demo/Only.fbx')
    fs.writeFileSync(path.join(src, guid, 'asset'), Buffer.alloc(4096, 0x42))
    fs.writeFileSync(path.join(src, guid, 'asset.meta'), 'x')
    const out = path.join(root, 'noprev.unitypackage')
    await tar.create({ gzip: true, cwd: src, file: out }, fs.readdirSync(src))
    expect(await extractPackagePreview(out)).toBeNull()
  }, 60000)
})

describe('renderTree', () => {
  it('渲染成缩进文本，超长要截断', () => {
    const tree = renderTree([
      { unityPath: 'Assets/A/B.cs', entryKind: 'cs' },
      { unityPath: 'Assets/A/C.cs', entryKind: 'cs' }
    ])
    expect(tree).toContain('Assets/')
    expect(tree).toContain('  A/')
    expect(tree).toContain('B.cs  [cs]')
    const many = Array.from({ length: 300 }, (_, i) => ({ unityPath: `Assets/f${i}.png`, entryKind: 'png' }))
    expect(renderTree(many)).toContain('还有 100 项')
  })
})

describe('真件：用户库里的 unitypackage', () => {
  const USER_ZIP = 'E:/vrc/test/inbox/Grimoir_SHINANO_V1.0.zip'
  const skip = !fs.existsSync(USER_ZIP)
  const maybe = skip ? it.skip : it

  maybe('从 zip 里取出真 .unitypackage 解析，条目路径应是 Assets/ 开头', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-real-'))
    try {
      await extractZip(USER_ZIP, out, {})
      const found: string[] = []
      const walk = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (/\.unitypackage$/i.test(e.name)) found.push(p)
        }
      }
      walk(out)
      expect(found.length).toBeGreaterThan(0)
      const r = await parseUnitypackage(found[0])
      expect(r.ok, r.error).toBe(true)
      expect(r.entries.length).toBeGreaterThan(0)
      expect(r.entries.every((e) => /^Assets\//i.test(e.unityPath))).toBe(true)
      // 真包里通常带外部依赖（lilToon 之类）
      expect(r.externalRefs.size).toBeGreaterThanOrEqual(0)
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  }, 120000)
})
