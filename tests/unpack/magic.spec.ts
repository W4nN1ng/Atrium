import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSplitSiblings, probeBuffer, probeFile } from '../../src/main/unpack/magic'

let dir: string

const sig = {
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
  rar4: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0, 0, 0]),
  rar5: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0, 0]),
  sevenz: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]),
  gzip: Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0]),
  bzip2: Buffer.from([0x42, 0x5a, 0x68, 0x39]),
  xz: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e])
}

function tarBuffer(): Buffer {
  const b = Buffer.alloc(1024, 0)
  b.write('somefile.txt', 0, 'latin1')
  b.write('0000644', 100, 'latin1')
  b.write('ustar\x0000', 257, 'latin1')
  return b
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-magic-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('probeBuffer 认文件头', () => {
  it('rar4 / rar5 分得开', () => {
    expect(probeBuffer(sig.rar4).format).toBe('rar')
    expect(probeBuffer(sig.rar4).subtype).toBe('rar4')
    expect(probeBuffer(sig.rar5).subtype).toBe('rar5')
    expect(probeBuffer(sig.rar5).isArchive).toBe(true)
  })

  it('zip / 7z / gzip / bzip2 / xz / tar 各自命中', () => {
    expect(probeBuffer(sig.zip).format).toBe('zip')
    expect(probeBuffer(sig.sevenz).format).toBe('sevenz')
    expect(probeBuffer(sig.gzip).format).toBe('gzip')
    expect(probeBuffer(sig.bzip2).format).toBe('bzip2')
    expect(probeBuffer(sig.xz).format).toBe('xz')
    // tar 的 magic 在偏移 257，不在开头
    expect(probeBuffer(tarBuffer()).format).toBe('tar')
  })

  it('.unitypackage 报成 gzip + 具体 subtype（它是 gzip 套 tar）', () => {
    const r = probeBuffer(sig.gzip, 'GoLoco.unitypackage')
    expect(r.format).toBe('gzip')
    expect(r.subtype).toBe('unitypackage-gzip')
    expect(r.isArchive).toBe(true)
  })

  it('图片 / pdf / 可执行 / 快捷方式 / blend / unity yaml', () => {
    expect(probeBuffer(sig.png).format).toBe('png')
    expect(probeBuffer(sig.jpeg).format).toBe('jpeg')
    expect(probeBuffer(sig.pdf).format).toBe('pdf')
    expect(probeBuffer(Buffer.from([0x4d, 0x5a, 0x90, 0])).format).toBe('exe')
    expect(probeBuffer(Buffer.from([0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])).format).toBe('lnk')
    expect(probeBuffer(Buffer.from('BLENDER-v300', 'latin1'))).toMatchObject({ format: 'blend' })
    expect(probeBuffer(Buffer.from('--- !u!1 &123456', 'latin1'))).toMatchObject({ format: 'unity-asset' })
  })

  it('.url 是 Windows Internet Shortcut，不当成压缩包', () => {
    const buf = Buffer.from('[InternetShortcut]\r\nURL=https://booth.pm/ja/items/3087170\r\n', 'latin1')
    const r = probeBuffer(buf, 'lilToon - BOOTH.url')
    expect(r.format).toBe('ini')
    expect(r.subtype).toBe('internet-shortcut')
    expect(r.isArchive).toBe(false)
  })

  it('空文件与未知字节不抛异常', () => {
    expect(probeBuffer(Buffer.alloc(0)).format).toBe('unknown')
    expect(probeBuffer(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).isArchive).toBe(false)
  })
})

describe('扩展名说谎时能抓出来', () => {
  it('内容是 zip 却叫 .rar → extMismatch', () => {
    const r = probeBuffer(sig.zip, '假的.rar')
    expect(r.format).toBe('zip')
    expect(r.extMismatch).toBe(true)
  })

  it('内容是 rar 叫 .rar.rar → 不算不符（真实验收件）', () => {
    const r = probeBuffer(sig.rar5, '6117553 Shinano_FaceAnimation.rar.rar')
    expect(r.format).toBe('rar')
    expect(r.extMismatch).toBe(false)
    expect(r.splitVolume).toBe(false) // 双重扩展名 ≠ 分卷，必须识别成"单层 rar"
  })

  it('真分卷才标 splitVolume', () => {
    expect(probeBuffer(sig.rar5, 'big.part1.rar').splitVolume).toBe(true)
    expect(probeBuffer(sig.rar5, 'big.r00').splitVolume).toBe(true)
    expect(probeBuffer(sig.zip, 'big.z01').splitVolume).toBe(true)
  })
})

describe('probeFile 读真实文件', () => {
  it('写一个 .rar.rar 出来，判定为单层 rar5', async () => {
    const p = path.join(dir, '6117553 Shinano_FaceAnimation.rar.rar')
    fs.writeFileSync(p, Buffer.concat([sig.rar5, Buffer.alloc(600, 7)]))
    const r = await probeFile(p)
    expect(r.format).toBe('rar')
    expect(r.subtype).toBe('rar5')
    expect(r.extMismatch).toBe(false)
    expect(r.splitVolume).toBe(false)
  })

  it('文件不存在时返回 unknown 而不是抛', async () => {
    const r = await probeFile(path.join(dir, '不存在.zip'))
    expect(r.format).toBe('unknown')
    expect(r.label.length).toBeGreaterThan(0)
  })
})

describe('findSplitSiblings', () => {
  it('把同组的分卷找齐并挑出首卷', () => {
    const d = fs.mkdtempSync(path.join(dir, 'split-'))
    fs.writeFileSync(path.join(d, 'game.part1.rar'), sig.rar5)
    fs.writeFileSync(path.join(d, 'game.part2.rar'), Buffer.alloc(8))
    const group = findSplitSiblings(path.join(d, 'game.part2.rar'))
    expect(group).toHaveLength(1)
    expect(path.basename(group[0])).toBe('game.part1.rar')
  })

  it('普通文件返回自己', () => {
    const p = path.join(dir, 'single.zip')
    fs.writeFileSync(p, sig.zip)
    expect(findSplitSiblings(p)).toEqual([p])
  })
})
