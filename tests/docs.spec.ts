import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * `docs/` 的交付物**内容**检查。
 *
 * 为什么文档也要测：R-89 / R-90 要求交两份东西 ——「协议完整说明（含命令/结果
 * JSON 示例）+ 调试方法 + 手动模拟一条命令」和「已知限制一节 + 诚实报告未通过的
 * 验收」。这些都在 `BRIDGE.md` 里，而一份"存在但缺了关键小节"的文档
 * 在文件存在性检查下是**看不出问题**的。
 *
 * 这里只查**结构性的东西**（该有的小节在不在、示例是不是真的 JSON）。
 * 不查文笔 —— 文档质量靠人读。
 */

const REPO = path.resolve(__dirname, '..')
const BRIDGE = path.join(REPO, 'docs', 'BRIDGE.md')

function read(): string {
  return fs.readFileSync(BRIDGE, 'utf8')
}

describe('docs/BRIDGE.md（R-89：协议说明 + 调试方法）', () => {
  it('文件存在且不是空壳', () => {
    expect(fs.existsSync(BRIDGE)).toBe(true)
    const src = read()
    /** 一份真正的协议说明不可能只有几百字 */
    expect(src.length).toBeGreaterThan(8000)
  })

  it('三个文件格式都有小节（心跳 / 命令 / 结果）', () => {
    const src = read()
    expect(src).toContain('bridge.json')
    expect(src).toMatch(/inbox\/<id>\.json/)
    expect(src).toMatch(/outbox\/<id>\.json/)
    /** 结果状态枚举要列全，否则实现的人不知道能写哪些 */
    for (const s of ['`ok`', '`progress`', '`busy`', '`error`', '`cancelled`']) {
      expect(src, `状态枚举缺 ${s}`).toContain(s)
    }
  })

  it('**9 条命令一条不落地写进文档**（实现而不文档化，接手的人只能读源码猜）', () => {
    const src = read()
    const cmds = [
      'ping',
      'get_status',
      'resolve_guids',
      'import_unitypackage',
      'import_files',
      'delete_guids',
      'list_project_assets',
      'refresh',
      'open_folder'
    ]
    const missing = cmds.filter((c) => !src.includes('`' + c + '`'))
    expect(missing, `文档里没写这些命令：${missing.join(', ')}`).toEqual([])
  })

  it('命令/结果示例是**真的 JSON**（不是伪代码）', () => {
    const src = read()
    /** 抠出所有 ```json 代码块 */
    const blocks = [...src.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => m[1])
    expect(blocks.length, '一个 json 代码块都没有').toBeGreaterThanOrEqual(4)
    const bad: string[] = []
    for (const b of blocks) {
      try {
        JSON.parse(b)
      } catch (e) {
        bad.push(`${(e as Error).message} —— 块首：${b.trim().slice(0, 60)}`)
      }
    }
    /** 示例里的占位符（如 `…`）会让 JSON.parse 失败，这正是要抓的：示例必须能直接用 */
    expect(bad, `这些 JSON 示例解析不了：\n${bad.join('\n')}`).toEqual([])
  })

  it('有"怎么调试"一节，且包含**手动模拟一条命令**的可复制步骤（R-89 点名要求）', () => {
    const src = read()
    expect(src).toMatch(/##\s*7\.\s*怎么调试/)
    /** 手动模拟要用 PowerShell 给出可复制的片段，含"先 .tmp 再 rename"的纪律 */
    expect(src).toContain('AVCABridge\\inbox')
    expect(src).toMatch(/\.json\.tmp/)
    /** 还应当告诉人怎么看 A 侧日志 */
    expect(src).toMatch(/main\.log|logs/)
  })

  it('有"ack 与终态契约"一节，且写明删除权归读方（最容易两边都删或都不删）', () => {
    const src = read()
    expect(src).toMatch(/ack\s*与终态契约/)
    expect(src).toContain('删除权归读方')
  })

  it('busy 那条真 bug 的因果有记录下来（免得后人又踩）', () => {
    const src = read()
    expect(src).toMatch(/never|从来|没被写过|从来没被写过/)
    expect(src).toContain('ReportBusyToPending')
  })
})

describe('docs/BRIDGE.md（R-90：已知限制 + 诚实报告未验证项）', () => {
  it('有"已知限制"一节', () => {
    expect(read()).toMatch(/##\s*8\.\s*已知限制/)
  })

  it('A 没运行时感知不到 Unity 启动这条物理限制写出来了（§4.3 要求界面说明）', () => {
    const src = read()
    expect(src).toMatch(/A\s*没运行时|A 没运行/)
    expect(src).toMatch(/托盘|tray/)
  })

  it('管理员权限下 WMI 读不到命令行这条写出来了（否则会被当成 bug 反复查）', () => {
    const src = read()
    expect(src).toMatch(/管理员/)
    expect(src).toMatch(/CommandLine|命令行/)
  })

  it('UnityLockfile 必须读写模式试开的坑写出来了，且给出可复现方法', () => {
    const src = read()
    expect(src).toContain('UnityLockfile')
    expect(src).toMatch(/FileShare\.None|读写|r\+/)
    /** 还要说清"不能用 Node 自己当持有者"，那是写测试时踩过的假失败 */
    expect(src).toMatch(/不能用 Node|不构成独占|libuv/)
  })

  it('**未验证的验收项逐条列出**，而不是含糊成"基本可用"', () => {
    const src = read()
    expect(src).toMatch(/尚未验证|未验证/)
    /** §8-1…§8-7 这几条要在文里点到（号码或描述） */
    for (const n of ['§8-1', '§8-2', '§8-3', '§8-5', '§8-6', '§8-7']) {
      expect(src, `未验证清单里没提 ${n}`).toContain(n)
    }
  })

  it('验证边界一节把"已验"与"只能真 Unity 验"分开写（R-90 的核心要求）', () => {
    const src = read()
    expect(src).toMatch(/C# 桥接的验证边界/)
    /** 已验的一侧要提到编译检查 */
    expect(src).toMatch(/check-bridge-compile|编译通过/)
    /** 未验的一侧要点出运行时行为 */
    for (const k of ['InitializeOnLoad', 'ImportPackage', '心跳']) {
      expect(src).toContain(k)
    }
  })

  it('文档里不许出现"已验证"这种没有依据的断言（要能追溯到具体检查）', () => {
    const src = read()
    /**
     * 允许出现"已验证"当词，但**必须**同一段里给出可执行依据。
     * 这里做一个粗但有效的检查：出现"已验证"的次数不该超过给出的命令/文件引用数。
     */
    const claimed = (src.match(/已验证/g) || []).length
    const evidence = (src.match(/npm test|node tools\/|`tests\/|check-bridge-compile/g) || []).length
    expect(claimed, '文档里"已验证"的断言比给出的可执行依据还多，属于空口声称').toBeLessThanOrEqual(
      Math.max(evidence, 3)
    )
  })
})
