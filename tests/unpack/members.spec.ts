/**
 * 定点抽取的回归测试 —— 三条 P0 缺陷各钉一颗钉子。
 *
 * 出处：`docs/M5B-DESIGN.md` §2。三条的共同点是**"实现了但没生效"**：
 * 都不抛错、都不红，只是静默少干活，所以断言必须打在"磁盘上到底落了什么"
 * 和"内层包到底被解析出条目没有"上，不能打在源码文本上。
 *
 * ⚠ 每条用例都做过"把修复回退掉它会红"的确认，回退方法写在用例注释里。
 *   （这个仓库为这条纪律付过三次学费，见 CHANGE-REPORT §7.1。）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as tar from 'tar'
import { extractMembers, listMembers, NotAnArchiveError } from '../../src/main/unpack/members'
import { resolveBackend, extractArchive } from '../../src/main/unpack/sevenZip'
import { memberMatches } from '../../src/main/unpack/entryMatch'
import { extractZip } from '../../src/main/unpack/unzip'
import { parseUnitypackage } from '../../src/main/unpack/unitypackage'
import { digUnitypackages, type WorkerJob } from '../../src/main/ingest/worker'

const BIN = path.resolve(process.cwd(), 'resources/bin')
const PW = 'avca-test-pw'

function find7z(): string {
  for (const n of ['7z.exe', '7za.exe']) {
    const p = path.join(BIN, n)
    if (fs.existsSync(p)) return p
  }
  throw new Error('没找到 7z：先跑 node tools/fetch-7z.cjs（这几条用例不许 skip，跳了就等于没测）')
}

let tmp: string
/** 一个**真的** .unitypackage（tar.gz + `./` 前缀，形状照 lilToon 实测抄） */
let realUp: string
let nestZip: string
let siblingsZip: string
let manyZip: string
let encZip: string
let enc7z: string
let nest7z: string
/** 名字叫 .zip 的目录：真库里实测有 2 个（Texture_Package.zip / Shinano_Guidance.zip） */
let fakeZipDir: string

/** 相对压缩包根列出全部成员（正斜杠） */
function landed(dest: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else out.push(path.relative(dest, f).replace(/\\/g, '/'))
    }
  }
  walk(dest)
  return out.sort()
}

async function buildRealUnitypackage(file: string): Promise<void> {
  const src = path.join(tmp, '_upsrc_' + path.basename(file))
  const g1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const g2 = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
  fs.mkdirSync(path.join(src, g1), { recursive: true })
  fs.mkdirSync(path.join(src, g2), { recursive: true })
  fs.writeFileSync(path.join(src, g1, 'pathname'), 'Assets/Shinano/Hair/Ponytail.prefab')
  fs.writeFileSync(path.join(src, g1, 'asset'), '%YAML 1.1\n--- !u!1 &2\n')
  fs.writeFileSync(path.join(src, g1, 'asset.meta'), 'fileFormatVersion: 2')
  fs.writeFileSync(path.join(src, g2, 'pathname'), 'Assets/Shinano/Toon.shader')
  fs.writeFileSync(path.join(src, g2, 'asset'), 'Shader "Custom/X"')
  fs.writeFileSync(path.join(src, g2, 'asset.meta'), 'fileFormatVersion: 2')
  /**
   * ⚠ 必须 `tar.c(..., { prefix: './' })`。
   * 用 `tar.create(cwd, ['./x'])` 造不出目标形状 —— tar 会同时写一份不带前缀的
   * 规范化条目名兜底，于是有 bug 的解析器照样通过（这个坑已经有主记录在
   * tests/classify/unitypackage.spec.ts 里，别再踩一遍）。
   */
  await tar.c({ gzip: true, cwd: src, file, prefix: './' }, [g1, g2])
  fs.rmSync(src, { recursive: true, force: true })
}

function zip(fromDir: string, file: string, entries: string[], extra: string[] = []): void {
  // stdin 必须关掉：加密/交互提示会让 7z 永远挂着（项目备忘里的坑）
  execFileSync(find7z(), ['a', '-tzip', '-y', ...extra, file, ...entries], {
    cwd: fromDir,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-members-'))

  realUp = path.join(tmp, 'inner.unitypackage')
  await buildRealUnitypackage(realUp)

  /** 真库最常见的形状：外面一层同名目录，里面才是包 */
  const nest = path.join(tmp, 'nest')
  fs.mkdirSync(path.join(nest, 'TS_MaterialPack_1'), { recursive: true })
  fs.copyFileSync(realUp, path.join(nest, 'TS_MaterialPack_1', 'TS_MaterialPack_1.unitypackage'))
  fs.writeFileSync(path.join(nest, 'TS_MaterialPack_1', 'Readme.txt'), 'booth.pm/items/1234567\n')
  nestZip = path.join(tmp, 'nest.zip')
  zip(nest, nestZip, ['TS_MaterialPack_1'])

  /** 前缀兄弟名：勾一个会不会带出一串 */
  const sib = path.join(tmp, 'sib')
  fs.mkdirSync(sib, { recursive: true })
  fs.writeFileSync(path.join(sib, 'A.pack'), 'one')
  fs.writeFileSync(path.join(sib, 'A.package.unitypackage'), 'two')
  fs.writeFileSync(path.join(sib, 'A.pack.meta'), 'three')
  siblingsZip = path.join(tmp, 'siblings.zip')
  zip(sib, siblingsZip, ['A.pack', 'A.package.unitypackage', 'A.pack.meta'])

  /** 30 个成员，验"只抽一个"真的只落地一个 */
  const many = path.join(tmp, 'many')
  fs.mkdirSync(many, { recursive: true })
  const names: string[] = []
  for (let i = 0; i < 30; i++) {
    const n = `f${String(i).padStart(2, '0')}.txt`
    fs.writeFileSync(path.join(many, n), 'x'.repeat(1024))
    names.push(n)
  }
  manyZip = path.join(tmp, 'many.zip')
  zip(many, manyZip, names)

  /**
   * 加密 zip：7z 的 zip 只能做**内容**加密（`-mhe` 是 7z 格式自己的选项，
   * 配 `-tzip` 用会直接 System ERROR —— 我第一次就踩在这个上面）。
   * 所以这条验的是"清单能列（yauzl 读中央目录）、但一解就要密码"。
   */
  encZip = path.join(tmp, 'enc.zip')
  zip(many, encZip, names, [`-p${PW}`])

  /**
   * 头部加密的 .7z：这种连"包里有几个文件"都要密码才读得出来。
   * 项目备忘里那条"listArchive 也得收密码，否则用户输对了也永远停在需要密码"就是它。
   */
  enc7z = path.join(tmp, 'enc.7z')
  execFileSync(find7z(), ['a', '-t7z', '-y', `-p${PW}`, '-mhe=on', enc7z, 'f03.txt'], {
    cwd: many,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  /** 非 zip 分支（走 7z 后端），同样是嵌套形状 */
  nest7z = path.join(tmp, 'nest.7z')
  execFileSync(find7z(), ['a', '-t7z', '-y', nest7z, 'TS_MaterialPack_1'], {
    cwd: nest,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  fakeZipDir = path.join(tmp, 'Texture_Package.zip')
  fs.mkdirSync(path.join(fakeZipDir, 'Texture_Package'), { recursive: true })
  fs.writeFileSync(path.join(fakeZipDir, 'Texture_Package', 'note.txt'), '其实这是个目录')
}, 180000)

afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 句柄没放掉就交给系统 */
  }
})

describe('P0-1 嵌套成员：抽取按完整路径落盘，调用方必须用它回报的 localPath', () => {
  it('抽嵌套在内层目录里的 .unitypackage，落地的文件真的能解析出条目', async () => {
    const list = await listMembers(nestZip)
    const want = list.entries.find((e) => /\.unitypackage$/i.test(e.path))
    expect(want, 'fixture 里应该有内层包').toBeTruthy()
    /** 这条断言就是钉住"形状"的：成员确实在子目录里，不是根下 */
    expect(want!.path.split('/').length).toBeGreaterThan(1)

    const dest = path.join(tmp, 'out-nest')
    const r = await extractMembers(nestZip, dest, [want!.path])
    expect(r.missing, JSON.stringify(r)).toEqual([])
    expect(r.members).toHaveLength(1)
    expect(fs.existsSync(r.members[0].localPath), 'localPath 指向的文件必须真的在').toBe(true)

    const parsed = await parseUnitypackage(r.members[0].localPath, { scanRefs: false })
    expect(parsed.ok, parsed.error).toBe(true)
    expect(parsed.entries.map((e) => e.unityPath).sort()).toEqual([
      'Assets/Shinano/Hair/Ponytail.prefab',
      'Assets/Shinano/Toon.shader'
    ])
    /**
     * 回退确认：把 members.ts 里的 `scanLanded` 命中改成
     * `path.join(dest, path.basename(w))`，这条用例就红（解析步会拿不到文件）。
     * —— 这正是 worker 里那个 bug 的原样。
     */
  })

  it('非 zip 分支（7z 后端）也一样给 localPath', async () => {
    const list = await listMembers(nest7z, { extraBackendDirs: [BIN] })
    const want = list.entries.find((e) => /\.unitypackage$/i.test(e.path))
    expect(want).toBeTruthy()
    const dest = path.join(tmp, 'out-7z')
    const r = await extractMembers(nest7z, dest, [want!.path], { extraBackendDirs: [BIN] })
    expect(r.missing, JSON.stringify(r)).toEqual([])
    expect(fs.existsSync(r.members[0].localPath)).toBe(true)
    /**
     * ⚠ `extraBackendDirs` 必须显式传自带的那份。
     * 不传的话 `resolveBackend` 会退到 `7zip-bin/7za.exe`，而它不认 `-sccUTF-8`/`-bso1`，
     * 表现是"好包被报成损坏包"—— 那条现在有独立的错误类兜着（见下面那支用例）。
     */
  })

  it('分类流程真的能吃到嵌套内层包（以前这条是静默空的）', async () => {
    const list = await listMembers(nestZip)
    const staging = path.join(tmp, 'staging-nest')
    fs.mkdirSync(staging, { recursive: true })
    const job = {
      type: 'job',
      jobId: 't1',
      sourcePath: nestZip,
      stagingPath: staging,
      extract: false,
      backendDirs: [BIN],
      resourceRoot: path.resolve(process.cwd(), 'resources')
    } as WorkerJob
    const entries = list.entries.map((e) => ({ path: e.path, size: e.size, isDir: !!e.isDir }))
    const r = await digUnitypackages(job, entries)
    expect(r.parsed, `parsed=0 就是 P0-1 的症状：内层包一个都没读到`).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.extraPaths).toContain('Assets/Shinano/Hair/Ponytail.prefab')
    /** dig 读完必须把副本删掉（它落在系统盘上） */
    expect(fs.existsSync(path.join(staging, '_dig')), '_dig 临时目录没清').toBe(false)
    /**
     * 回退确认：把 worker.ts 改回 `path.join(dest, path.basename(t.path))`，
     * `parsed` 变 0、`extraPaths` 变空数组 —— 而**旧代码一条测试都没有**，
     * 全绿状态下这个 bug 已经活了整个 M3~M5。
     */
  })
})

describe('P0-2 only 不许前缀匹配：勾一个不许带出兄弟', () => {
  it('memberMatches：等值或目录前缀才算，纯前缀不算', () => {
    expect(memberMatches('A.pack', 'A.pack')).toBe(true)
    expect(memberMatches('dir/A.pack', 'dir/A.pack')).toBe(true)
    expect(memberMatches('A.package.unitypackage', 'A.pack')).toBe(false)
    expect(memberMatches('A.pack.meta', 'A.pack')).toBe(false)
    expect(memberMatches('dir/A.pack', 'dir')).toBe(true)
    expect(memberMatches('dir2/A.pack', 'dir')).toBe(false)
    expect(memberMatches('x', '')).toBe(false)
  })

  it('extractZip 只落地点名的那一个成员', async () => {
    const dest = path.join(tmp, 'out-sib')
    const r = await extractZip(siblingsZip, dest, { only: ['A.pack'] })
    expect(r.files).toBe(1)
    expect(landed(dest)).toEqual(['A.pack'])
    /**
     * 回退确认：把 unzip.ts 那行退回 `name.startsWith(p)` →
     * r.files 变 3、landed 变三个文件（A.pack / A.pack.meta / A.package.unitypackage）。
     */
  })

  it('extractMembers 同样只落地点名的那一个', async () => {
    const dest = path.join(tmp, 'out-sib2')
    const r = await extractMembers(siblingsZip, dest, ['A.pack'])
    expect(r.members.map((m) => m.relPath)).toEqual(['A.pack'])
    expect(r.unexpected, `多解出来的东西：${r.unexpected.join(',')}`).toEqual([])
  })
})

describe('语义闸门：不得整包解压 / 空清单不许当"全部"', () => {
  it('30 个成员的包，只抽 1 个时磁盘上就只有那 1 个', async () => {
    const dest = path.join(tmp, 'out-many')
    const r = await extractMembers(manyZip, dest, ['f07.txt'])
    expect(landed(dest)).toEqual(['f07.txt'])
    expect(r.totalBytes).toBeGreaterThan(0)
    /**
     * 回退确认：去掉 `only`（等于把整包解出来）→ landed 长度变 30。
     * 这条守的是"实测 39 MB 的包解出 933 个文件 / 75 MB"那个前科。
     */
  })

  it('wanted 传空数组直接抛，绝不解释成"解全部"', async () => {
    await expect(extractMembers(manyZip, path.join(tmp, 'never'), [])).rejects.toThrow(/不能为空/)
    const dest = path.join(tmp, 'out-empty')
    const r = await extractZip(manyZip, dest, { only: [] })
    expect(r).toEqual({ files: 0, bytes: 0 })
    expect(fs.existsSync(dest) ? landed(dest) : []).toEqual([])
    /** 回退确认：把 members.ts 里 `if (!list.length) throw` 短路掉 → 第一条断言红 */
  })

  it('7z 后端也一样：空 only 不等于"解全部"', async () => {
    const dest = path.join(tmp, 'out-empty7z')
    const r = await extractArchive(nest7z, dest, { only: [], extraBackendDirs: [BIN] })
    expect(r).toEqual({ files: 0, bytes: 0 })
    expect(fs.existsSync(dest) ? landed(dest) : []).toEqual([])
    /**
     * 回退确认：把 sevenZip.ts 那句 `if (opts.only && opts.only.length === 0)` 短路掉，
     * 这条就红（7z 少传成员参数 = 把整包摊到 destDir）。
     */
  })
})

describe('P0-3 先问磁盘事实，再看名字', () => {
  it('名字叫 .zip 的目录：报 NotAnArchiveError，不去起后端', async () => {
    expect(fs.statSync(fakeZipDir).isDirectory()).toBe(true)
    await expect(listMembers(fakeZipDir)).rejects.toThrow(NotAnArchiveError)
    await expect(extractMembers(fakeZipDir, path.join(tmp, 'nope'), ['x.txt'])).rejects.toMatchObject({
      why: 'is-directory'
    })
    /**
     * 回退确认：去掉 stat 那一步、只按扩展名分支，
     * 这里会变成 7z 的一堆 `Cannot open the file as archive`（我第一版探针就是这个下场）。
     */
  })

  it('文件不存在也报同一类，不报"空包"', async () => {
    await expect(listMembers(path.join(tmp, '没有这个文件.zip'))).rejects.toThrow(NotAnArchiveError)
  })
})

describe('加密 zip 那条转交分支不许把 only 丢掉', () => {
  it('加密包定点抽取：给了密码、只落地点名的那一个成员', async () => {
    const dest = path.join(tmp, 'out-enc')
    const r = await extractMembers(encZip, dest, ['f03.txt'], { password: PW, extraBackendDirs: [BIN] })
    expect(r.missing, JSON.stringify(r)).toEqual([])
    const files = landed(dest)
    expect(files).toEqual(['f03.txt'])
    /**
     * 回退确认：把 extractZip 里转交 7z 那次调用退回
     * `extractArchive(file, destDir, { password, extraBackendDirs })`（少了 only），
     * files 就变 30 个 —— 而这条**以前一定会通过**，
     * 因为旧断言只到"加密 zip 能解开"。这就是"假回归用例"的第四个坑。
     */
  })
})

describe('加密：清单和抽取的密码口径要分清', () => {
  it('内容加密的 zip：清单能列出来（标 encrypted），但要抽就必须要密码', async () => {
    const ok = await listMembers(encZip)
    expect(ok.entries.length).toBeGreaterThanOrEqual(30)
    expect(ok.encrypted, '条目要标出加密，否则界面永远停在"需要密码"以外的文案').toBe(true)
    await expect(extractMembers(encZip, path.join(tmp, 'out-enc2'), ['f03.txt'])).rejects.toThrow(/密码|password/i)
  })

  it('7z 不再误用已安装的 UnRAR，能力足够的 7za 可以正常读取', async () => {
    /**
     * M2 核实：旧的「未知选项」来自把已装 UnRAR 误当成 7z CLI。
     * 7za 本身可以处理 7z；RAR 现在走独立的 WASM 解码器。
     * 以前的表现是 CorruptArchiveError「压缩包损坏或格式不支持」—— 假话。
     * ⚠ resolveBackend 有模块级缓存，这里换了必须在 finally 里换回来，
     *    否则同一文件里后面的用例会全部走错后端（我先踩过一次，红得莫名其妙）。
     */
    try {
      const backend = resolveBackend([], true)
      expect(backend?.kind).not.toBe('rar')
      const listed = await listMembers(nest7z)
      expect(listed.entries.some((entry) => /\.unitypackage$/i.test(entry.path))).toBe(true)
    } finally {
      resolveBackend([BIN], true)
    }
    const back = await listMembers(nest7z, { extraBackendDirs: [BIN] })
    expect(back.entries.length).toBeGreaterThan(0)
  })

  it('头部加密的 .7z：连"包里有几个文件"都要密码 —— listArchive 必须收密码这个参数', async () => {
    await expect(listMembers(enc7z, { extraBackendDirs: [BIN] })).rejects.toThrow(/密码|password/i)
    const ok = await listMembers(enc7z, { password: PW, extraBackendDirs: [BIN] })
    expect(ok.entries.some((e) => /f03\.txt$/.test(e.path))).toBe(true)
  })
})

describe('listMembers：清单口径与后端口径', () => {
  it('zip 走 yauzl、7z 走外部后端，两边都给出条目和体积', async () => {
    const z = await listMembers(nestZip)
    expect(z.backend).toBe('yauzl')
    expect(z.entries.some((e) => /\.unitypackage$/i.test(e.path))).toBe(true)
    const s = await listMembers(nest7z, { extraBackendDirs: [BIN] })
    expect(s.backend).not.toBe('yauzl')
    expect(s.entries.some((e) => /\.unitypackage$/i.test(e.path))).toBe(true)
  })

  it('magic bytes 说话，扩展名不算话：rar 改名成 .zip 也走 7z 后端', async () => {
    const asZip = path.join(tmp, '骗人的.zip')
    fs.copyFileSync(nest7z, asZip)
    const r = await listMembers(asZip, { extraBackendDirs: [BIN] })
    expect(r.backend).not.toBe('yauzl')
    expect(r.format).toBe('sevenz')
    expect(r.entries.some((e) => /\.unitypackage$/i.test(e.path))).toBe(true)
    /** 名字是 .zip 而内容是 7z —— 按扩展名分支的老代码会在这里直接崩 */
    const dest = path.join(tmp, 'out-liar')
    const want = r.entries.find((e) => /\.unitypackage$/i.test(e.path))!
    const got = await extractMembers(asZip, dest, [want.path], { extraBackendDirs: [BIN] })
    expect(got.missing, JSON.stringify(got)).toEqual([])
  })
})
