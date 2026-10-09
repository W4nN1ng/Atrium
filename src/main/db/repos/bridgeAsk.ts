import type { Db } from '../index'
import { bridgeAskKey, parseBridgeAskAnswer, type BridgeAskAnswer } from '../../../shared/bridgeAsk'

/**
 * 「这个工程要不要自动装桥接」的用户答案，存在 `setting` 表里
 * （键 `bridgeAsk:<projectId>`，裁定 Q7：**不为这个动 schema**，和 `projectGuids:<id>` 一个路子）。
 *
 * ⚠ 这里**只管存与取**，"该不该问"的判据在 `shared/bridgeAsk.ts` ——
 * 两边各写一遍必漂（M5-3 一天内犯过两次，记在 MEMORY 里）。
 */

/** 没答过 → null（不是 'never'：没问过和问过并拒了是两件事） */
export function getBridgeAsk(db: Db, projectId: string): BridgeAskAnswer | null {
  const row = db.prepare(`SELECT value_json FROM setting WHERE key = ?`).get(bridgeAskKey(projectId)) as
    | { value_json: string }
    | undefined
  if (!row) return null
  try {
    return parseBridgeAskAnswer(JSON.parse(row.value_json) as unknown)
  } catch {
    /** 脏值（手改过库 / 上一版写的别的形状）当成"没答过"，不许让工程发现整轮挂掉 */
    return null
  }
}

/** null = 把答案清掉（回到"没问过"，下次第一次发现还会问） */
export function setBridgeAsk(db: Db, projectId: string, answer: BridgeAskAnswer | null): void {
  const key = bridgeAskKey(projectId)
  if (answer === null) {
    db.prepare(`DELETE FROM setting WHERE key = ?`).run(key)
    return
  }
  db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(key, JSON.stringify(answer))
}

/** 设置页/维护页要能看见"哪些工程被我设成不再问了"，不然用户想反悔都找不到地方 */
export function listBridgeAsk(db: Db): Array<{ projectId: string; answer: BridgeAskAnswer }> {
  const rows = db.prepare(`SELECT key, value_json FROM setting WHERE key LIKE 'bridgeAsk:%'`).all() as Array<{
    key: string
    value_json: string
  }>
  const out: Array<{ projectId: string; answer: BridgeAskAnswer }> = []
  for (const r of rows) {
    let answer: BridgeAskAnswer | null = null
    try {
      answer = parseBridgeAskAnswer(JSON.parse(r.value_json) as unknown)
    } catch {
      answer = null
    }
    if (!answer) continue
    out.push({ projectId: r.key.slice('bridgeAsk:'.length), answer })
  }
  return out
}
