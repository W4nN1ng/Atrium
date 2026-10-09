import { describe, it, expect } from 'vitest'
import { parseIngestArgs } from '../../src/main/ingest/args'

describe('parseIngestArgs', () => {
  it('扛得住 Electron 往 argv 里插自己的开关（真机实测到的形状）', () => {
    const argv = [
      'C:\\程序\\A素材管家\\node_modules\\electron\\dist\\electron.exe',
      '--ingest',
      '--allow-file-access-from-files',
      '.',
      'C:\\Windows\\notepad.exe'
    ]
    expect(parseIngestArgs(argv)).toEqual(['C:\\Windows\\notepad.exe'])
  })

  it('摄取目标本身是 exe 时不能被"跳过程序自身"的规则误伤', () => {
    const argv = ['C:\\A\\A.exe', '--ingest', 'E:\\vrc\\A\\工具软件\\Updater.exe']
    expect(parseIngestArgs(argv)).toEqual(['E:\\vrc\\A\\工具软件\\Updater.exe'])
    // 但自身路径不能被收进来
    expect(parseIngestArgs(['C:\\A\\A.exe', '--ingest', 'C:\\a\\a.exe'])).toEqual([])
  })

  it('支持多个路径与 --ingest= 写法', () => {
    expect(
      parseIngestArgs(['A.exe', '--ingest', 'E:\\vrc\\A\\衣服\\27\\Grimoir_AIRI_V1.0.zip', 'E:\\a\\b.rar'])
    ).toEqual(['E:\\vrc\\A\\衣服\\27\\Grimoir_AIRI_V1.0.zip', 'E:\\a\\b.rar'])
    expect(parseIngestArgs(['A.exe', '--ingest=E:\\a\\b.zip'])).toEqual(['E:\\a\\b.zip'])
  })

  it('重复出现 --ingest 时不会漏，也不会重复', () => {
    const r = parseIngestArgs(['A.exe', '--ingest', 'E:\\a.zip', '--ingest', 'E:\\a.zip', 'E:\\b.zip'])
    expect(r).toEqual(['E:\\a.zip', 'E:\\b.zip'])
  })

  it('不带 --ingest 时，把裸绝对路径收进来（拖到 exe 图标上 / 右键打开方式）', () => {
    expect(parseIngestArgs(['A.exe', 'E:\\vrc\\A\\插件\\x.rar'])).toEqual(['E:\\vrc\\A\\插件\\x.rar'])
    expect(parseIngestArgs(['A.exe', '\\\\srv\\share\\x.zip'])).toEqual(['\\\\srv\\share\\x.zip'])
  })

  it('绝不把 exe 自己、点号、开关当成素材', () => {
    expect(parseIngestArgs(['C:\\A\\A.exe', '.', '..', '--flag'])).toEqual([])
    expect(parseIngestArgs([])).toEqual([])
    expect(parseIngestArgs(['A.exe'])).toEqual([])
  })

  it('相对路径不算素材（主进程那边还会再校验一次绝对性）', () => {
    expect(parseIngestArgs(['A.exe', 'relative\\x.zip'])).toEqual([])
  })
})
