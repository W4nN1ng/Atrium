import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTree } from '../../src/main/library/fsx'

/**
 * §A1 三处垃圾过滤里的"列清单"这一处。
 * listTree 同时喂给：目录型素材的清单、解压后暂存目录的清单 —— 漏了它，
 * `__MACOSX/` 的碎片就会进分类语料（实测能把介绍图认成素材本体）。
 */
let root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-fsx-'))

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

function w(rel: string, bytes = 32): void {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(bytes, 0x41))
}

describe('listTree 垃圾过滤', () => {
  it('垃圾文件与垃圾子树都不出现在清单里', async () => {
    const d = path.join(root, 'case1')
    fs.mkdirSync(d, { recursive: true })
    const rel = (p: string): string => p
    w('case1/body.fbx')
    w('case1/.DS_Store')
    w('case1/Thumbs.db')
    w('case1/desktop.ini')
    w('case1/~$说明.docx')
    w('case1/half.crdownload')
    w('case1/__MACOSX/._body.fbx')
    w('case1/__MACOSX/sub/._other.png')
    w('case1/.git/config')
    w('case1/readme.txt')

    const list = await listTree(d)
    const names = list.map((x) => rel(x.relPath)).sort()
    expect(names).toEqual(['body.fbx', 'readme.txt'])
    expect(names.join('|')).not.toMatch(/DS_Store|Thumbs|desktop\.ini|__MACOSX|~\$|crdownload|\.git/i)
  })

  it('正常素材一棵不落地全列出来（过滤器没扩大化）', async () => {
    const d = path.join(root, 'case2')
    fs.mkdirSync(d, { recursive: true })
    w('case2/Assets/Mesh/body.fbx')
    w('case2/Assets/Textures/icon.png')
    w('case2/Assets/Editor/Tool.cs')
    w('case2/preview.jpg')
    const list = await listTree(d)
    expect(list.filter((x) => !x.isDir).map((x) => x.relPath).sort()).toEqual([
      'Assets/Editor/Tool.cs',
      'Assets/Mesh/body.fbx',
      'Assets/Textures/icon.png',
      'preview.jpg'
    ])
    // 相对路径一律正斜杠（splitContainer 两种都认，但下游拼路径靠这个口径）
    expect(list.every((x) => !x.relPath.includes('\\'))).toBe(true)
  })

  it('名字里带点但不是垃圾的照样留着', async () => {
    const d = path.join(root, 'case3')
    fs.mkdirSync(d, { recursive: true })
    w('case3/v1.2.unitypackage')
    w('case3/.hidden-but-mine.txt')
    const list = await listTree(d)
    const names = list.map((x) => x.relPath).sort()
    // `.hidden-but-mine.txt` 不是 AppleDouble（不是 `._` 开头），不许误杀
    expect(names).toEqual(['.hidden-but-mine.txt', 'v1.2.unitypackage'])
  })
})
