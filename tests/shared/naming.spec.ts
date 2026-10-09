import { describe, it, expect } from 'vitest'
import {
  cleanDisplayName,
  displayName,
  isMeaninglessName,
  pickMeaningfulName
} from '../../src/shared/naming'

describe('cleanDisplayName —— 第 1 份验收 #1', () => {
  it('剥掉 Booth 数字 id、双层扩展名，下划线换空格', () => {
    const r = cleanDisplayName('6117553 Shinano_FaceAnimation.rar.rar')
    expect(r.name).toBe('Shinano FaceAnimation')
    expect(r.version).toBeNull()
    expect(r.stripped).toContain('6117553')
  })

  it('日文/中文原名不许被动坏', () => {
    expect(displayName('束縛チャイナFULLSET.zip')).toBe('束縛チャイナFULLSET')
    expect(displayName('神楽坂雫 衣装セット.7z')).toBe('神楽坂雫 衣装セット')
  })

  it('版本号单独出来，不留在展示名里', () => {
    const r = cleanDisplayName('Grimoir_SHINANO_V1.0.zip')
    expect(r.name).toBe('Grimoir SHINANO')
    expect(r.version).toBe('1.0')

    const b = cleanDisplayName('ABT 1.3.0【汉化 闲鱼@月见汐音】')
    expect(b.name).toBe('ABT')
    expect(b.version).toBe('1.3.0')
    expect(b.notes).toEqual(['汉化 闲鱼@月见汐音'])
  })

  it('全角括号里的备注摘出来当分类线索', () => {
    const r = cleanDisplayName('Yoru_Avatar【Decal】.zip')
    expect(r.name).toBe('Yoru Avatar')
    expect(r.notes).toEqual(['Decal'])
  })

  it('没有点的纯数字不算版本号', () => {
    expect(cleanDisplayName('Shinano 76.png').version).toBeNull()
    expect(displayName('Shinano 76.png')).toBe('Shinano 76')
  })

  it('文件夹名（无扩展名）也能洗', () => {
    const r = cleanDisplayName('ABT 1.3.0【汉化 闲鱼@月见汐音】')
    expect(r.name).toBe('ABT')
    expect(r.stripped.length).toBeGreaterThan(0)
  })

  it('剥到空就退回原名，绝不给空字符串', () => {
    // 纯数字 + 扩展名：id 规则要求数字后面有分隔符，所以这里数字本身就是名字
    expect(cleanDisplayName('1234567.zip').name).toBe('1234567')
    // 只剩括号备注：全剥没了要退回原名
    expect(cleanDisplayName('【汉化】.zip').name).toBe('【汉化】.zip')
    expect(cleanDisplayName('').name).toBe('')
    expect(cleanDisplayName('   ').name).toBe('')
  })

  it('非容器扩展名不剥（.blend 是素材本体不是压缩包壳）', () => {
    // blend 不在剥除表里：展示名留 .blend 反而更好认
    expect(displayName('Scene_01.blend')).toBe('Scene 01.blend')
  })

  it('连续扩展名只剥认识的那些', () => {
    expect(displayName('6117553 pack.zip.rar')).toBe('pack')
    expect(displayName('data.tar.gz')).toBe('data')
    expect(displayName('thing.random')).toBe('thing.random')
  })

  it('unitypackage 后缀要剥（文件名里那串 GUID 由 M3 处理）', () => {
    expect(displayName('Grimoir_SHINANO_V1.0.unitypackage')).toBe('Grimoir SHINANO')
  })

  it('幂等：洗过的名字再洗一次不变', () => {
    const once = displayName('6117553 Shinano_FaceAnimation.rar.rar')
    expect(displayName(once)).toBe(once)
  })
})

describe('版本号边界（实测踩过的三个坑）', () => {
  it('版本号后面紧跟中日韩字也要认全：v2.7.0 不许被砍成 v2.7 剩个 ".0版本"', () => {
    const r = cleanDisplayName('佳兔工具箱v2.7.0版本.unitypackage')
    expect(r.version).toBe('2.7.0')
    expect(r.name).toBe('佳兔工具箱')
  })

  it('"v2.7.0版本" 里那个孤零零的"版本"跟着版本号一起走', () => {
    expect(cleanDisplayName('佳兔工具箱 v2.7 版本.zip').name).toBe('佳兔工具箱')
    expect(cleanDisplayName('tool v1.2 version.zip').name).toBe('tool')
  })

  it('三段版本号照常（SPS_V2.7.4）', () => {
    const r = cleanDisplayName('SPS_V2.7.4.zip')
    expect(r.version).toBe('2.7.4')
    expect(r.name).toBe('SPS')
  })

  it('不许把只有两段的名字改坏', () => {
    expect(cleanDisplayName('Grimoir_SHINANO_V1.0.zip').name).toBe('Grimoir SHINANO')
    expect(cleanDisplayName('ABT 1.3.0【汉化 闲鱼@月见汐音】').name).toBe('ABT')
    expect(displayName('6117553 Shinano_FaceAnimation.rar.rar')).toBe('Shinano FaceAnimation')
  })
})

describe('改动单 2 §A3/§A4：UUID 与无意义名', () => {
  it('UUID 不许被版本正则咬碎（验收 2）', () => {
    const r = cleanDisplayName('d6b99874-3687-4746-8eca-21c8050c74a0 base resized.jpg')
    expect(r.version, 'UUID 里没有版本号').toBeNull()
    expect(isMeaninglessName('d6b99874-3687-4746-8eca-21c8050c74a0')).toBe(true)
  })

  it('isMeaninglessName 逐条（§A3 清单）', () => {
    expect(isMeaninglessName('29d6e178-9672-4af7-b1e7-2909aaaa0001')).toBe(true)
    expect(isMeaninglessName('ab4fc71c65f415fba41234567890abcd')).toBe(true)
    expect(isMeaninglessName('image0')).toBe(true)
    expect(isMeaninglessName('img_12')).toBe(true)
    expect(isMeaninglessName('screenshot')).toBe(true)
    expect(isMeaninglessName('无标题')).toBe(true)
    expect(isMeaninglessName('6159895')).toBe(true)
    expect(isMeaninglessName('ab')).toBe(true)
    expect(isMeaninglessName('---')).toBe(true)
    // 有意义的名字不许误杀
    expect(isMeaninglessName('Kiss Sound Gimmick')).toBe(false)
    expect(isMeaninglessName('Libero')).toBe(false)
    expect(isMeaninglessName('6159895摇后会喷的酒')).toBe(false)
  })

  it('A3 取名优先级：无意义的名字要让位给父目录名', () => {
    expect(
      pickMeaningfulName([
        'image0',
        'd6b99874-3687-4746-8eca-21c8050c74a0',
        'Kiss_Sound_Gimmick_1.0',
        '6866030亲亲音效+亲吻时产生爱心粒子'
      ])
    ).toBe('Kiss Sound Gimmick')
    expect(pickMeaningfulName([null, '', 'image0'])).toBeNull()
  })

  it('剥括号备注时顺手提取 locale 与 author（裁定 7）', () => {
    const r = cleanDisplayName('ABT 1.3.0【汉化 闲鱼@月见汐音】')
    expect(r.version).toBe('1.3.0')
    expect(r.name).toBe('ABT')
    expect(r.localeTag).toBe('zh')
    expect(r.author).toBe('月见汐音')
  })

  it('版本号上下文约束：裸版本必须是末 token（§A4）', () => {
    expect(cleanDisplayName('SomeTool 2.5 notes everywhere.zip').version, '后面还有词，不算版本').toBeNull()
    expect(cleanDisplayName('SomeTool 2.5.zip').version).toBe('2.5')
    expect(cleanDisplayName('SomeTool v2.5 notes.zip').version, '带 v 前缀不受末位限制').toBe('2.5')
  })
})
