import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { setAppPathsForTest } from '../../src/main/services/paths'
import {
  archiveVaultKey,
  forgetRemembered,
  listRemembered,
  recallArchivePassword,
  rememberArchivePassword,
  setVaultCipherForTest,
  vaultAvailable,
  type VaultCipher
} from '../../src/main/services/secrets'

/**
 * M7 ⑥ · 密码库（`safeStorage` + `password_vault`）。
 *
 * ## 为什么要注入一个假的加解密器
 *
 * 真的那份是 electron 的 `safeStorage`，node 环境里拿不到。但**最要紧的三条分支恰恰是
 * "加密不可用"和"解不开"** —— 不注入就永远测不到，而这两条正是"会不会把密码写明文"的分界线。
 *
 * ## 这份文件在钉的那句硬话
 *
 * **加密不可用 = 什么都不写。** 做之前是"没记住"，做之后如果是明文落盘，
 * 那就是把一个可用的软件换成了一个泄密的软件 —— 比不做更坏。
 */

let root = ''
let db: Db
let pkg = ''
/** 假 DPAPI：**倒着存**，这样"存进去的不是明文"这条断言才有意义（base64 那种不算加密也不改字节内容） */
function fakeCipher(opts: { available?: boolean; breakDecrypt?: boolean } = {}): VaultCipher {
  const available = opts.available !== false
  return {
    algo: 'test-fake',
    available: () => available,
    encrypt: (plain) => Buffer.from([...plain].reverse().join(''), 'utf8'),
    decrypt: (blob) => {
      if (opts.breakDecrypt) throw new Error('DPAPI 解不开（换了机器？）')
      return [...blob.toString('utf8')].reverse().join('')
    }
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-vault-'))
  setAppPathsForTest(path.join(root, 'app'))
  db = openDatabase(path.join(root, 'library.db'))
  pkg = path.join(root, 'pack.7z')
  fs.writeFileSync(pkg, Buffer.concat([Buffer.from('MAGIC-HEAD-'), Buffer.alloc(1024, 7)]))
  setVaultCipherForTest(fakeCipher())
})

afterEach(() => {
  setVaultCipherForTest(null)
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('键', () => {
  it('同一个文件算出来稳定，且带前缀（以后要能换算法）', () => {
    const a = archiveVaultKey(pkg)
    expect(a).toMatch(/^pwv1:[0-9a-f]{32}$/)
    expect(archiveVaultKey(pkg)).toBe(a)
  })

  it('内容或大小变了就是另一个键；改名不影响', () => {
    const before = archiveVaultKey(pkg)
    const copy = path.join(root, '完全改了名.7z')
    fs.copyFileSync(pkg, copy)
    expect(archiveVaultKey(copy), '同一个包改了名 → 应该还是同一条密码').toBe(before)
    fs.appendFileSync(pkg, Buffer.from('x'))
    expect(archiveVaultKey(pkg), '内容变了还认同一条 = 拿错密码').not.toBe(before)
  })

  it('文件不在 → null（不许抛，调用方按"没记住"处理）', () => {
    expect(archiveVaultKey(path.join(root, 'gone.7z'))).toBeNull()
    expect(archiveVaultKey(root), '目录不是包').toBeNull()
  })
})

describe('rememberArchivePassword', () => {
  it('⭐ 存进去的字节**不是明文**，而且能原样解回来', () => {
    expect(rememberArchivePassword(db, pkg, 'hunter-中文')).toBe('stored')
    const raw = db.prepare(`SELECT password_enc, hint, platform, author FROM password_vault`).get() as {
      password_enc: Buffer
      hint: string
      platform: string
      author: string
    }
    expect(raw.password_enc.toString('utf8')).not.toContain('hunter')
    expect(raw.password_enc.toString('utf8')).not.toBe('hunter-中文')
    /** hint / author 也不许带密码 */
    expect(raw.hint + raw.author).not.toContain('hunter')
    expect(raw.platform).toBe('test-fake')
    expect(recallArchivePassword(db, pkg)).toBe('hunter-中文')
  })

  it('⭐ 加密不可用 → 库里一行都没有，返回 unavailable（绝不退回明文落盘）', () => {
    setVaultCipherForTest(fakeCipher({ available: false }))
    expect(vaultAvailable()).toBe(false)
    expect(rememberArchivePassword(db, pkg, 'secret')).toBe('unavailable')
    expect(db.prepare(`SELECT COUNT(*) c FROM password_vault`).get()).toEqual({ c: 0 })
    expect(recallArchivePassword(db, pkg)).toBeNull()
  })

  it('加密器抛错 → failed，也不留半行数据', () => {
    setVaultCipherForTest({
      algo: 'test-fake',
      available: () => true,
      encrypt: () => {
        throw new Error('encrypt 炸了')
      },
      decrypt: () => ''
    })
    expect(rememberArchivePassword(db, pkg, 'secret')).toBe('failed')
    expect(db.prepare(`SELECT COUNT(*) c FROM password_vault`).get()).toEqual({ c: 0 })
  })

  it('空密码 / 文件读不到 → failed（不写库）', () => {
    expect(rememberArchivePassword(db, pkg, '')).toBe('failed')
    expect(rememberArchivePassword(db, path.join(root, 'nope.7z'), 'x')).toBe('failed')
    expect(db.prepare(`SELECT COUNT(*) c FROM password_vault`).get()).toEqual({ c: 0 })
  })

  it('同一个包再存一次是**覆盖**，不是插两条', () => {
    rememberArchivePassword(db, pkg, 'old')
    rememberArchivePassword(db, pkg, 'new')
    expect(db.prepare(`SELECT COUNT(*) c FROM password_vault`).get()).toEqual({ c: 1 })
    expect(recallArchivePassword(db, pkg)).toBe('new')
  })
})

describe('取与列', () => {
  it('⭐ 解不开（换机器 / 换了 Windows 用户）→ 返回 null，但**那行留着**，界面上要看得见', () => {
    rememberArchivePassword(db, pkg, 'secret')
    setVaultCipherForTest(fakeCipher({ breakDecrypt: true }))
    expect(recallArchivePassword(db, pkg)).toBeNull()
    expect(db.prepare(`SELECT COUNT(*) c FROM password_vault`).get()).toEqual({ c: 1 })
  })

  it('列表**不含明文也不含密文**，只说能不能解开', () => {
    rememberArchivePassword(db, pkg, 'secret')
    const list = listRemembered(db)
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain('secret')
    expect(list[0].readable).toBe(true)
    expect(list[0].hint).toContain('pack.7z')
    expect(list[0].path).toBe(path.win32.normalize(pkg))
  })

  it('解不开的那条在列表里标成 readable:false（不偷偷删，让他自己删）', () => {
    rememberArchivePassword(db, pkg, 'secret')
    setVaultCipherForTest(fakeCipher({ breakDecrypt: true }))
    expect(listRemembered(db)[0].readable).toBe(false)
    expect(db.prepare(`SELECT COUNT(*) c FROM password_vault`).get()).toEqual({ c: 1 })
  })

  it('删除：删得掉、删第二次返回 false', () => {
    rememberArchivePassword(db, pkg, 'secret')
    const id = listRemembered(db)[0].id
    expect(forgetRemembered(db, id)).toBe(true)
    expect(listRemembered(db)).toEqual([])
    expect(forgetRemembered(db, id)).toBe(false)
  })
})
