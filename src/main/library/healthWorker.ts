import { parentPort } from 'node:worker_threads'
import { matchStrayContents, type StrayCoverageOptions } from './strayCoverage'
import type { HealthReport } from '../../shared/types'

parentPort?.once('message', (job: { items: HealthReport['strays']; options: StrayCoverageOptions }) => {
  void matchStrayContents(job.items, job.options).then(result => parentPort?.postMessage({ result }),
    error => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }))
})
