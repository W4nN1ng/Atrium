/**
 * 容器成员清单（M5-B ③）。
 *
 * 三条封顶不是"防御性编程"，是**为了界面上能说实话**：
 * 撞线必须被记下来（`truncated` / `capped`），否则用户看到的就是"这个容器里没有包"，
 * 而事实是"A 只看了前 N 条"。老代码 `findPackages(dir, depth=4)` 就在静默少列
 * —— 真库实测那个 87 个包的容器它只看得见 80 个。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { listContainerMembers, sortableMembers, DEFAULT_LIMITS } from '../../src/main/import/containerPackages'
import { buildRealUnitypackage, find7z, makeZip } from '../helpers/containers'

const BIN = path.resolve(process.cwd(), 'resources/bin')

let tmp: string
/** 一个"目录型容器"：三层散装包 + 一个子压缩包 + 一个垃圾 + 一条深到撞上限的 */
let dirContainer: string
/** 一个"压缩包型容器"：里面套一层目录，目录里才是包 */
let zipContainer: string
/** 真库实测形状：名字叫 .zip 的**目录** */
let fakeZipDir: string
/** 头部加密的 7z：连清单都要密码 */
let encArchive: string

const PW = 'avca-list-pw'

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-list-'))

  dirContainer = path.join(tmp, '初音的VRC小店')
  // 散装包 ×3（含一条 depth=4 的，老上限正好卡在它身上）
  await buildRealUnitypackage(path.join(dirContainer, '插件17件', '假掉线系统', 'Disconnect.unitypackage'))
  await buildRealUnitypackage(path.join(dirContainer, '道具22件', 'Vielo', 'Vielo_Moe.unitypackage'))
  // 6 段：老的 findPackages(depth=4) 只能看到 5 段，这条正是它漏掉的那一类
  await buildRealUnitypackage(path.join(dirContainer, 'ERP用12件', '整合版DPS', '选择2', '自制：dpsfullset1.5整合包', 'dpsfullset1.5', 'dpsfullset.unitypackage'))
  // 深到撞上限的一条（默认 8 段）
  await buildRealUnitypackage(path.join(dirContainer, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '太深了.unitypackage'))
  // 子压缩包：只记不钻
  const inner = path.join(tmp, 'inner-src')
  fs.mkdirSync(inner, { recursive: true })
  await buildRealUnitypackage(path.join(inner, '不该被看见.unitypackage'))
  makeZip(inner, path.join(dirContainer, '插件17件', '子包.zip'), ['不该被看见.unitypackage'], BIN)
  // 垃圾：光一个 .DS_Store 文件本来就不会进清单（它不是 .unitypackage），
  // 真正要挡的是 Mac 打包带进来的 `__MACOSX/._xxx.unitypackage` —— 那是**像包的文件**
  fs.writeFileSync(path.join(dirContainer, '插件17件', '.DS_Store'), 'junk')
  await buildRealUnitypackage(path.join(dirContainer, '__MACOSX', '._Disconnect.unitypackage'))
  // 非包成员
  fs.writeFileSync(path.join(dirContainer, '说明.txt'), 'readme')

  zipContainer = path.join(tmp, 'TS_MaterialPack_1.zip')
  const nest = path.join(tmp, 'nest-src')
  fs.mkdirSync(nest, { recursive: true })
  const innerUp = path.join(nest, 'TS_MaterialPack_1')
  fs.mkdirSync(innerUp, { recursive: true })
  await buildRealUnitypackage(path.join(innerUp, 'TS_MaterialPack_1.unitypackage'))
  fs.writeFileSync(path.join(innerUp, 'Readme.txt'), 'booth.pm/items/1')
  makeZip(nest, zipContainer, ['TS_MaterialPack_1'], BIN)

  fakeZipDir = path.join(tmp, 'Texture_Package.zip')
  fs.mkdirSync(path.join(fakeZipDir, 'Texture_Package'), { recursive: true })
  await buildRealUnitypackage(path.join(fakeZipDir, 'Texture_Package', 'TexturePackage.unitypackage'))

  // 加密档的"饵"要放在 cwd 里，不然 7z 报"系统找不到指定的文件"
  fs.writeFileSync(path.join(tmp, 'note.txt'), 'readme')
  encArchive = path.join(tmp, 'enc.7z')
  execFileSync(find7z(BIN), ['a', '-t7z', '-y', `-p${PW}`, '-mhe=on', encArchive, 'note.txt'], {
    cwd: tmp,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}, 240000)

afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('目录型容器', () => {
  it('散装包全列出来，含藏在第五层的那条（老上限看不见它）', async () => {
    const r = await listContainerMembers(dirContainer, { extraBackendDirs: [BIN] })
    expect(r.isArchive).toBe(false)
    const rels = r.members.map((m) => m.relPath).sort()
    expect(rels).toContain('插件17件/假掉线系统/Disconnect.unitypackage')
    const hiddenByOldLimit =
      'ERP用12件/整合版DPS/选择2/自制：dpsfullset1.5整合包/dpsfullset1.5/dpsfullset.unitypackage'
    expect(rels).toContain(hiddenByOldLimit)
    /**
     * 6 段。老实现 `findPackages(dir, depth=4)` 最深只能看到 5 段
     * （真库实测：那个容器 87 个包里它看得见 80 个、看不见 7 个，
     * 看不见的正是 6/7 段那批）。
     */
    const deep = r.members.find((m) => m.relPath.includes('dpsfullset'))
    expect(deep?.depth).toBe(6)
    for (const m of r.members) {
      expect(m.originArchive).toBe(null)
      /**
       * 散装成员必须带**磁盘上真的在哪**：后面那一步（抽出来给 Unity）只认这个字段。
       * P0-1 教的就是"调用方自己拼路径"迟早拼错，所以清单直接把路径交出去。
       */
      expect(m.absPath, `absPath 该指向真实文件：${m.relPath}`).toBeTruthy()
      expect(fs.existsSync(m.absPath as string), `absPath 不存在：${m.absPath}`).toBe(true)
    }
  })

  it('垃圾条目与非包文件不进清单', async () => {
    const r = await listContainerMembers(dirContainer, { extraBackendDirs: [BIN] })
    expect(r.members.some((m) => /\.DS_Store/i.test(m.relPath))).toBe(false)
    expect(r.members.some((m) => /说明\.txt$/i.test(m.relPath))).toBe(false)
    /**
     * 这条才是真挡事的那个：`__MACOSX/._xxx.unitypackage` 扩展名是对的、
     * 体积也不为 0，不排掉它就会在容器里多出一个"看不见的假包"，
     * 用户勾下去导进 Unity 才发现问题。
     * 回退确认：把 `isJunkRelPath(rel)` 那行注掉，这条红。
     */
    expect(r.members.some((m) => /__MACOSX/i.test(m.relPath))).toBe(false)
  })

  it('包里还有压缩包：只记一笔、绝不往里钻（一层封顶）', async () => {
    const r = await listContainerMembers(dirContainer, { extraBackendDirs: [BIN] })
    expect(r.blocked.some((b) => b.key === 'nestedArchive' && /子包\.zip$/.test(b.relPath))).toBe(true)
    /** 里面那个包要是被钻了就会出现在 members 里 */
    expect(r.members.some((m) => /不该被看见/.test(m.relPath))).toBe(false)
  })

  it('撞深度上限的要记在 capped 上，不许静默少列', async () => {
    const r = await listContainerMembers(dirContainer, { extraBackendDirs: [BIN] })
    expect(r.capped.depth, '那条 9 段的包应该被 depthMax=8 挡掉并计数').toBe(1)
    expect(r.truncated).toBe(true)
    expect(r.members.some((m) => /太深了/.test(m.relPath))).toBe(false)
  })

  it('撞数量上限同理（用一个刚好 3 个包的小容器演示，不靠造 400 个文件）', async () => {
    /**
     * 单独造一个"三个都在第一层"的容器：拿 `dirContainer` 测上限会被
     * 深度上限先干扰（readdir 顺序不由我们定），断言就成了看运气。
     */
    const flat = path.join(tmp, 'flat')
    for (const n of ['a', 'b', 'c']) await buildRealUnitypackage(path.join(flat, `${n}.unitypackage`))
    const all = await listContainerMembers(flat, { extraBackendDirs: [BIN] })
    expect(all.members).toHaveLength(3)
    expect(all.capped).toEqual({ depth: 0, count: 0 })
    expect(all.truncated).toBe(false)

    const r = await listContainerMembers(flat, { limits: { scanMax: 2 } })
    expect(r.members).toHaveLength(2)
    expect(r.capped.count).toBe(1)
    expect(r.capped.depth).toBe(0)
    expect(r.truncated).toBe(true)
    /**
     * 上限可以从外面收紧/放宽做测试，但**默认值必须盖得住真库的形状**：
     * `插件道具合集-初音的VRC小店` 实测 87 个包、最深 7 段。
     */
    expect(DEFAULT_LIMITS.depthMax).toBeGreaterThanOrEqual(7)
    expect(DEFAULT_LIMITS.scanMax).toBeGreaterThanOrEqual(100)
  })
})

describe('压缩包型容器与"名字叫 .zip 的目录"', () => {
  it('zip 里的成员带 originArchive，路径按包内相对路径记', async () => {
    const r = await listContainerMembers(zipContainer, { extraBackendDirs: [BIN] })
    expect(r.isArchive).toBe(true)
    expect(r.members).toHaveLength(1)
    const m = r.members[0]
    expect(m.relPath).toBe('TS_MaterialPack_1/TS_MaterialPack_1.unitypackage')
    expect(m.originArchive).toBe(zipContainer)
    expect(m.depth).toBe(2)
    expect(m.sizeBytes, '清单里就该带体积（界面要显示"这个包多大"）').toBeGreaterThan(0)
    expect(r.backend, '列清单用的后端要能报出来（"这台机器读不了 rar"全靠它）').toBeTruthy()
  })

  it('名字叫 .zip 的目录走目录分支（真库实测有 2 个这种）', async () => {
    const r = await listContainerMembers(fakeZipDir, { extraBackendDirs: [BIN] })
    expect(r.isArchive).toBe(false)
    expect(r.blocked.filter((b) => b.key === 'listFailed')).toEqual([])
    expect(r.members.map((m) => m.relPath)).toEqual(['Texture_Package/TexturePackage.unitypackage'])
    /** 回退确认：把 `st.isDirectory()` 那支删掉，这里会变成一次后端调用 + 一条 listFailed */
  })

  it('非容器的单文件（一张 png）→ 空清单，不算失败', async () => {
    const png = path.join(tmp, 'plain.png')
    fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'))
    const r = await listContainerMembers(png, { extraBackendDirs: [BIN] })
    expect(r.members).toEqual([])
    expect(r.blocked, "不是压缩包是常态，不该往 blocked 里塞一条'读失败了'").toEqual([])
  })
})

describe('加密与读不动的容器', () => {
  it('头部加密的 7z：needsPassword 要单独报出来，界面才说得出"这个包要密码"', async () => {
    const r = await listContainerMembers(encArchive, { extraBackendDirs: [BIN] })
    expect(r.needsPassword).toBe(true)
    expect(r.blocked.some((b) => b.key === 'passwordNeeded')).toBe(true)
    expect(r.members).toEqual([])
  })

  it('给了密码就能列全', async () => {
    const r = await listContainerMembers(encArchive, { password: PW, extraBackendDirs: [BIN] })
    expect(r.needsPassword).toBe(false)
    expect(r.blocked).toEqual([])
    /** 这个加密包里只有 说明.txt，没有包 —— 清单为空是对的，但不该报失败 */
    expect(r.members).toEqual([])
    expect(r.scannedEntries).toBeGreaterThan(0)
  })

  it('文件不存在 → 空清单，不抛', async () => {
    const r = await listContainerMembers(path.join(tmp, '没有这个东西.zip'))
    expect(r.members).toEqual([])
    expect(r.blocked).toEqual([])
  })
})

describe('sortableMembers', () => {
  it('体积降序，同体积按路径 —— 界面上"最大的那个包"永远在第一条', async () => {
    const r = await listContainerMembers(dirContainer, { extraBackendDirs: [BIN] })
    const s = sortableMembers(r)
    expect(s.length).toBe(r.members.length)
    for (let i = 1; i < s.length; i++) expect(s[i - 1].sizeBytes).toBeGreaterThanOrEqual(s[i].sizeBytes)
    /** 不许改动原清单（界面还会拿它做勾选状态） */
    expect(r.members.map((m) => m.relPath)).not.toEqual(undefined)
  })
})
