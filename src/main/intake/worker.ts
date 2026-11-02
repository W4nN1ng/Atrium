import { parentPort } from 'node:worker_threads'
import path from 'node:path'
import type fs from 'node:fs'
import { openDatabase, closeDatabase } from '../db'
import { executePlan } from './executor'
import { loadLexicon } from '../classify/lexicon'
import type { ClassifyDeps } from '../classify/engine'
import type { CategoryConfig } from '../../shared/types'
import { classifyPublishedUnit } from './classification'
import { readIntakePlan } from '../db/repos/intakePlan'
import { verifyCoverageReview } from './review'

export interface ExecuteJob {
  type: 'execute'; planId: string; dbFile: string; resourceRoot: string; userLexicon: string
  categories: CategoryConfig; learning: Array<[string, import('../classify/engine').LearningRow[]]>
  confidenceConfirm: number; confidenceAuto: number
  batchId?: string
  backendDirs?: string[]
}
const controller = new AbortController()
let requestId = 0
const passwords = new Map<number, (value: string | null) => void>()
parentPort?.on('message', (msg: ExecuteJob | { type: 'cancel' } | { type: 'password'; requestId: number; password: string | null }) => {
  if (msg.type === 'password') { passwords.get(msg.requestId)?.(msg.password); passwords.delete(msg.requestId); return }
  if (msg.type === 'cancel') { controller.abort(); for (const resolve of passwords.values()) resolve(null); passwords.clear(); return }
  if (msg.type !== 'execute') return
  void (async () => {
    const db = openDatabase(msg.dbFile)
    try {
      const deps: ClassifyDeps = { lex: loadLexicon({ builtin: path.join(msg.resourceRoot, 'lexicon/lexicon.json'), user: msg.userLexicon }),
        categories: msg.categories, learning: new Map(msg.learning), confidenceConfirm: msg.confidenceConfirm, confidenceAuto: msg.confidenceAuto }
      const plan = readIntakePlan(db, msg.planId)!.plan
      const reads = { extraBackendDirs: msg.backendDirs ?? [path.join(msg.resourceRoot, 'bin')], passwordCache: new Map<string, string>(), archiveIdentities: new Map<string, { sha256: string; stat: fs.Stats }>(),
        onSpaceWait: (requiredBytes: number) => parentPort?.postMessage({ type: 'waiting-space', requiredBytes }),
        requestPassword: (sourcePath: string) => new Promise<string | null>(resolve => { const id = ++requestId; passwords.set(id, resolve); parentPort?.postMessage({ type: 'need-password', sourcePath, requestId: id }) }) }
      const result = await executePlan(db, msg.planId, { signal: controller.signal, batchId: msg.batchId,
        ...reads,
        review: review => verifyCoverageReview(plan, review, controller.signal, { ...reads, cacheNamespace: msg.dbFile }),
        onProgress: (completed, total) => parentPort?.postMessage({ type: 'progress', completed, total }),
        finalizeUnit: async (plan, unit) => {
          const final = await classifyPublishedUnit(plan, unit, deps)
          return final.classification
        }
      })
      parentPort?.postMessage({ type: 'completed', result })
    } finally { closeDatabase() }
  })().catch(error => parentPort?.postMessage({ type: 'failed', message: error instanceof Error ? error.message : String(error), cancelled: controller.signal.aborted }))
})
