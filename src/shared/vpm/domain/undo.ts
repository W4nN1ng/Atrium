import type { ChangePlanChange, ChangePlanRequest } from './plan'

/**
 * 从一次已提交的计划推导"反向请求"。
 *
 * 撤销不是复制文件，而是**生成反向计划再走一次同一事务**（P4 §7.5）。
 * 这里只做纯推导，不查仓库、不写工程：
 * - install（原本没有 → 装上）→ remove
 * - remove（原本有 → 卸掉）→ install 回原版本
 * - upgrade / downgrade（a → b）→ install 回 a
 * - reinstall（a → a）→ reinstall a
 * - keep → 跳过
 *
 * 返回空数组表示"没有可反向的动作"，调用方应当拒绝撤销。
 */
export function reverseRequests(changes: readonly ChangePlanChange[]): ChangePlanRequest[] {
  const out: ChangePlanRequest[] = []
  const seen = new Set<string>()
  for (const change of changes) {
    if (!change || typeof change.name !== 'string' || !change.name.trim()) continue
    const name = change.name.trim()
    let request: ChangePlanRequest | null = null
    if (change.action === 'install') {
      request = { kind: 'remove', name }
    } else if (change.action === 'remove' && change.from) {
      request = { kind: 'install', name, version: change.from }
    } else if ((change.action === 'upgrade' || change.action === 'downgrade') && change.from) {
      request = { kind: 'install', name, version: change.from }
    } else if (change.action === 'reinstall' && change.from) {
      request = { kind: 'reinstall', name, version: change.from }
    }
    if (!request) continue
    const key = `${request.kind}\0${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(request)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
}
