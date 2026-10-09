/**
 * M7 ⑥ · 加密包密码的保管（规格 01§安全：「密码库用 Electron `safeStorage` 加密存储，不明文落盘」）。
 *
 * ## 三条硬规矩
 *
 *  1. **加密不可用 = 不存。** `safeStorage.isEncryptionAvailable()` 为 false 的时候，
 *     宁可每次重新问一遍，也**绝不退回明文落盘** —— 那比不做更坏（做之前是"没记住"，
 *     做之后是"密码在磁盘上裸奔"）。这条由 `tests/services/secrets.spec.ts` 钉着，
 *     并且是 `tools/verify-red-m7.cjs` 点名的变异之一。
 *  2. **库里只存密文。** 表里那列叫 `password_enc`，写进去的必须过 `encrypt()`；
 *     列表接口**永远不回明文**（只回"能不能解开"）。
 *  3. **解不开就说解不开。** Windows 上 `safeStorage` 走 DPAPI，**绑定当前用户 + 当前机器**：
 *     换机、换 Windows 用户、重装系统之后读不回来 —— 那不是 bug，是这台机器给的保证的边界。
 *     所以 `platform` 列存的是"当时用哪套加密"，界面上要照实写"这台机器上解不开"，
 *     不许假装"跨设备可用"。
 *
 * ## 键为什么是"大小 + 头 64KB 的哈希"
 *
 * 要的是"下次遇到**同一个包**别再问一遍"，所以键必须满足：
 *  - **不用密码就能算**（包是加密的，头 64KB 也是密文，正好稳定）；
 *  - **不读全文件**（库里几十 GB，为了填个密码把整包哈希一遍不值）；
 *  - **改名不影响**（同一个包复制一份改了名，内容一样 → 同一个键，这是想要的行为）。
 * 两个不同包撞上"大小相同且头 64KB 逐字节相同"的概率实际为零。
 * 顺带一条：这**不是**内容查重那套（查重用 `hashFile`/`hashSampled`，见 `library/hash.ts`），
 * 别把两边混成一个键 —— 查重要的是全文件，这里要的是"便宜且稳定"。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { Db } from '../db'
import type { RememberedEntry } from '../../shared/types'
import { deleteVaultRow, getVaultRow, listVaultRows, upsertVaultRow } from '../db/repos/passwordVault'

/** 参与键计算的头部字节数。64 KB 够稳定，又不至于让"填个密码"读几十 MB */
const HEAD_BYTES = 64 * 1024

/** 界面与日志上认这套加密的标识（换机之后为什么解不开，靠它说清楚） */
export const VAULT_PLATFORM_DPAPI = 'win-dpapi'
export const VAULT_PLATFORM_NONE = 'none'

/** 可注入的加解密器 —— 默认那一份要碰 electron 的 `safeStorage`，node 环境里测不了，所以留这个缝 */
export interface VaultCipher {
  available(): boolean
  readonly algo: string
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

let injected: VaultCipher | null = null

/** 只给测试用：换掉加解密器（不指到假的那份，就测不到"加密不可用"和"解不开"这两条分支） */
export function setVaultCipherForTest(c: VaultCipher | null): void {
  injected = c
}

function defaultCipher(): VaultCipher {
  return {
    algo: VAULT_PLATFORM_DPAPI,
    available() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return Boolean((require('electron') as typeof import('electron')).safeStorage?.isEncryptionAvailable())
      } catch {
        return false
      }
    },
    encrypt(plain) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return (require('electron') as typeof import('electron')).safeStorage.encryptString(plain)
    },
    decrypt(blob) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return (require('electron') as typeof import('electron')).safeStorage.decryptString(blob)
    }
  }
}

function cipher(): VaultCipher {
  return injected ?? defaultCipher()
}

/** 这台机器现在能不能存密码（界面要用它决定说"能记住"还是"存不了"） */
export function vaultAvailable(): boolean {
  return cipher().available()
}

/** 算某个包的键。读不到文件（刚被移走）→ null，调用方按"没记住"处理，不许抛 */
export function archiveVaultKey(file: string): string | null {
  let fd: number | null = null
  try {
    const st = fs.statSync(file)
    if (!st.isFile()) return null
    const head = Buffer.alloc(Math.min(HEAD_BYTES, st.size))
    fd = fs.openSync(file, 'r')
    const read = fs.readSync(fd, head, 0, head.length, 0)
    const h = createHash('sha256')
    h.update(`${st.size}:`)
    h.update(head.subarray(0, read))
    return 'pwv1:' + h.digest('hex').slice(0, 32)
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 已经要返回 null 了，关不掉不影响 */
      }
    }
  }
}

export type RememberOutcome = 'stored' | 'unavailable' | 'failed'

/**
 * 记住某个包的密码。
 *
 * ⚠ 三条出口里只有 `stored` 会写库。加密不可用时**直接返回**，
 * 既不写明文、也不写"空密文占位行"（占位行会让界面显示一条其实没存东西的记录）。
 */
export function rememberArchivePassword(db: Db, file: string, password: string): RememberOutcome {
  const key = archiveVaultKey(file)
  if (!key) return 'failed'
  if (!password) return 'failed'
  const c = cipher()
  if (!c.available()) {
    log.warn('[vault] 这台机器上加密不可用，密码**没有存**（宁可下次再问，也不写明文）')
    return 'unavailable'
  }
  try {
    const enc = c.encrypt(password)
    const st = safeStat(file)
    upsertVaultRow(db, {
      itemId: key,
      hint: path.basename(file) + (st ? ' · ' + st.size + ' B' : ''),
      platform: c.algo,
      author: path.win32.normalize(file),
      passwordEnc: enc
    })
    /** 只报"存了几十字节的密文"，绝不在日志里带密码本身 */
    log.info(`[vault] 记住了 ${path.basename(file)} 的密码（${enc.length} 字节密文，${c.algo}）`)
    return 'stored'
  } catch (e) {
    log.warn(`[vault] 存密码失败：${String((e as Error)?.message ?? e)}`)
    return 'failed'
  }
}

/**
 * 取回某个包的密码。
 *
 * 三种"取不到"都返回 null，但只有第一种是安静的：
 *  - 没存过 → null（正常，第一次见这个包）
 *  - 解不开（换机 / 换了 Windows 用户）→ null + 一条 warn 日志，行**留着**，让设置里看得见"解不开"
 *  - 文件读不到 → null
 */
export function recallArchivePassword(db: Db, file: string): string | null {
  const key = archiveVaultKey(file)
  if (!key) return null
  const row = getVaultRow(db, key)
  if (!row || !row.password_enc) return null
  try {
    return cipher().decrypt(row.password_enc)
  } catch (e) {
    log.warn(
      `[vault] 解不开 ${row.hint ?? key} 的密码（当时用 ${row.platform ?? '?'} 加密）——` +
        ` 换过机器或 Windows 用户的话这是预期的：${String((e as Error)?.message ?? e)}`
    )
    return null
  }
}

/** 设置页要列的那份。**不含明文，也不含密文**，只给"能不能解开"（类型在 shared/types.ts） */

export function listRemembered(db: Db): RememberedEntry[] {
  const c = cipher()
  return listVaultRows(db).map((r) => {
    let readable = false
    if (r.password_enc && c.available()) {
      try {
        c.decrypt(r.password_enc)
        readable = true
      } catch {
        readable = false
      }
    }
    return {
      id: r.id,
      hint: r.hint ?? '',
      path: r.author ?? '',
      platform: r.platform ?? VAULT_PLATFORM_NONE,
      readable
    }
  })
}

export function forgetRemembered(db: Db, id: number): boolean {
  const ok = deleteVaultRow(db, id)
  if (ok) log.info(`[vault] 删掉了第 ${id} 条记住的密码`)
  return ok
}

function safeStat(file: string): { size: number } | null {
  try {
    return { size: fs.statSync(file).size }
  } catch {
    return null
  }
}
