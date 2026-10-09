import { describe, it, expect } from 'vitest'
import {
  checkIngestPath,
  isForbiddenTarget,
  isForbiddenLibraryRoot,
  isInside,
  isPathTooLong,
  normalizeForCompare,
  safeJoin,
  sanitizePathList
} from '../../src/main/security/paths'

describe('normalizeForCompare', () => {
  it('去掉长前缀、统一分隔符、去尾部', () => {
    expect(normalizeForCompare('\\\\?\\E:\\vrc\\A\\')).toBe('e:\\vrc\\a')
    expect(normalizeForCompare('E:/vrc/A///')).toBe('e:\\vrc\\a')
    expect(normalizeForCompare('\\\\?\\UNC\\srv\\share\\x')).toBe('\\\\srv\\share\\x')
  })
})

describe('isInside 用分隔符边界比较', () => {
  it('E:\\AB 不算在 E:\\A 内', () => {
    expect(isInside('E:\\A', 'E:\\AB\\x.zip')).toBe(false)
    expect(isInside('E:\\A', 'E:\\A\\x.zip')).toBe(true)
    expect(isInside('E:\\A', 'E:\\A')).toBe(true)
    expect(isInside('E:\\A', 'D:\\A\\x.zip')).toBe(false)
  })
})

describe('危险位置判定', () => {
  it('系统目录被挡住', () => {
    expect(isForbiddenTarget('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe(true)
    expect(isForbiddenTarget('c:\\program files\\common\\x.dll')).toBe(true)
    expect(isForbiddenTarget('E:\\$RECYCLE.BIN\\S-1-5\\x.zip')).toBe(true)
    expect(isForbiddenTarget('D:\\System Volume Information\\x')).toBe(true)
  })

  it('用户目录不算危险：浏览器下载区是合法来料口', () => {
    expect(isForbiddenTarget('C:\\Users\\you\\Downloads\\Grimoir_SHINANO_V1.0.zip')).toBe(false)
    expect(isForbiddenTarget('E:\\vrc\\A\\衣服\\27\\Grimoir_SHINANO_V1.0.zip')).toBe(false)
  })

  it('盘符根不能当库根', () => {
    expect(isForbiddenLibraryRoot('E:\\')).toBe(true)
    expect(isForbiddenLibraryRoot('e:')).toBe(true)
    expect(isForbiddenLibraryRoot('E:\\vrc\\A_Library')).toBe(false)
  })
})

describe('safeJoin 挡 zip slip', () => {
  const dest = 'E:\\staging\\01J8\\payload'
  it('拒绝 .. 穿越与绝对路径', () => {
    expect(safeJoin(dest, '../../Windows/system32/evil.dll')).toBeNull()
    expect(safeJoin(dest, 'a/../../b.zip')).toBeNull()
    expect(safeJoin(dest, '/etc/passwd')).toBeNull()
    expect(safeJoin(dest, 'C:\\Users\\x\\a.txt')).toBeNull()
    expect(safeJoin(dest, '\\\\srv\\share\\x')).toBeNull()
    expect(safeJoin(dest, '')).toBeNull()
  })
  it('拒绝非法字符与控制字符', () => {
    expect(safeJoin(dest, 'a<b>c.txt')).toBeNull()
    expect(safeJoin(dest, 'we"ird.txt')).toBeNull()
    expect(safeJoin(dest, 'nul\x00.txt')).toBeNull()
  })
  it('正常条目名照常通过，并忽略 ./ 与重复斜杠', () => {
    const ok = safeJoin(dest, './Assets//Foo/Bar.prefab')
    expect(ok).toBe('E:\\staging\\01J8\\payload\\Assets\\Foo\\Bar.prefab')
    expect(ok?.startsWith(dest)).toBe(true)
  })
})

describe('checkIngestPath', () => {
  const ownDirs = ['C:\\Users\\x\\AppData\\Roaming\\A\\staging', 'C:\\Users\\x\\AppData\\Roaming\\A\\backups']
  it('拒绝相对路径与系统目录', () => {
    expect(checkIngestPath('相对\\路径.zip', { ownDirs }).ok).toBe(false)
    expect(checkIngestPath('C:\\Windows\\explorer.exe', { ownDirs }).ok).toBe(false)
  })
  it('拒绝自摄自己的 staging', () => {
    const r = checkIngestPath('C:\\Users\\x\\AppData\\Roaming\\A\\staging\\01J8\\a.zip', { ownDirs })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('自摄')
  })
  it('已在库内的不再重复摄取', () => {
    const r = checkIngestPath('E:\\vrc\\A_Library\\插件\\GoLoco\\a.unitypackage', {
      ownDirs,
      libraryRoot: 'E:\\vrc\\A_Library'
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('已在库内')
  })
  /**
   * 传了登记清单之后，"库根下面"不再是一刀切的拒绝理由 ——
   * 否则"收编已有库 / 重新登记游离文件"永远 0 条通过（游离文件按定义就在库根下）。
   */
  it('给了登记清单：库根下没登记过的目录要放行', () => {
    const r = checkIngestPath('E:\\vrc\\A_Library\\衣服\\27\\Grimoir_SHINANO_V1.0', {
      ownDirs,
      libraryRoot: 'E:\\vrc\\A_Library',
      registeredDirs: ['E:\\vrc\\A_Library\\插件\\GoLoco']
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
  })
  it('给了登记清单：已登记素材本身或它里面的东西仍然要拒', () => {
    const o = {
      ownDirs,
      libraryRoot: 'E:\\vrc\\A_Library',
      registeredDirs: ['E:\\vrc\\A_Library\\插件\\GoLoco']
    }
    expect(checkIngestPath('E:\\vrc\\A_Library\\插件\\GoLoco', o).ok).toBe(false)
    expect(checkIngestPath('E:\\vrc\\A_Library\\插件\\GoLoco\\a.unitypackage', o).ok).toBe(false)
    expect(checkIngestPath('e:\\vrc\\a_library\\插件\\goloco\\子\\x.zip', o).ok).toBe(false)
  })
  it('给了登记清单：会把已登记素材整吞进去的父目录要拒', () => {
    const r = checkIngestPath('E:\\vrc\\A_Library\\插件', {
      ownDirs,
      libraryRoot: 'E:\\vrc\\A_Library',
      registeredDirs: ['E:\\vrc\\A_Library\\插件\\GoLoco', 'E:\\vrc\\A_Library\\插件\\ABT']
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('err.containsRegistered')
    expect(r.params).toEqual({ path: 'E:\\vrc\\A_Library\\插件', count: 2 })
  })
  it('清单是空数组 = 库里一条都没有，库根下当然可以收编', () => {
    const r = checkIngestPath('E:\\vrc\\A_Library\\衣服\\某件', {
      ownDirs,
      libraryRoot: 'E:\\vrc\\A_Library',
      registeredDirs: []
    })
    expect(r.ok).toBe(true)
  })
  it('自己的 staging 就算清单为空也照样拒', () => {
    const r = checkIngestPath('C:\\Users\\x\\AppData\\Roaming\\A\\staging\\01J8\\a.zip', {
      ownDirs,
      libraryRoot: 'E:\\vrc\\A_Library',
      registeredDirs: []
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('自摄')
  })
  it('正常来料通过', () => {
    expect(checkIngestPath('E:\\vrc\\A\\衣服\\27\\Grimoir_AIRI_V1.0.zip', { ownDirs }).ok).toBe(true)
  })
})

describe('sanitizePathList（IPC 边界）', () => {
  it('非字符串与空串被剔除', () => {
    const r = sanitizePathList(['E:\\vrc\\A\\a.zip', 42, '', null, '   '], { ownDirs: [] })
    expect(r.accepted).toEqual(['E:\\vrc\\A\\a.zip'])
    expect(r.rejected).toHaveLength(4)
  })
  it('把混合分隔符规整成 Windows 规范路径', () => {
    const r = sanitizePathList(['E:/vrc/A//衣服\\27\\a.zip'], { ownDirs: [] })
    expect(r.accepted).toEqual(['E:\\vrc\\A\\衣服\\27\\a.zip'])
  })
})

describe('isPathTooLong', () => {
  it('超 240 预算要提示', () => {
    expect(isPathTooLong('E:\\vrc\\A\\' + '名'.repeat(250))).toBe(true)
    expect(isPathTooLong('E:\\vrc\\A\\插件\\动作类\\GoLoco v1.8.6\\a.unitypackage')).toBe(false)
  })
})
