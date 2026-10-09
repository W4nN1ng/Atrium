/**
 * M7 ⑥ · 密码库的**接线**（判据与行为在 `tests/services/secrets.spec.ts`）。
 *
 * 这个仓库反复栽在"函数写好了、没人调用"（`project/running.ts` 死代码、
 * `autoSwitchBehavior` / `bridgeAutoInstall` 两个死设置、`libraryRootOrThrow` 定义了零调用）。
 * 密码这条链有六段：主进程服务 → IPC 常量 → handler → 注册 → preload → 界面，
 * 少任何一段，用户看到的都是"勾了记住、下次还是问"，而测试全绿。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

describe('密码库六段接线', () => {
  it('⭐ 摄取链真的会**用**记住的密码，也会**存**（不然这就是又一个死服务）', () => {
    const api = stripComments(read('src/main/ingest/api.ts'))
    expect(api).toContain('recallArchivePassword(')
    expect(api).toContain('rememberArchivePassword(')
    /** 撞见要密码时先试记住的那条；试过一次就不许再试（错密码会 need-password → 又拿同一条 → 死循环） */
    expect(api).toMatch(/if \(!job\.vaultTried\) \{\s*\n\s*job\.vaultTried = true/)
    /** 用户重新给密码 → 允许再试一次 */
    expect(api).toMatch(/job\.vaultTried = false/)
  })

  it('IPC 常量 / handler / 注册 / preload / 界面，五段一段不能少', () => {
    expect(stripComments(read('src/shared/ipc.ts'))).toContain("List: 'secrets:list'")
    expect(stripComments(read('src/main/ipc/secrets.ts'))).toContain(`registrar.ipc.handle('secrets:list'`)
    const index = stripComments(read('src/main/index.ts'))
    expect(index).toContain('registerSecrets(registrar)')
    const preload = stripComments(read('src/preload/index.ts'))
    expect(preload).toContain(`invoke('secrets:list')`)
    expect(preload).toContain(`invoke('secrets:forget', id)`)
    expect(preload).toContain(`invoke('ingest:submit-password', jobId, password, remember === true)`)
    /** 界面：勾 + 面板都得挂上 */
    const inbox = stripComments(read('src/renderer/pages/Inbox.tsx'))
    expect(inbox).toContain('submitPassword(item.jobId, pw, remember)')
    expect(inbox).toContain('ingest.rememberPassword')
    const settings = stripComments(read('src/renderer/pages/Settings.tsx'))
    expect(settings).toContain('<PasswordVaultPanel />')
  })

  it('⭐ 密码本身绝不进日志、不进 IPC 返回值（只报"存了几十字节密文"）', () => {
    const secrets = stripComments(read('src/main/services/secrets.ts'))
    /** 所有 log.* 调用的参数里都不许出现 password / plain / saved 这几个变量名 */
    for (const line of secrets.split('\n').filter((l) => /\blog\.(info|warn|error)\(/.test(l))) {
      expect(line, '日志里带了密码：' + line.trim()).not.toMatch(/\$\{[^}]*(password|plain|saved)/i)
    }
    /** 仓储与 IPC 也不许把明文递出去：list 那条路径里没有任何 decrypt 的返回值 */
    const ipc = stripComments(read('src/main/ipc/secrets.ts'))
    expect(ipc).not.toContain('decrypt')
    expect(ipc).not.toContain('password_enc')
  })
})
