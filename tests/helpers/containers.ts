import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as tar from 'tar'

/**
 * 造"真形状"的压缩包 / .unitypackage 测试夹具。
 *
 * 为什么单独一个文件而不是各 spec 自己写两行：这个仓库已经吃过三次
 * "夹具造得不像真的 → 有 bug 的代码照样通过"（CHANGE-REPORT §7.1）。
 * 两处各写一套造包逻辑，迟早一套像真的、一套是假的。
 */

const BIN = path.resolve(process.cwd(), 'resources/bin')

/** 优先用仓库自带的 `7z.exe`（`7za.exe` 不含 RAR 解码器，而且不认 -sccUTF-8 / -bso1） */
export function find7z(binDir: string = BIN): string {
  const p = path.join(binDir, '7z.exe')
  if (fs.existsSync(p)) return p
  const alt = path.join(binDir, '7za.exe')
  if (fs.existsSync(alt)) return alt
  throw new Error(`没找到 7z：${binDir}（跑 node tools/fetch-7z.cjs 拉一下）`)
}

const guidOf = (i: number): string =>
  (i.toString(16).padStart(4, '0') + '0123456789abcdef0123456789abcdef').slice(0, 32)

/** 造包时第 i 个条目用的 GUID —— 断言里要引用它，别在 spec 里再抄一遍算法 */
export function packageGuidAt(i: number): string {
  return guidOf(i)
}

/**
 * 造一个**真的** .unitypackage（gzip + tar，条目全带 `./` 前缀）。
 *
 * ⚠ 必须 `tar.c(..., { prefix: './' })`。
 * 用 `tar.create(cwd, ['./x'])` 造不出这个形状：tar 会**同时**写一份不带前缀的
 * 规范化条目名兜底，于是有 bug 的解析器照样解析正确、用例假通过
 * —— 这个坑已经有主记录在 tests/classify/unitypackage.spec.ts 里。
 */
export async function buildRealUnitypackage(
  file: string,
  unityPaths: string[] = ['Assets/Shinano/Hair/Ponytail.prefab', 'Assets/Shinano/Toon.shader']
): Promise<string> {
  return buildPackageWithGuids(
    file,
    unityPaths.map((up, i) => ({ guid: guidOf(i), unityPath: up }))
  )
}

/** 要**指定 GUID** 的那一种（预扫描/冲突用例得知道包里到底是哪个 GUID） */
export async function buildPackageWithGuids(
  file: string,
  entries: Array<{ guid: string; unityPath: string }>
): Promise<string> {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const src = path.join(os.tmpdir(), `avca-upsrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(src, { recursive: true })
  entries.forEach((e) => {
    fs.mkdirSync(path.join(src, e.guid), { recursive: true })
    fs.writeFileSync(path.join(src, e.guid, 'pathname'), e.unityPath)
    fs.writeFileSync(path.join(src, e.guid, 'asset'), `%YAML 1.1\n--- !u!1 &2\n  m_Name: ${path.basename(e.unityPath)}\n`)
    fs.writeFileSync(path.join(src, e.guid, 'asset.meta'), 'fileFormatVersion: 2')
  })
  await tar.c({ gzip: true, cwd: src, file, prefix: './' }, fs.readdirSync(src))
  fs.rmSync(src, { recursive: true, force: true })
  return file
}

/** 造 zip / 7z。⚠ stdin 一定要关：加密档会让 7z 挂在交互提示上（项目备忘里的坑） */
export function makeZip(
  fromDir: string,
  file: string,
  entries: string[],
  binDir: string = BIN,
  extra: string[] = [],
  format = 'zip'
): string {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execFileSync(find7z(binDir), ['a', `-t${format}`, '-y', ...extra, file, ...entries], {
    cwd: fromDir,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return file
}

/** 相对路径统一成正斜杠，断言里少跟分隔符较劲 */
export function rel(...parts: string[]): string {
  return parts.join('/')
}
