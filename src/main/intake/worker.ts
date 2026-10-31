import { parentPort } from 'node:worker_threads'
import path from 'node:path'
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
}
const controller = new AbortController()
parentPort?.on('message', (msg: ExecuteJob | { type: 'cancel' }) => {
  if (msg.type === 'cancel') { controller.abort(); return }
  if (msg.type !== 'execute') return
  void (async () => {
    const db = openDatabase(msg.dbFile)
    try {
      const deps: ClassifyDeps = { lex: loadLexicon({ builtin: path.join(msg.resourceRoot, 'lexicon/lexicon.json'), user: msg.userLexicon }),
        categories: msg.categories, learning: new Map(msg.learning), confidenceConfirm: msg.confidenceConfirm, confidenceAuto: msg.confidenceAuto }
      const plan = readIntakePlan(db, msg.planId)!.plan
      const result = await executePlan(db, msg.planId, { signal: controller.signal, batchId: msg.batchId,
        review: review => verifyCoverageReview(plan, review, controller.signal),
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
