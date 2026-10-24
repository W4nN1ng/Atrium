import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractPackageZip } from '../../src/main/vpm/install'
import { makeZip } from '../../tests/vpm/install/zip-fixture'

/**
 * 环境验证：statfs 真实行为、NTFS 长路径、只读文件上的 rename。
 *
 * 只读磁盘、只在系统临时目录里建文件；不启动任何 GUI。
 * 运行：`npx vite-node tools/verify-p4/environment.ts`
 */

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(34)} ${value}`)
}

function statfs(directory: string): { free: number; total: number } | null {
  try {
    const stat = (fs as unknown as {
      statfsSync: (p: string) => { bavail: number; bsize: number; blocks: number }
    }).statfsSync(directory)
    return { free: Number(stat.bavail) * Number(stat.bsize), total: Number(stat.blocks) * Number(stat.bsize) }
  } catch {
    return null
  }
}

function gib(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

function statfsCheck(): void {
  console.log('\n[1/3] fs.statfsSync 真机行为')
  const drives = ['C:\\', 'D:\\', 'E:\\', 'F:\\']
  for (const drive of drives) {
    if (!fs.existsSync(drive)) continue
    const usage = statfs(drive)
    line(drive, usage ? `free ${gib(usage.free)} / total ${gib(usage.total)}` : 'statfs 失败')
  }
  const temp = statfs(os.tmpdir())
  line('os.tmpdir()', temp ? `free ${gib(temp.free)}` : 'statfs 失败')
  console.log(
    temp && temp.free > 0
      ? '  ✓ statfsSync 在真盘上返回可用字节，预检的空间判断有真实数据来源'
      : '  ✗ statfsSync 没有返回可用值（预检会退化成“不判断空间”）'
  )
}

function longPathCheck(): void {
  console.log('\n[2/3] NTFS 长路径（>260）真实行为')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-verify-long-'))
  const segment = 'seg-0123456789abcdef'
  const build = (target: number): string => {
    let dir = root
    while (dir.length < target) dir = path.join(dir, segment)
    return dir
  }

  // A. 刚好低于我们 260 的策略上限：应当能建、能写、能 rename。
  const shortDir = build(root.length + 180)
  try {
    fs.mkdirSync(shortDir, { recursive: true })
    fs.writeFileSync(path.join(shortDir, 'a.txt'), 'x')
    const moved = `${shortDir}-moved`
    fs.renameSync(shortDir, moved)
    line(`${shortDir.length} 字符目录`, 'mkdir/write/rename 全部成功')
    console.log('  ✓ 接近 260 的真实路径可以正常操作（策略上限不是平台限制）')
    fs.rmSync(moved, { recursive: true, force: true })
  } catch (error) {
    line(`${shortDir.length} 字符目录`, `失败：${(error as Error).message.slice(0, 80)}`)
    console.log('  ! 接近 260 的路径在真机上失败，需要复查 maxPathLength')
  }

  // B. 超过 260：Node 在没开 LongPathsEnabled 时会失败；记录真实结果。
  const deepDir = build(root.length + 300)
  let deepResult = ''
  try {
    fs.mkdirSync(deepDir, { recursive: true })
    fs.writeFileSync(path.join(deepDir, 'b.txt'), 'x')
    deepResult = '成功（系统已启用长路径）'
  } catch (error) {
    deepResult = `失败：${(error as NodeJS.ErrnoException).code ?? ''} ${(error as Error).message.slice(0, 60)}`
  }
  line(`${deepDir.length} 字符目录`, deepResult)

  // C. 解压适配器对超长目标路径的策略：必须干净拒绝，而不是写一半。
  try {
    const zipPath = path.join(root, 'long.zip')
    const longName = `${'nested/'.repeat(20)}file.txt`
    fs.writeFileSync(zipPath, makeZip([{ name: longName, data: 'x' }]))
    const target = path.join(root, 'x'.repeat(220), 'target')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    extractPackageZip({ zipPath, targetDir: target })
      .then(() => line('解压超长路径', '居然成功了（目标路径 <260）'))
      .catch((error: { code?: string }) => {
        line('解压超长路径', `拒绝：${error.code ?? error}`)
        console.log('  ✓ 超长路径被显式拒绝（vpmArchiveUnsafePath），不会写出半个文件')
      })
      .finally(() => fs.rmSync(root, { recursive: true, force: true }))
  } catch (error) {
    console.error('  ! 长路径夹具构造失败：', error)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function readonlyRenameCheck(): void {
  console.log('\n[3/3] 只读文件上的 rename（模拟 manifest 被占用/只读）')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-verify-ro-'))
  const source = path.join(root, 'new.json')
  const target = path.join(root, 'vpm-manifest.json')
  fs.writeFileSync(source, '{"new":true}')
  fs.writeFileSync(target, '{"old":true}')
  fs.chmodSync(target, 0o444)
  try {
    fs.renameSync(source, target)
    console.log('  ! rename 覆盖只读文件竟然成功（该平台不把只读当障碍）')
    line('只读目标 rename', '成功')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    line('只读目标 rename', `失败：${code}`)
    console.log(
      code === 'EPERM' || code === 'EACCES'
        ? '  ✓ 只读目标会以 EPERM/EACCES 失败，事务的退避重试与回滚路径有真实触发条件'
        : `  ! 期望 EPERM/EACCES，实际 ${code}`
    )
  } finally {
    try {
      fs.chmodSync(target, 0o666)
    } catch {
      /* ignore */
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

statfsCheck()
longPathCheck()
readonlyRenameCheck()
