/**
 * `password_vault` 表的仓储（M7 ⑥）。
 *
 * ## 为什么复用这张老表
 *
 * 它在 schema V1 就建好了（`hint / password_enc / platform / item_id / author`），
 * 之后一直**没人读过也没人写过**。第 6 轮 Q1 的裁定是"不为几个布尔动 schema"，
 * 这里同理：能用的列就用，不新开迁移。列的用法写死在下面：
 *
 *  - `item_id`   = 这条密码管的是哪个包 —— 内容指纹键（见 `secrets.ts` 的 `archiveVaultKey`）
 *  - `password_enc` = **加密之后**的字节。表里绝不允许出现明文，一条用例钉着
 *  - `platform`  = 用的哪套加密（`win-dpapi` / `test-fake`）—— 换机器解不开时能看出为什么
 *  - `hint`      = 给人看的说明（文件名 + 大小），**不含密码**
 *  - `author`    = 存的时候那个包的路径，方便他认出是哪一条
 *
 * 同 `item_id` **覆盖**而不是插新行：同一个包重下、密码改了，留两条只会让他猜哪条是真的。
 */
import type { Db } from '../../db'

export interface VaultRow {
  id: number
  hint: string | null
  password_enc: Buffer | null
  platform: string | null
  item_id: string | null
  author: string | null
}

export interface VaultInput {
  itemId: string
  hint: string
  platform: string
  author: string
  passwordEnc: Buffer
}

export function upsertVaultRow(db: Db, input: VaultInput): number {
  const existing = db.prepare(`SELECT id FROM password_vault WHERE item_id = ?`).get(input.itemId) as { id: number } | undefined
  if (existing) {
    db.prepare(
      `UPDATE password_vault SET hint = ?, password_enc = ?, platform = ?, author = ? WHERE id = ?`
    ).run(input.hint, input.passwordEnc, input.platform, input.author, existing.id)
    return existing.id
  }
  const r = db
    .prepare(`INSERT INTO password_vault (hint, password_enc, platform, item_id, author) VALUES (?, ?, ?, ?, ?)`)
    /**
     * ⚠ 参数次序必须跟着**列的次序**走，不能跟着下面那个对象字面量的写法走。
     * 第一版这里是 `(hint, enc, platform, author, itemId)` —— 于是 `item_id` 存成了路径、
     * `author` 存成了键，`WHERE item_id = ?` 再也查不到，"覆盖"变成"每次插一条新的"。
     * 三条用例（不是明文 / 覆盖只留一条 / 列表里 path 是路径）当场把它抓了。
     */
    .run(input.hint, input.passwordEnc, input.platform, input.itemId, input.author)
  return Number(r.lastInsertRowid)
}

export function getVaultRow(db: Db, itemId: string): VaultRow | null {
  const row = db.prepare(`SELECT * FROM password_vault WHERE item_id = ?`).get(itemId) as VaultRow | undefined
  return row ?? null
}

/** 按 id 排序，界面直接列 */
export function listVaultRows(db: Db): VaultRow[] {
  return db.prepare(`SELECT * FROM password_vault ORDER BY id`).all() as VaultRow[]
}

export function deleteVaultRow(db: Db, id: number): boolean {
  return db.prepare(`DELETE FROM password_vault WHERE id = ?`).run(id).changes > 0
}
