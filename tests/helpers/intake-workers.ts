import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { builtinModules } from 'node:module'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'
import Database from 'better-sqlite3'
import yazl from 'yazl'
import { migrate } from '../../src/main/db'
import { persistIntakePlan, readLibraryBlobIndex } from '../../src/main/db/repos/intakePlan'
import { ExpandCache } from '../../src/main/intake/expandCache'
import type { PreparedIntakePlan } from '../../src/shared/intake'
import type { ExecutionResult } from '../../src/main/intake/executor'

export const resources = path.resolve('resources')
export const categories = JSON.parse(fs.readFileSync(path.join(resources, 'lexicon/categories.json'), 'utf8'))
export const opsOf = (plan: PreparedIntakePlan) => plan.units.flatMap(u => [...u.copyOps, ...u.sidecars])
export const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
export const redigest = (plan: PreparedIntakePlan) => { plan.id = ''; plan.id = 'plan-' + createHash('sha256').update(JSON.stringify(plan)).digest('hex'); return plan }

/** Compile the current production entries, never the installed app or potentially stale out/. */
export async function compileIntakeWorkers(root: string): Promise<Record<'plan' | 'execute' | 'health' | 'fault', string>> {
  const dir = path.join(root, 'compiled')
  await build({ configFile: false, logLevel: 'silent', build: {
    target: 'node20', outDir: dir, emptyOutDir: false, minify: false,
    lib: { entry: { plan: path.resolve('src/main/ingest/worker.ts'), execute: path.resolve('src/main/intake/worker.ts'), health: path.resolve('src/main/library/healthWorker.ts'), fault: path.resolve('tests/helpers/intake-fault-worker.ts') }, formats: ['cjs'], fileName: (_format, entry) => entry + '.cjs' },
    rollupOptions: { external: id => id.startsWith('node:') || builtinModules.includes(id) || ['electron', 'better-sqlite3'].includes(id),
      output: { paths: { 'better-sqlite3': path.resolve('node_modules/better-sqlite3/lib/index.js').replace(/\\/g, '/') } } }
  } })
  return Object.fromEntries(['plan', 'execute', 'health', 'fault'].map(name => [name, path.join(dir, name + '.cjs')])) as Record<'plan' | 'execute' | 'health' | 'fault', string>
}

export interface WorkerRequestOptions { timeout?: number; onMessage?: (message: any, worker: Worker) => void }
export async function requestWorker<T>(entry: string, job: object, terminal: string[], opts: WorkerRequestOptions = {}): Promise<T> {
  const worker = new Worker(entry)
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('intake e2e worker timeout')); void worker.terminate() }, opts.timeout ?? 120000)
      const finish = (error: Error | null, value?: T) => { clearTimeout(timer); error ? reject(error) : resolve(value!) }
      worker.once('error', error => finish(error))
      worker.once('exit', code => finish(new Error('intake worker exited before reply: ' + code)))
      worker.on('message', message => {
        try { opts.onMessage?.(message, worker) } catch (error) { finish(error as Error); return }
        if (['error', 'failed'].includes(message.type) || message.error) finish(new Error(message.message ?? message.error))
        else if (terminal.includes(message.type) || ('result' in message && terminal.includes('result'))) finish(null, message as T)
      })
      worker.postMessage(job)
    })
  } finally { await worker.terminate() }
}

export class IntakeSandbox {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-e2e-intake-'))
  readonly source = path.join(this.root, 'A', '衣服', '西装', '商品')
  readonly library = path.join(this.root, 'Atrium素材库')
  readonly dbFile = path.join(this.root, 'library.db')
  readonly db: Database.Database
  constructor(readonly workers: Awaited<ReturnType<typeof compileIntakeWorkers>>) {
    fs.mkdirSync(this.source, { recursive: true }); fs.mkdirSync(this.library)
    this.db = new Database(this.dbFile); this.db.pragma('journal_mode=WAL'); this.db.pragma('foreign_keys=ON'); migrate(this.db)
  }
  file(relative: string, content: string | Buffer): string {
    const file = path.join(this.source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file
  }
  async plan(sourcePath = this.source, opts: { extract?: boolean; password?: (source: string) => string | null; blobs?: ReturnType<typeof readLibraryBlobIndex> } = {}) {
    const jobId = randomUUID()
    const response = await requestWorker<{ plan: PreparedIntakePlan }>(this.workers.plan, {
      type: 'job', jobId, sourcePath, stagingPath: path.join(this.root, 'staging', jobId), extract: opts.extract ?? false,
      resourceRoot: resources, backendDirs: [path.join(resources, 'bin')], learning: [],
      normalized: { libraryRoot: this.library, namespace: this.dbFile, blobs: opts.blobs ?? readLibraryBlobIndex(this.db, this.library), existingTargetPaths: fs.readdirSync(this.library), categories }
    }, ['plan'], { timeout: 240000, onMessage: (msg, worker) => {
      if (msg.type === 'need-password') worker.postMessage({ type: 'password', requestId: msg.requestId, password: opts.password?.(msg.sourcePath) ?? null })
    } })
    const cache = new ExpandCache({ namespace: this.dbFile })
    await cache.retain(response.plan.id, response.plan.cacheKeys, true)
    await cache.release('pending:' + jobId)
    if (process.env.AVCA_E2E_AUDIT) fs.writeFileSync(path.join(process.env.AVCA_E2E_AUDIT, response.plan.id + '.json'), JSON.stringify(response.plan, null, 2))
    return response.plan
  }
  persist(plan: PreparedIntakePlan) { return persistIntakePlan(this.db, plan) }
  async execute(plan: PreparedIntakePlan, opts: WorkerRequestOptions = {}): Promise<ExecutionResult> {
    const message = await requestWorker<{ result: ExecutionResult }>(this.workers.execute, {
      type: 'execute', planId: plan.id, dbFile: this.dbFile, resourceRoot: resources,
      userLexicon: path.join(this.root, 'user.json'), categories, learning: [], confidenceConfirm: 0.5, confidenceAuto: 0.8
    }, ['completed'], { timeout: 240000, ...opts })
    await this.fault({ type: 'release', planId: plan.id })
    return message.result
  }
  async commit(plan: PreparedIntakePlan) { this.persist(plan); return this.execute(plan) }
  async fault<T = any>(job: object, opts: WorkerRequestOptions = {}): Promise<T> { const msg = await requestWorker<{ result: T }>(this.workers.fault, { ...job, dbFile: this.dbFile, resourceRoot: resources, cacheRoot: path.join(this.root, 'fault-cache') }, ['result'], opts); return msg.result }
  close() {
    this.db.close()
    const cache = new ExpandCache({ namespace: this.dbFile })
    const temp = fs.realpathSync(os.tmpdir())
    for (const dir of [cache.root, this.root]) {
      const rel = path.relative(temp, dir)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || fs.lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe intake sandbox cleanup')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

export async function zip(file: string, entries: Array<[string, string | Buffer]>) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const archive = new yazl.ZipFile(); for (const [name, bytes] of entries) archive.addBuffer(Buffer.from(bytes), name); archive.end()
  await new Promise<void>((resolve, reject) => archive.outputStream.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject))
  return file
}
export function snapshotFiles(root: string): unknown[] {
  const files: unknown[] = []
  const walk = (dir: string) => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name), st = fs.lstatSync(file), rel = path.relative(root, file)
    if (st.isSymbolicLink()) files.push({ path: rel, link: fs.readlinkSync(file) })
    else if (st.isDirectory()) walk(file)
    else files.push({ path: rel, size: st.size, mtime: st.mtimeMs, sha: digest(file) })
  } }; walk(root); return files
}
