import { describe, it, expect } from 'vitest'
import type { FileEntry } from '../../src/shared/types'
import { splitContainer } from '../../src/main/fingerprint/primary'
import { isJunkRelPath, isJunkSegment, attachmentKindOf } from '../../src/shared/junk'
import { cleanDisplayName, pickMeaningfulName } from '../../src/shared/naming'

/** 造条目：默认是文件、1 KB，扩展名从名字尾巴上抠 */
function f(relPath: string, size = 1024, isDir = false): FileEntry {
  const m = /\.([A-Za-z0-9]+)$/.exec(relPath)
  return { relPath, size, ext: m ? '.' + m[1].toLowerCase() : '', isDir }
}
const files = (...p: string[]): FileEntry[] => p.map((x) => f(x))
const kinds = (s: ReturnType<typeof splitContainer>): string[] =>
  s.attachments.map((a) => a.kind).sort()
const paths = (s: ReturnType<typeof splitContainer>): string[] =>
  s.attachments.map((a) => a.relPath).sort()

describe('§A1 垃圾过滤：整棵子树都不看', () => {
  it('单文件垃圾', () => {
    for (const n of ['.DS_Store', 'Thumbs.db', 'desktop.ini', 'ehthumbs.db']) {
      expect(isJunkSegment(n), n).toBe(true)
    }
  })

  it('Office 锁文件 / AppleDouble / 半成品下载', () => {
    expect(isJunkSegment('~$报告书.docx')).toBe(true)
    expect(isJunkSegment('._preview.png')).toBe(true)
    for (const n of ['a.tmp', 'a.crdownload', 'a.part', 'a.partial', 'a.swp']) {
      expect(isJunkSegment(n), n).toBe(true)
    }
  })

  it('垃圾目录：**任何一段**命中就整枝掐掉', () => {
    expect(isJunkRelPath('__MACOSX/foo/._bar.png')).toBe(true)
    expect(isJunkRelPath('pkg/.git/config')).toBe(true)
    expect(isJunkRelPath('.svn/entries')).toBe(true)
    expect(isJunkRelPath('Assets/Textures/icon.png')).toBe(false)
    // 反斜杠（目录遍历给的路径）也要认
    expect(isJunkRelPath('__MACOSX\\foo\\bar.png')).toBe(true)
  })

  it('验收 3：垃圾在 splitContainer 的结果里完全不存在', () => {
    const s = splitContainer(
      files(
        'Tool/Tool.unitypackage',
        '.DS_Store',
        'Thumbs.db',
        '__MACOSX/Tool/._Tool.unitypackage',
        'desktop.ini',
        '~$说明.docx',
        'half.crdownload',
        'readme.txt'
      )
    )
    const every = [...paths(s), ...s.others.map((o) => o.relPath), ...(s.primary ?? []).map((p) => p.relPath)]
    expect(every.join('|')).not.toMatch(/DS_Store|Thumbs|__MACOSX|desktop\.ini|~\$|crdownload/i)
    expect(paths(s)).toEqual(['readme.txt'])
  })
})

describe('§A2 附属资源类型表', () => {
  it('六类都对得上', () => {
    expect(attachmentKindOf('a.jpg')).toBe('image')
    expect(attachmentKindOf('a.JPEG')).toBe('image')
    expect(attachmentKindOf('a.webp')).toBe('image')
    expect(attachmentKindOf('a.mp4')).toBe('video')
    expect(attachmentKindOf('a.webm')).toBe('video')
    expect(attachmentKindOf('a.pdf')).toBe('doc')
    expect(attachmentKindOf('a.html')).toBe('doc')
    expect(attachmentKindOf('a.url')).toBe('link')
    expect(attachmentKindOf('a.psd')).toBe('source')
    expect(attachmentKindOf('a.blend')).toBe('source')
    expect(attachmentKindOf('a.ogg')).toBe('audio')
    expect(attachmentKindOf('a.unitypackage')).toBeNull()
    expect(attachmentKindOf('a.zip')).toBeNull()
  })

  it('验收 6 相关：`.url` 是附属，但没被当垃圾丢掉（它还是 Booth ID 的来源）', () => {
    const s = splitContainer(files('Pack/Pack.unitypackage', 'booth_item.url'))
    expect(paths(s)).toEqual(['booth_item.url'])
    expect(s.attachments[0].kind).toBe('link')
  })
})

describe('§A0 真实案例：6866030亲亲音效+亲吻时产生爱心粒子', () => {
  /** 目录里的 6 个条目，照抄改动单 2 §A0 */
  const entries = files(
    'Kiss_Sound_Gimmick_1.0/Kiss Sound Gimmick 1.0.unitypackage',
    '29d6e178-9672-4af7-b1e7-2909aaaa0001.jpg',
    '56374c06-5b70-44bd-979c-f1d8aaaa0002.jpg',
    'd6b99874-3687-4746-8eca-21c8050c74a0.jpg',
    'Kiss_Sound_Gimmick_1.0.zip',
    'Kissギミック.mp4'
  )

  it('只有 1 个主体，3 图 + 1 视频是附属（验收 1）', () => {
    const s = splitContainer(entries)
    expect(s.primaryKind).toBe('unitypackage')
    expect(s.primaryRoot).toBe('Kiss_Sound_Gimmick_1.0')
    expect((s.primary ?? []).map((p) => p.relPath)).toEqual([
      'Kiss_Sound_Gimmick_1.0/Kiss Sound Gimmick 1.0.unitypackage'
    ])
    expect(kinds(s)).toEqual(['image', 'image', 'image', 'video'])
    expect(paths(s)).toEqual([
      '29d6e178-9672-4af7-b1e7-2909aaaa0001.jpg',
      '56374c06-5b70-44bd-979c-f1d8aaaa0002.jpg',
      'Kissギミック.mp4',
      'd6b99874-3687-4746-8eca-21c8050c74a0.jpg'
    ])
    expect(s.allAttachments).toBe(false)
    expect(s.codeOnly).toBe(false)
    // 素材本体的 zip 壳既不是主体也不是附属，进 others（worker 那边已经 dig 过内层了）
    expect(s.others.map((o) => o.relPath)).toEqual(['Kiss_Sound_Gimmick_1.0.zip'])
  })

  it('§A3 取名：UUID 名让位给主体文件名，结果是 Kiss Sound Gimmick（验收 1/2）', () => {
    const s = splitContainer(entries)
    const primaryBase = (s.primary ?? [])[0].relPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? null
    const name = pickMeaningfulName([primaryBase, s.primaryRoot, '6866030亲亲音效+亲吻时产生爱心粒子'])
    expect(name).toBe('Kiss Sound Gimmick')
    expect(cleanDisplayName(primaryBase ?? '').version).toBe('1.0')
  })
})

describe('§A2 主体优先级', () => {
  it('优先级 2：含 Assets/ + ProjectSettings/ 的完整工程', () => {
    const s = splitContainer(
      files(
        'MyProj/Assets/Scene.unity',
        'MyProj/ProjectSettings/ProjectVersion.txt',
        'MyProj/Assets/Textures/icon.png',
        'screenshot.png'
      )
    )
    expect(s.primaryKind).toBe('unity_project')
    expect(s.primaryRoot).toBe('MyProj')
    // 工程内部的 icon.png 属于主体，不是"附属介绍图"
    expect(paths(s)).toEqual(['screenshot.png'])
  })

  it('优先级 5 胜过 3：package.json + Editor/*.cs 是 UPM 包', () => {
    const s = splitContainer(
      files('com.foo.bar/package.json', 'com.foo.bar/Editor/Tool.cs', 'com.foo.bar/Runtime/x.prefab')
    )
    expect(s.primaryKind).toBe('upm')
    expect(s.primaryRoot).toBe('com.foo.bar')
    expect(s.codeOnly, '有主体就不算 codeOnly').toBe(false)
  })

  it('优先级 3：含 prefab/mat/shader/fbx 的目录', () => {
    const s = splitContainer(files('Outfit/Mesh/body.fbx', 'Outfit/Materials/m.mat', 'Outfit/preview.jpg'))
    expect(s.primaryKind).toBe('assets_dir')
    expect(s.primaryRoot).toBe('Outfit')
    expect(paths(s)).toEqual(['Outfit/preview.jpg'])
  })

  it('优先级 1 压过一切：既有工程又有 unitypackage 时认 unitypackage', () => {
    const s = splitContainer(
      files('P/Assets/a.unity', 'P/ProjectSettings/p.txt', 'P/out.unitypackage', 'P/out2.unitypackage')
    )
    expect(s.primaryKind).toBe('unitypackage')
    expect((s.primary ?? []).length).toBe(2)
  })

  it('优先级 4：容器里只有一个压缩包（主体在里面，交给 dig）', () => {
    const s = splitContainer(files('Stuff.zip', 'readme.txt'))
    expect(s.primaryKind).toBe('archive')
    expect((s.primary ?? []).map((p) => p.relPath)).toEqual(['Stuff.zip'])
    expect(paths(s)).toEqual(['readme.txt'])
  })

  it('散在容器根上的资产文件也算主体（没有子目录层）', () => {
    const s = splitContainer(files('hair.fbx', 'hair.png'))
    expect(s.primaryKind).toBe('assets_dir')
    expect(s.primaryRoot).toBeNull()
    expect(paths(s)).toEqual(['hair.png'])
  })

  it('反斜杠路径（目录遍历给的）与正斜杠等价', () => {
    const a = splitContainer(files('Outfit\\Mesh\\body.fbx', 'Outfit\\preview.jpg'))
    const b = splitContainer(files('Outfit/Mesh/body.fbx', 'Outfit/preview.jpg'))
    expect(a.primaryKind).toBe(b.primaryKind)
    expect(a.primaryRoot).toBe('Outfit')
    expect(a.attachments.map((x) => x.relPath)).toEqual(['Outfit\\preview.jpg'])
  })
})

describe('§A5 容器里没有主体时', () => {
  it('全是图片/文档 → allAttachments，整体算 1 个参考资料（一张卡不是 N 张）', () => {
    const s = splitContainer(files('ref01.jpg', 'ref02.png', 'notes.md', 'link.url'))
    expect(s.primary).toBeNull()
    expect(s.allAttachments).toBe(true)
    expect(s.codeOnly).toBe(false)
    expect(s.attachments.length).toBe(4)
  })

  it('验收 4：`Editor/SkinnedMeshMover.cs` 不再单独成卡 → codeOnly', () => {
    const s = splitContainer(files('Editor/SkinnedMeshMover.cs', 'Editor/Other.cs', 'Editor/readme.txt'))
    expect(s.primary).toBeNull()
    expect(s.codeOnly).toBe(true)
    expect(s.allAttachments).toBe(false)
    expect(paths(s)).toEqual(['Editor/readme.txt'])
  })

  it('只有 1 个文件且是图片 → 还是 1 个独立图片素材（allAttachments 为真但只有 1 项）', () => {
    const s = splitContainer(files('wallpaper.png'))
    expect(s.allAttachments).toBe(true)
    expect(s.attachments.length).toBe(1)
  })

  it('只有压缩包壳、里面还没看 → 不是 allAttachments 也不是 codeOnly', () => {
    const s = splitContainer(files('a.zip', 'b.rar'))
    expect(s.allAttachments).toBe(false)
    expect(s.codeOnly).toBe(false)
    expect(s.primaryKind).toBe('archive')
  })

  it('空容器不炸', () => {
    const s = splitContainer([])
    expect(s.primary).toBeNull()
    expect(s.allAttachments).toBe(false)
    expect(s.codeOnly).toBe(false)
  })

  it('目录条目本身不参与判定（只有 isDir=false 的算）', () => {
    const s = splitContainer([f('Empty/', 0, true), f('Empty/x.txt', 10)])
    expect(s.allAttachments).toBe(true)
    expect(s.attachments.length).toBe(1)
  })
})

describe('真库实测补的两条（tests/real/real-library.spec.ts 跑出来的）', () => {
  it('验收 4 的真实形状：Editor/ 里 2 个 .cs + 2 个 .cs.meta → codeOnly', () => {
    /**
     * 修之前 .cs.meta 掉进 others，codeOnly 判不出来，这一个目录又会散成 4 张卡。
     * 断言用真库那四个文件名，不用我编的。
     */
    const s = splitContainer(
      files(
        'HeadAccessoryMover.cs',
        'HeadAccessoryMover.cs.meta',
        'SkinnedMeshMover.cs',
        'SkinnedMeshMover.cs.meta'
      )
    )
    expect(s.primary, '光有脚本不算主体').toBeNull()
    expect(s.codeOnly).toBe(true)
    expect(s.others, '.meta 不该掉进 others').toEqual([])
  })

  it('lilToon 那种带 package.json 的 shader 包，伴生文件也不算 others', () => {
    const s = splitContainer(files('Shaders/lil.shader', 'Editor/x.cs', 'package.json', 'README.md'))
    expect(s.primaryKind).toBe('assets_dir')
    expect(s.others).toEqual([])
  })
})

describe('验收 5：lilToon 目录 → 1 张卡 + 3 个附属', () => {
  it('Readme.html / Distribution.png / 【重要】…html 都是附属，主体是 shader', () => {
    const s = splitContainer(
      files(
        'Assets/lilToon/Shader/lilCommon.hlsl',
        'Assets/lilToon/Editor/lilInspector.cs',
        'Assets/lilToon/lilToon.shader',
        'Readme.html',
        'Distribution.png',
        '【重要】以前のバージョンをお使いの方へ.html',
        'package.json'
      )
    )
    expect(s.primaryKind).toBe('assets_dir')
    expect(s.primaryRoot).toBe('Assets')
    expect(paths(s)).toEqual(['Distribution.png', 'Readme.html', '【重要】以前のバージョンをお使いの方へ.html'])
    expect(kinds(s)).toEqual(['doc', 'doc', 'image'])
    // package.json 是伴生文件，跟着 .cs 一起算 code，不再算 others（见 .cs.meta 那一测）
    expect(s.others).toEqual([])
  })
})
