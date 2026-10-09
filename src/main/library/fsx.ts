import fs from 'node:fs'
import path from 'node:path'
import { hashFile, hashSampled } from './hash'
import { isJunkSegment } from '../../shared/junk'

/**
 * 文件操作原语。全部"先记账再动手"由调用方（commit/undo）负责，
 * 这里只保证单步操作本身尽量安全：不覆盖已存在的目标、跨盘复制后校验。
 */

const HASH_VERIFY_THRESHOLD = 64 * 1024 * 1024

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true })
}

/** 同盘判断：Windows 看盘符，POSIX 看设备号 */
export function sameVolume(a: string, b: string): boolean {
  const da = path.parse(path.resolve(a)).root.toLowerCase()
  const db = path.parse(path.resolve(b)).root.toLowerCase()
  if (da && db) return da === db
  try {
    return fs.statSync(a).dev === fs.statSync(b).dev
  } catch {
    return false
  }
}

/** 目标已存在时自动加 (2)/(3)…，绝不覆盖用户已有文件 */
export async function uniquePath(p: string): Promise<string> {
  if (!(await pathExists(p))) return p
  const dir = path.dirname(p)
  const base = path.basename(p)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let n = 2; n < 1000; n++) {
    const cand = path.join(dir, `${stem} (${n})${ext}`)
    if (!(await pathExists(cand))) return cand
  }
  throw new Error('重名过多：' + p)
}

async function copyFileOnce(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest))
  await fs.promises.copyFile(src, dest)
}

/**
 * 跨盘复制后校验：小文件全量哈希，大文件抽样哈希。
 * 校验不过就删掉副本并报错，绝不留下"看着成功其实坏了"的文件。
 */
export async function copyFileVerified(src: string, dest: string): Promise<void> {
  await copyFileOnce(src, dest)
  const st = await fs.promises.stat(src)
  const dt = await fs.promises.stat(dest)
  if (st.size !== dt.size) {
    await fs.promises.rm(dest, { force: true })
    throw new Error(`复制后大小不符：${src} (${st.size}) → ${dest} (${dt.size})`)
  }
  if (st.size > HASH_VERIFY_THRESHOLD) {
    if ((await hashSampled(src)) !== (await hashSampled(dest))) {
      await fs.promises.rm(dest, { force: true })
      throw new Error('复制后指纹不符：' + dest)
    }
  } else if (st.size > 0) {
    if ((await hashFile(src)) !== (await hashFile(dest))) {
      await fs.promises.rm(dest, { force: true })
      throw new Error('复制后指纹不符：' + dest)
    }
  }
}

/**
 * 移动一个文件：同盘 rename（原子），跨盘 copy→校验→由调用方决定怎么处置源文件。
 * 返回实际用的手段，journal 要照着它写撤销逻辑。
 */
export async function moveFile(src: string, dest: string): Promise<'renamed' | 'copied'> {
  await ensureDir(path.dirname(dest))
  if (sameVolume(src, dest)) {
    try {
      await fs.promises.rename(src, dest)
      return 'renamed'
    } catch (e) {
      // 跨卷/权限/占用时 rename 会失败，退化成复制
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw e
    }
  }
  await copyFileVerified(src, dest)
  return 'copied'
}

export async function copyTree(srcDir: string, destDir: string): Promise<{ files: number; bytes: number }> {
  await ensureDir(destDir)
  let files = 0
  let bytes = 0
  const stack: Array<[string, string]> = [[srcDir, destDir]]
  while (stack.length) {
    const [s, d] = stack.pop() as [string, string]
    const list = await fs.promises.readdir(s, { withFileTypes: true })
    for (const e of list) {
      const sp = path.join(s, e.name)
      const dp = path.join(d, e.name)
      if (e.isDirectory()) {
        await ensureDir(dp)
        stack.push([sp, dp])
      } else if (e.isSymbolicLink()) {
        // 不跟进符号链接，也不复制它（素材库里 junction 很常见，跟进去会转圈）
        continue
      } else {
        await copyFileVerified(sp, dp)
        files++
        bytes += (await fs.promises.stat(dp)).size
      }
    }
  }
  return { files, bytes }
}

/** 移动整棵树：先尝试整目录 rename，失败再退化成逐文件复制 */
export async function moveTree(srcDir: string, destDir: string): Promise<'renamed' | 'copied'> {
  await ensureDir(path.dirname(destDir))
  if (sameVolume(srcDir, destDir)) {
    try {
      await fs.promises.rename(srcDir, destDir)
      return 'renamed'
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw e
    }
  }
  await copyTree(srcDir, destDir)
  return 'copied'
}

export async function dirSize(p: string): Promise<number> {
  let total = 0
  const stack = [p]
  while (stack.length) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = await fs.promises.readdir(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) stack.push(fp)
      else {
        try {
          total += (await fs.promises.stat(fp)).size
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  return total
}

/**
 * 递归列出目录里的文件（相对路径用 / 分隔），封顶防炸。
 *
 * **§A1 垃圾过滤（三处之三）**：`__MACOSX/`、`.DS_Store`、`Thumbs.db`、`~$x.docx` 这些
 * 既不进清单也不进分类语料 —— 垃圾目录整枝不下去（顺带省下 I/O）。
 * 这一处管的是"目录型素材"和"解压后的暂存目录"两条路，压缩包内层清单在 worker 里另过一遍。
 */
export async function listTree(
  dir: string,
  limit = 20000
): Promise<Array<{ relPath: string; size: number; ext: string; isDir: boolean }>> {
  const out: Array<{ relPath: string; size: number; ext: string; isDir: boolean }> = []
  const stack = [dir]
  while (stack.length && out.length < limit) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = await fs.promises.readdir(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (out.length >= limit) break
      if (isJunkSegment(e.name)) continue
      const fp = path.join(d, e.name)
      const rel = path.relative(dir, fp).replace(/\\/g, '/')
      if (e.isDirectory()) {
        out.push({ relPath: rel, size: 0, ext: '', isDir: true })
        stack.push(fp)
      } else if (e.isSymbolicLink()) {
        continue
      } else {
        let size = 0
        try {
          size = (await fs.promises.stat(fp)).size
        } catch {
          /* 忽略 */
        }
        out.push({ relPath: rel, size, ext: path.extname(e.name).toLowerCase(), isDir: false })
      }
    }
  }
  return out
}

/**
 * 把东西"移出"磁盘但不永久删除：挪到 %APPDATA%\A\backups\trash\<时间戳>\ 下。
 * worker 里用得了（shell.trashItem 只有主进程能调），而且天然可撤销。
 * 主进程会在方便的时候再把这里的内容送进真正的回收站。
 */
export async function moveToHold(holdDir: string, src: string): Promise<string> {
  await ensureDir(holdDir)
  const dest = await uniquePath(path.join(holdDir, path.basename(src)))
  const how = await moveTree(src, dest)
  if (how === 'copied') {
    await fs.promises.rm(src, { recursive: true, force: true })
  }
  return dest
}
