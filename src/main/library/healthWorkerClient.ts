import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { HealthReport } from '../../shared/types'
import type { StrayCoverageOptions, StrayCoverageResult } from './strayCoverage'

export async function matchStraysInWorker(items: HealthReport['strays'], options: StrayCoverageOptions): Promise<StrayCoverageResult> {
  const entry = path.join(__dirname, 'healthWorker.js').replace('app.asar', 'app.asar.unpacked')
  const worker = new Worker(entry)
  try {
    return await new Promise<StrayCoverageResult>((resolve, reject) => {
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`Health worker exited: ${code}`)))
      worker.once('message', (msg: { result?: StrayCoverageResult; error?: string }) => msg.result ? resolve(msg.result) : reject(new Error(msg.error ?? 'Health scan failed')))
      worker.postMessage({ items, options })
    })
  } finally { await worker.terminate() }
}
