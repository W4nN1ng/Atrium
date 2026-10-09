import { describe, it, expect } from 'vitest'
import type { FileEntry } from '../../src/shared/types'
import {
  applyHardRules,
  isUnityProject,
  isUpmPackage,
  looksLikePhysicsPlugin,
  looksLikeHairModel,
  looksLikeMaterialPack
} from '../../src/main/fingerprint/hardRules'

/** 造清单：'a/b.png 123' → FileEntry */
function f(...specs: string[]): FileEntry[] {
  return specs.map((s) => {
    const [relPath, sizeRaw] = s.split(' ')
    const isDir = relPath.endsWith('/') || sizeRaw === 'd'
    const ext = isDir ? '' : (relPath.split('.').pop() ?? '').toLowerCase()
    return { relPath: relPath.replace(/\/$/, ''), size: isDir ? 0 : Number(sizeRaw ?? 1) || 1, ext, isDir }
  })
}

describe('§1.1 硬规则表', () => {
  it('Assets/ + ProjectVersion.txt = 完整 Unity 工程', () => {
    const files = f('Assets/Main.unity 10', 'Assets/', 'ProjectSettings/ProjectVersion.txt 5')
    expect(isUnityProject(files)).toBe(true)
    const r = applyHardRules(files)
    expect(r.contentType).toBe('unity_project')
    expect(r.confidence).toBe(0.95)
  })

  it('package.json + Editor/*.cs = Unity 插件包，一级=插件，二级留给词典', () => {
    const files = f('package.json 10', 'Editor/Tools.cs 20')
    expect(isUpmPackage(files)).toBe(true)
    const r = applyHardRules(files)
    expect(r.contentType).toBe('unity_upm_package')
    expect(r.category).toBe('plugin')
    expect(r.subDecided).toBe(false)
  })

  it('只有 .asmdef 没有 Editor 脚本也算 UPM 包', () => {
    expect(isUpmPackage(f('package.json 1', 'Runtime/My.asmdef 2'))).toBe(true)
  })

  it('含 .shader 直接判着色器，并带上数量证据', () => {
    const r = applyHardRules(f('A/x.shader 1', 'A/y.cginc 2', 'A/t.png 3'))
    expect(r.category).toBe('shader')
    expect(r.count).toBe(2)
    expect(r.rule).toContain('2 个着色器文件')
  })

  it('.anim/.controller 且没有模型 = 动画', () => {
    expect(applyHardRules(f('a.anim 1', 'Idle.controller 2')).category).toBe('animation')
    // 有 fbx 时不抢模型的判据
    expect(applyHardRules(f('a.anim 1', 'Body.fbx 2')).contentType).toBe('model')
  })

  it('FBX + prefab + mat + 贴图 = 模型类，但一级留给关键词', () => {
    const r = applyHardRules(f('Body.fbx 100', 'Body.prefab 10', 'M.mat 5', 'T.png 5'))
    expect(r.contentType).toBe('model')
    expect(r.category).toBeNull()
  })

  it('一半以上是音频 = 音频', () => {
    expect(applyHardRules(f('a.wav 1', 'b.mp3 2', 'c.ogg 3', 'd.png 4')).category).toBe('audio')
  })

  it('只有图片 = 贴图', () => {
    expect(applyHardRules(f('a.png 1', 'b.psd 2', 'c.tga 3')).category).toBe('texture')
  })

  it('含 exe/msi = 工具软件', () => {
    expect(applyHardRules(f('setup.exe 1', 'readme.txt 2')).category).toBe('tool')
  })

  it('文档占一半以上 = 参考资料', () => {
    expect(applyHardRules(f('a.pdf 1', 'b.html 2', 'c.txt 3')).category).toBe('reference')
  })

  it('里面是 .unitypackage 时不当结论，交回递归解析（表格第 4 行）', () => {
    const r = applyHardRules(f('PCS.unitypackage 100'))
    expect(r.confidence).toBe(0)
    expect(r.rule).toContain('需递归解析')
  })

  it('空清单不命中，也不炸', () => {
    expect(applyHardRules([]).confidence).toBe(0)
  })
})

describe('§1.1 四条启发式', () => {
  it('Editor/ + .cs 是强插件信号', () => {
    expect(applyHardRules(f('package.json 1', 'Editor/A.cs 2', 'Editor/B.cs 3')).category).toBe('plugin')
  })

  it('DynamicBone / PhysBone / MagicaCloth 字样 → 物理类插件信号', () => {
    expect(looksLikePhysicsPlugin(f('Prefab/DynamicBoneSetup.prefab 1'))).toBe(true)
    expect(looksLikePhysicsPlugin(f('Scripts/MagicaClothHelper.cs 1'))).toBe(true)
    expect(looksLikePhysicsPlugin(f('Normal.fbx 1'))).toBe(false)
  })

  it('FBX 且名字含 Hair/髪/ヘア → 头发', () => {
    expect(looksLikeHairModel(f('LongHair.fbx 1'))).toBe(true)
    expect(looksLikeHairModel(f('髪型A.fbx 1'))).toBe(true)
    expect(applyHardRules(f('LongHair.fbx 1', 'Hair.mat 2', 'T.tga 3')).category).toBe('hair')
  })

  it('.mat 超过 20 且无 FBX → 材质包', () => {
    const many = Array.from({ length: 25 }, (_, i) => `m${i}.mat 1`)
    expect(looksLikeMaterialPack(f(...many))).toBe(true)
    expect(looksLikeMaterialPack(f(...many, 'body.fbx 9'))).toBe(false)
    expect(applyHardRules(f(...many)).category).toBe('material')
  })
})
