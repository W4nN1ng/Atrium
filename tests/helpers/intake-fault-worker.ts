/** Faults are injected through existing IO/budget hooks; algorithms and publication remain real. */
import { parentPort } from 'node:worker_threads'
import path from 'node:path'
import { buildClosure } from '../../src/main/intake/closure'
import { ExpandCache } from '../../src/main/intake/expandCache'
import { intakeBudget } from '../../src/shared/constants'
import { openDatabase, closeDatabase } from '../../src/main/db'
import { undoPlan, executePlan } from '../../src/main/intake/executor'
import { readIntakePlan } from '../../src/main/db/repos/intakePlan'
import { classifyPublishedUnit } from '../../src/main/intake/classification'
import { loadLexicon } from '../../src/main/classify/lexicon'
import { verifyCoverageReview } from '../../src/main/intake/review'
import { releaseCompletedIntakeCache, releasePendingIntakeCache } from '../../src/main/intake/lifecycle'
import { buildIntakePlan } from '../../src/main/intake/planner'
import fs from 'node:fs'

parentPort?.once('message', job => {
  void (async () => {
    if (job.type === 'closure' || job.type === 'batch-plan') {
      let free = job.freeBytes
      const controller = new AbortController()
      const closure = await buildClosure(job.source, { ...intakeBudget(0), ...job.budget,
        cache: new ExpandCache({ root: job.cacheRoot, maxBytes: job.cacheMaxBytes, freeBytes: free === undefined ? undefined : () => free }),
        ownerId: job.ownerId ?? 'fault-worker', extraBackendDirs: [path.join(job.resourceRoot, 'bin')],
        requestPassword: async file => job.passwords?.[file] ?? job.password ?? null,
        signal: controller.signal,
        onSpaceWait: job.resumeFreeBytes === undefined && !job.cancelOnWait ? undefined : requiredBytes => { parentPort?.postMessage({ type: 'waiting-space', requiredBytes }); if (job.cancelOnWait) controller.abort(); else free = job.resumeFreeBytes }
      })
      if (job.type === 'closure') return closure
      return buildIntakePlan(job.source, { libraryRoot: job.libraryRoot, sources: [{ sourcePath: job.source, kind: fs.lstatSync(job.source).isDirectory() ? 'directory' : 'archive', closure }],
        classifyDeps: { lex: loadLexicon({ builtin: path.join(job.resourceRoot, 'lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync(path.join(job.resourceRoot, 'lexicon/categories.json'), 'utf8')) } }, [])
    }
    const db = openDatabase(job.dbFile)
    try {
      if (job.type === 'migrate') return { version: db.pragma('user_version', { simple: true }), integrity: db.pragma('integrity_check', { simple: true }), foreignKeys: db.pragma('foreign_key_check') }
      if (job.type === 'release') { await releaseCompletedIntakeCache(db, job.planId); return true }
      if (job.type === 'release-pending') { await releasePendingIntakeCache(db, job.jobId); return true }
      if (job.type === 'execute-space') {
        const controller = new AbortController(); let free = job.freeBytes
        return await executePlan(db, job.planId, { signal: controller.signal, freeBytes: () => free,
          onSpaceWait: requiredBytes => { parentPort?.postMessage({ type: 'waiting-space', requiredBytes }); if (job.cancelOnWait) controller.abort(); else free = job.resumeFreeBytes }
        })
      }
      if (job.type === 'undo') return undoPlan(db, job.planId)
      const plan = readIntakePlan(db, job.planId)!.plan
      if (job.type === 'review') return verifyCoverageReview(plan, plan.reviews[0])
      if (job.type === 'classify') return classifyPublishedUnit(plan, plan.units[0], { lex: loadLexicon({ builtin: path.join(job.resourceRoot, 'lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync(path.join(job.resourceRoot, 'lexicon/categories.json'), 'utf8')) })
      throw new Error('Unknown intake test job')
    } finally { closeDatabase() }
  })().then(result => parentPort?.postMessage({ result }), error => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }))
})
