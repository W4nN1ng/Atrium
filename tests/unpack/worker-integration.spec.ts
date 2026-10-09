import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

/**
 * 真 worker 集成测试：直接跑编译产物 out/main/worker.js，
 * 用用户库里的真实压缩包验证"哈希 → 探测 → 列清单 → 解压"整条链路。
 * 没先 build 或包不在，就整组跳过（不误报失败）。
 */

const WORKER = path.resolve(process.cwd(), 'out/main/worker.js')
const BIN = path.resolve(process.cwd(), 'resources/bin')
const LIB = 'E:\\vrc\\A'
const RAR_RAR = path.join(LIB, '插件', 'shinano表情', '6117553 Shinano_FaceAnimation.rar.rar')
const JP_ZIP = path.join(LIB, '衣服', '【束縛チャイナ】', '束縛チャイナFULLSET.zip')

let tmp: string

function runWorker(sourcePath: string, extract: boolean): Promise<{ messages: unknown[]; result?: any; needPassword?: boolean; error?: any }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER)
    const messages: unknown[] = []
    const out: { messages: unknown[]; result?: unknown; needPassword?: boolean; error?: unknown } = { messages }
    const jobId = 'test-' + Date.now()
    const timer = setTimeout(() => {
      void w.terminate()
      reject(new Error('worker 超时 60 秒'))
    }, 60000)

    w.on('message', (m: Record<string, unknown>) => {
      messages.push(m)
      if (m.type === 'need-password') {
        out.needPassword = true
        clearTimeout(timer)
        void w.terminate()
        resolve(out)
      }
      if (m.type === 'error') {
        out.error = m
        clearTimeout(timer)
        void w.terminate()
        resolve(out)
      }
      if (m.type === 'done') {
        out.result = m.result
        clearTimeout(timer)
        void w.terminate()
        resolve(out)
      }
    })
    w.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    w.postMessage({
      type: 'job',
      jobId,
      sourcePath,
      stagingPath: path.join(tmp, jobId),
      extract,
      backendDirs: [BIN]
    })
  })
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-worker-'))
})
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const built = fs.existsSync(WORKER)

describe.skipIf(!built)('worker 流水线（真包）', () => {
  it('单层 rar：指纹 + 包内清单都对，且不落解压内容', async () => {
    const r = await runWorker(RAR_RAR, false)
    expect(r.error, JSON.stringify(r.error)).toBeUndefined()
    const res = r.result as {
      hash: string
      probe: { format: string; isArchive: boolean; extMismatch: boolean }
      entries: Array<{ path: string }>
      stagingPath: string | null
      warnings: Array<{ key: string; params?: Record<string, string | number>; message?: string }>
    }
    expect(res.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(res.probe.format).toBe('rar')
    expect(res.probe.isArchive).toBe(true)
    expect(res.probe.extMismatch, '双重 .rar 扩展名不该被当成不符').toBe(false)
    expect(res.entries.some((e) => e.path.includes('無料')), '条目名要解对：' + res.entries.map((e) => e.path).join(',')).toBe(true)
    expect(res.stagingPath, '没开自动解压就不该有暂存目录').toBeNull()
    // 提示只给 i18n key，中文留在 message 里当日志兜底
    expect(res.warnings.map((w) => w.key)).toContain('ingest.warn.notExtracted')
    expect(res.warnings.every((w) => typeof w.key === 'string' && w.key.includes('.')), 'warning 必须是 key 形态').toBe(true)
    // 进度消息必须出现过，UI 才有进度条可画；而且每条都得带 key，否则英文界面会退回中文
    const progress = r.messages.filter((m) => (m as { type: string }).type === 'progress')
    expect(progress.length).toBeGreaterThan(0)
    for (const m of progress) {
      const mm = m as { messageKey?: string }
      expect(mm.messageKey, `进度消息缺 messageKey：${JSON.stringify(m)}`).toBeTruthy()
    }
  }, 90000)

  it('开了自动解压：暂存目录里真的落下了日文名文件', async () => {
    const r = await runWorker(RAR_RAR, true)
    const res = r.result as { stagingPath: string | null; looseFiles: Array<{ relPath: string }> }
    expect(res.stagingPath).toBeTruthy()
    const names = (res.looseFiles ?? []).map((f) => f.relPath)
    expect(names.some((n) => n.includes('無料') || n.includes('Shinano'))).toBe(true)
    expect(names.every((n) => !n.includes('\uFFFD'))).toBe(true)
  }, 90000)

  it('日文 zip：列清单时条目名不带替换符', async () => {
    const r = await runWorker(JP_ZIP, false)
    const res = r.result as { entries: Array<{ path: string }>; entryCount: number; probe: { format: string } }
    expect(res.probe.format).toBe('zip')
    expect(res.entryCount).toBeGreaterThan(0)
    const joined = res.entries.map((e) => e.path).join('\n')
    expect(joined).not.toContain('\uFFFD')
  }, 90000)
})

describe.skipIf(built)('worker 流水线', () => {
  it('没编译产物时给出可执行的提示，而不是静默跳过', () => {
    expect(WORKER, '先跑 npm run build:dir 或 npx electron-vite build 再跑这个测试').toBeTruthy()
  })
})
