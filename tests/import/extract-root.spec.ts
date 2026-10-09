/**
 * 抽取根目录的三道硬闸门（M5-B，设计文档 §3.2）。
 *
 * 这三条不是"锦上添花的校验"，每一条都对应一次会造成真实损失的事故形状：
 *  - 落进库内 → 临时副本被游离扫描报成"没登记的素材"，用户点一次重新登记就灌进库；
 *  - 落进 C 盘 → 本机 C 盘实测只剩 12.0 GB，而内层包单个就有 653 MB；
 *  - 空间没量 → 解到一半写爆，留下一堆半截文件。
 *
 * 口径：闸门只比字符串，所以**校验类断言全用假路径 `D:\...`**，
 * 磁盘读数（剩余空间、盘符）走注入的 `disk` —— 拿真盘做断言会变成
 * "换台机器就红或假绿"的用例（本机 C 盘以外的盘只有 E，而项目纪律是
 * "不许拿用户的 E:\vrc\A 做试验"）。
 * 真落盘的只有 alloc / release / prune 那几条，用 `os.tmpdir()`。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  EXTRACT_DIR_NAME,
  EXTRACT_MIN_FREE,
  ExtractRootError,
  allocMemberDir,
  assertExtractRootUsable,
  defaultExtractRoot,
  freeBytesOf,
  pruneExtractRoot,
  releaseMemberDir,
  resolveExtractRoot,
  sizeOfTree,
  type DiskFacts
} from '../../src/main/import/extractRoot'

const GB = 1024 * 1024 * 1024
const ROOT_FAKE = 'D:\\scratch\\A__extract'

/** 跑一次闸门，返回它拒绝时的 key（放行返回 null） */
function keyOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return (e as ExtractRootError).key ?? null
  }
}

/** 只换读数、不换规则：剩余空间由参数给，盘符按字符串读（生产也是这个 driveOf） */
function disk(freeBytes: (p: string) => number): Partial<DiskFacts> {
  return { freeBytes }
}

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-extract-'))
})
afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('默认推导：库根的兄弟目录，同盘', () => {
  it('E:\\vrc\\A → E:\\vrc\\A__extract', () => {
    expect(defaultExtractRoot('E:\\vrc\\A')).toBe('E:\\vrc\\A__extract')
    /** 输入用正斜杠也一样（path.join 统一成平台分隔符），尾斜杠不影响推导结果 */
    expect(defaultExtractRoot('E:/vrc/A/')).toBe('E:\\vrc\\A__extract')
  })

  it('盘符根下面没有父目录可放 → 返回 null，不硬造', () => {
    expect(defaultExtractRoot('E:\\')).toBe(null)
    expect(defaultExtractRoot('')).toBe(null)
  })

  it('设置项优先；留空才推导；两个都没有就报错而不是猜', () => {
    expect(resolveExtractRoot('F:\\scratch\\ex', 'E:\\vrc\\A')).toBe('F:\\scratch\\ex')
    expect(resolveExtractRoot('   ', 'E:\\vrc\\A')).toBe('E:\\vrc\\A__extract')
    expect(resolveExtractRoot('F:\\scratch\\ex\\', null)).toBe('F:\\scratch\\ex')
    try {
      resolveExtractRoot('', null)
      expect.unreachable('没有库根也推得出抽取目录？')
    } catch (e) {
      expect((e as ExtractRootError).key).toBe('err.extractNoLibrary')
    }
  })
})

describe('闸门一：不许落在库根之内', () => {
  it('抽取目录 == 库根 → 拒绝', () => {
    expect(keyOf(() => assertExtractRootUsable('D:\\vrc\\A', 'D:\\vrc\\A'))).toBe('err.extractInsideLibrary')
  })

  it('抽取目录是库根的子孙目录 → 一样拒绝（斜杠、大小写都拦得住）', () => {
    expect(keyOf(() => assertExtractRootUsable('D:\\vrc\\A\\tmp\\ex', 'D:\\vrc\\A'))).toBe('err.extractInsideLibrary')
    expect(keyOf(() => assertExtractRootUsable('D:/vrc/A/tmp/ex/', 'd:\\vrc\\a\\'))).toBe('err.extractInsideLibrary')
  })

  it('只是名字像（D:\\vrc\\AB 对 D:\\vrc\\A）→ 放行', () => {
    /**
     * 防"把字符串前缀当路径"的经典误判：`AB`.startsWith(`A`) 为真，
     * 但 `D:\vrc\AB` 并不在 `D:\vrc\A` 里面。
     * 回退确认：把实现里的 `root.startsWith(lib + '/')` 退成 `root.startsWith(lib)`，这条红。
     */
    expect(keyOf(() => assertExtractRootUsable('D:\\vrc\\AB__extract', 'D:\\vrc\\A'))).toBe(null)
    expect(keyOf(() => assertExtractRootUsable('D:\\vrc\\A__extract', 'D:\\vrc\\A'))).toBe(null)
  })
})

describe('闸门二：不许落在 C 盘', () => {
  it('C:\\ 开头一律拒绝，大小写都算', () => {
    expect(() => assertExtractRootUsable('C:\\Temp\\avca', 'E:\\vrc\\A')).toThrow(/err.extractOnSystemDrive/)
    expect(() => assertExtractRootUsable('c:\\temp\\avca', 'E:\\vrc\\A')).toThrow(/err.extractOnSystemDrive/)
  })

  it('库根没设也不算放行：只按盘符判', () => {
    expect(() => assertExtractRootUsable('C:\\Temp\\avca', null)).toThrow(/err.extractOnSystemDrive/)
  })

  /**
   * Windows 的命名空间写法说的还是同一个盘。
   * 这不是假想：`\\?\C:\...` **真的能写**（`tools/probe-drive-forms.cjs` 实测），
   * 不剥前缀就等于给"绝不落 C 盘"这条红线留了个后门。
   */
  it('`\\\\?\\C:\\` 这种长路径写法照样拒', () => {
    expect(() => assertExtractRootUsable('\\\\?\\C:\\Temp\\avca', 'E:\\vrc\\A')).toThrow(/err.extractOnSystemDrive/)
    expect(() => assertExtractRootUsable('\\\\.\\C:\\Temp\\avca', 'E:\\vrc\\A')).toThrow(/err.extractOnSystemDrive/)
    expect(() => assertExtractRootUsable('//?/C:/Temp/avca', 'E:\\vrc\\A')).toThrow(/err.extractOnSystemDrive/)
  })

  it('同理，`\\\\?\\E:\\vrc\\A` 是库根，不能因为写法不同就放行', () => {
    /** 空间读数照样注入：这几条验的是"写法不改事实"，不是"E 盘今天够不够" */
    const roomy = disk(() => 50 * GB)
    expect(keyOf(() => assertExtractRootUsable('\\\\?\\E:\\vrc\\A\\ex', 'E:\\vrc\\A', 0, roomy))).toBe(
      'err.extractInsideLibrary'
    )
    /** 别的盘用这种写法不受影响（该放行） */
    expect(keyOf(() => assertExtractRootUsable('\\\\?\\E:\\scratch\\A__extract', 'E:\\vrc\\A', 0, roomy))).toBe(null)
  })
})

describe('闸门三：动手前先量空间', () => {
  it('剩余 < floor = max(need×2, 2GB) → 拒绝，并把两个数报给界面', () => {
    const one = (): number => GB // 假装有 1 GB
    expect(() => assertExtractRootUsable(ROOT_FAKE, null, 900 * 1024 * 1024, disk(one))).toThrow(/err.extractNoSpace/)
    try {
      assertExtractRootUsable(ROOT_FAKE, null, 900 * 1024 * 1024, disk(one))
      expect.unreachable('1 GB 剩余、floor 是 2 GB，居然放行了？')
    } catch (e) {
      const p = (e as ExtractRootError).params
      expect(Number(p.freeGB)).toBe(1)
      /** 900 MB × 2 = 1.76 GB < 2 GB → 地板取 2 GB，不是"要两倍"就完事 */
      expect(Number(p.needGB)).toBe(2)
    }
  })

  it('大包按 need×2 算，2 GB 地板兜不住', () => {
    const five = (): number => 5 * GB
    expect(() => assertExtractRootUsable(ROOT_FAKE, null, 4 * GB, disk(five))).toThrow(/err.extractNoSpace/)
    expect(() => assertExtractRootUsable(ROOT_FAKE, null, 2 * GB, disk(five))).not.toThrow()
  })

  it('量不到的盘（-1）不拦路 —— 报"未知"比不让人干活好', () => {
    expect(() => assertExtractRootUsable(ROOT_FAKE, null, 100 * GB, disk(() => -1))).not.toThrow()
    /** 真函数只验"能读到就读到、读不到就 -1"这一件事，不参与上面的判定 */
    expect(freeBytesOf(path.parse(tmp).root)).toBeGreaterThan(0)
    expect(freeBytesOf('Z:\\根本没有这个盘')).toBeLessThan(0)
  })

  it('2 GB 这个地板是硬编码的（EXTRACT_MIN_FREE），改它要显式改断言', () => {
    expect(EXTRACT_MIN_FREE).toBe(2 * GB)
  })
})

describe('分配 / 释放 / 清扫', () => {
  it('同一个素材的两个成员各占一个目录，互不覆盖', async () => {
    const root = path.join(tmp, 'root1')
    const a = await allocMemberDir(root, 'ASSET1', '0')
    const b = await allocMemberDir(root, 'ASSET1', '1')
    expect(a).not.toBe(b)
    fs.writeFileSync(path.join(a, 'x.unitypackage'), 'one')
    fs.writeFileSync(path.join(b, 'x.unitypackage'), 'two')
    /** 同名文件在两个 seq 目录里都活着 —— 真库里"两个目录里都叫 PSD.zip"就是这个形状 */
    expect(fs.readFileSync(path.join(a, 'x.unitypackage'), 'utf8')).toBe('one')
    expect(fs.readFileSync(path.join(b, 'x.unitypackage'), 'utf8')).toBe('two')

    expect(await releaseMemberDir(a, root)).toBe(true)
    expect(fs.existsSync(a)).toBe(false)
    /** 释放只许删自己那一层；把兄弟端了就是并发事故 */
    expect(fs.existsSync(b), 'release 连同级另一个任务的目录一起删了').toBe(true)
  })

  /**
   * 这道闸门是 M5-B 最贵的一条：`releaseMemberDir` 的调用点旁边就是
   * **用户素材的真实路径**（目录型容器的成员直接指向库里那个 .unitypackage）。
   * 传错一次的症状是"导入报成功，但库里的原件没了"。
   */
  it('release 拒绝删抽取根之外的任何路径', async () => {
    const root = path.join(tmp, 'root-guard')
    const library = path.join(tmp, 'library')
    const realAsset = path.join(library, '衣服', 'A.unitypackage')
    fs.mkdirSync(path.dirname(realAsset), { recursive: true })
    fs.writeFileSync(realAsset, '库里用户的原件，一个字都不许动')
    fs.mkdirSync(root, { recursive: true })

    expect(await releaseMemberDir(realAsset, root)).toBe(false)
    expect(fs.existsSync(realAsset), '把库里的原件删了 —— 这是事故，不是清理').toBe(true)

    /** 抽取根本身也不行：那等于一次调用清掉所有批次 */
    expect(await releaseMemberDir(root, root)).toBe(false)
    expect(fs.existsSync(root)).toBe(true)
  })

  it('release 认不出"大小写与分隔符不同但就是同一棵树"？必须认得出', async () => {
    const root = path.join(tmp, 'root-case')
    const dir = await allocMemberDir(root, 'A3', '0')
    fs.writeFileSync(path.join(dir, 'f'), 'x')
    /** Windows 路径大小写不敏感。判据用 normalizeDirKey，不用字符串 === */
    const 换个写法 = path.join(root.toUpperCase().replace(/ROOT-CASE/, 'root-case'), 'A3', '0')
    expect(await releaseMemberDir(换个写法, root)).toBe(true)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('sizeOfTree 会递归（抽取目录天生三层，不递归就永远是 0）', async () => {
    const root = path.join(tmp, 'root-size')
    const dir = await allocMemberDir(root, 'A9', 7)
    fs.writeFileSync(path.join(dir, 'big.bin'), Buffer.alloc(4096, 0x41))
    expect(sizeOfTree(root)).toBe(4096)
    expect(sizeOfTree(dir)).toBe(4096)
    /**
     * 回退确认：把 sizeOfTree 里"目录继续往下走"那两支删掉（只数一层），
     * 这条和下面 prune 的 bytes 断言一起红。
     */
  })

  it('prune 清整个抽取根；目录不存在就当没事发生', async () => {
    const root = path.join(tmp, 'root2')
    const dir = await allocMemberDir(root, 'A1', 3)
    fs.writeFileSync(path.join(dir, 'big.bin'), Buffer.alloc(4096, 0x41))
    const r = await pruneExtractRoot(root)
    expect(r.removed).toBe(1)
    expect(r.kept).toBe(0)
    expect(r.bytes).toBeGreaterThanOrEqual(4096)
    expect(fs.existsSync(dir)).toBe(false)

    const none = await pruneExtractRoot(path.join(tmp, '根本没有这个目录'))
    expect(none).toEqual({ removed: 0, kept: 0, bytes: 0 })
    fs.mkdirSync(path.join(tmp, 'root3'), { recursive: true })
    expect(await pruneExtractRoot(path.join(tmp, 'root3'))).toEqual({ removed: 0, kept: 0, bytes: 0 })
  })

  it('release 删不掉时不许抛 —— 一次成功的导入不能被清垃圾清成失败', async () => {
    const root = path.join(tmp, 'root4')
    const dir = await allocMemberDir(root, 'A2', '0')
    fs.writeFileSync(path.join(dir, 'f'), 'x')
    expect(await releaseMemberDir(dir, root)).toBe(true)
    /** force 的语义：本来就没有也算处理完了 */
    expect(await releaseMemberDir(path.join(root, '没这个目录'), root)).toBe(true)
  })

  it('手动清理能跳过"还在等用户点确认"的那一支', async () => {
    const root = path.join(tmp, 'root5')
    const busy = await allocMemberDir(root, 'BUSY', '0')
    const stale = await allocMemberDir(root, 'STALE', '0')
    fs.writeFileSync(path.join(busy, 'f'), 'x')
    fs.writeFileSync(path.join(stale, 'f'), 'x')
    const r = await pruneExtractRoot(root, (name) => name === 'BUSY')
    expect(r).toEqual({ removed: 1, kept: 1, bytes: 1 })
    expect(fs.existsSync(busy), '把还在用的副本清了 —— 用户按下确认就会拿到不存在的路径').toBe(true)
    expect(fs.existsSync(stale)).toBe(false)
  })
})
