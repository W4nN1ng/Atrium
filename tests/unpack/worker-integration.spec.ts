import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'
import { buildRealUnitypackage, makeZip } from '../helpers/containers'
import type { WorkerResult } from '../../src/main/ingest/worker'

const ROOT = process.cwd()
const BIN = path.join(ROOT, 'resources/bin')
let tmp: string
let workerFile: string
let direct: string
let nested: string
let japanese: string

/** Build the current source, independently of stale out/ and private real-world packages. */
beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-worker-fixtures-'))
  await build({
    configFile: false, logLevel: 'silent',
    build: {
      target: 'node20', outDir: path.join(tmp, 'compiled'), emptyOutDir: false, minify: false,
      lib: { entry: path.join(ROOT, 'src/main/ingest/worker.ts'), formats: ['cjs'], fileName: () => 'worker.cjs' },
      rollupOptions: { external: id => id.startsWith('node:') || builtinModules.includes(id) || id === 'electron' }
    }
  })
  workerFile = path.join(tmp, 'compiled/worker.cjs')
  direct = await buildRealUnitypackage(path.join(tmp, '123456.unitypackage'), ['Assets/Shinano/服装/套装/Dress.prefab'])
  const files = path.join(tmp, 'files')
  fs.mkdirSync(path.join(files, 'nested'), { recursive: true })
  fs.copyFileSync(direct, path.join(files, 'nested/123456.unitypackage'))
  fs.writeFileSync(path.join(files, '無料_日本語.txt'), 'Japanese filename fixture')
  nested = makeZip(files, path.join(tmp, '123456.zip'), ['nested'])
  japanese = makeZip(files, path.join(tmp, 'japanese.zip'), ['無料_日本語.txt'])
})

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
})

async function runWorker(sourcePath: string, extract: boolean, settings: object = {}): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile)
    const jobId = `fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Worker timed out')) }, 30000)
    worker.on('error', error => { clearTimeout(timer); void worker.terminate(); reject(error) })
    worker.on('message', async message => {
      if (!['done', 'error', 'need-password'].includes(message.type)) return
      clearTimeout(timer)
      await worker.terminate()
      if (message.type === 'done') resolve(message.result)
      else reject(new Error(message.message ?? message.type))
    })
    worker.postMessage({
      type: 'job', jobId, sourcePath, stagingPath: path.join(tmp, jobId), extract,
      backendDirs: [BIN], resourceRoot: path.join(ROOT, 'resources'), learning: [], ...settings
    })
  })
}

describe('worker pipeline with generated packages', () => {
  it('passes the confirmation threshold through the real worker', async () => {
    const strict = await runWorker(direct, false, { confidenceConfirm: 1 })
    const relaxed = await runWorker(direct, false, { confidenceConfirm: 0.1 })
    expect(strict.classification?.units[0].status).toBe('pending_confirm')
    expect(relaxed.classification?.units[0].status).toBe('archived')
  })
  it('reports corrupt direct packages without changing the source file', async () => {
    const corrupt = path.join(tmp, 'broken.unitypackage')
    const bytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00])
    fs.writeFileSync(corrupt, bytes)
    await expect(runWorker(corrupt, false)).rejects.toThrow()
    expect(fs.readFileSync(corrupt)).toEqual(bytes)
  })
  it('reads a Japanese ZIP listing without extracting it', async () => {
    const result = await runWorker(japanese, false)
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(result.probe.format).toBe('zip')
    expect(result.entries.some(e => e.path === '無料_日本語.txt')).toBe(true)
    expect(result.stagingPath).toBeNull()
    expect(result.warnings.map(w => w.key)).toContain('ingest.warn.notExtracted')
  })
  it('extracts Japanese names when requested', async () => {
    const result = await runWorker(japanese, true)
    expect(result.stagingPath).toBeTruthy()
    expect(fs.readFileSync(path.join(result.stagingPath!, '無料_日本語.txt'), 'utf8')).toBe('Japanese filename fixture')
    expect(result.looseFiles.some(e => e.relPath === '無料_日本語.txt')).toBe(true)
  })
  it('classifies direct unitypackage content like the identical package nested in ZIP', async () => {
    const before = fs.readFileSync(direct)
    const a = await runWorker(direct, false)
    const b = await runWorker(nested, false)
    expect(b.classification?.units[0].category).toBe('clothing')
    expect(a.classification?.units[0].category).toBe(b.classification?.units[0].category)
    expect(a.classification?.units[0].targetAvatars).toContain('Shinano')
    expect(a.classification?.units[0].filePaths).toContain('Assets/Shinano/服装/套装/Dress.prefab')
    expect(fs.readFileSync(direct)).toEqual(before)
    expect(a.stagingPath).toBeNull()
  })
  it('keeps a direct unitypackage intact even when automatic extraction is enabled', async () => {
    const result = await runWorker(direct, true)
    expect(result.classification?.units[0].category).toBe('clothing')
    expect(result.stagingPath).toBeNull()
    expect(fs.existsSync(direct)).toBe(true)
  })
})

const realRoot = process.env.AVCA_REAL_LIB
const realRar = realRoot ? path.join(realRoot, '插件/shinano表情/6117553 Shinano_FaceAnimation.rar.rar') : null
it.skipIf(!realRar || !fs.existsSync(realRar))('optional real RAR fixture from AVCA_REAL_LIB', async () => {
  const result = await runWorker(realRar!, false)
  expect(result.probe.format).toBe('rar')
  expect(result.entries.length).toBeGreaterThan(0)
})
