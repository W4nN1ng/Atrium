import fs from 'node:fs'
import path from 'node:path'
import { openVpmDb } from '../../../../src/main/vpm/db'
import { InstallTransactionService, OperationStore } from '../../../../src/main/vpm/install'
import { ProjectFsReader } from '../../../../src/main/vpm/projects'
import { VaultStore } from '../../../../src/main/vpm/vault'
import { readProjectSnapshot } from '../../../../src/shared/vpm/domain/project'
import type { ChangePlan } from '../../../../src/shared/vpm/domain/plan'

/**
 * 真实进程死亡验证：跑到 `move-in:item:after` 直接 `process.exit(37)`。
 *
 * 不关数据库、不清理事务区、不写任何收尾状态——和断电/被杀一样。
 */
async function main(): Promise<void> {
  const dbFile = process.env.FIX_DB
  const dataRoot = process.env.FIX_DATA_ROOT
  const projectPath = process.env.FIX_PROJECT
  const planFile = process.env.FIX_PLAN_FILE
  const zipPath = process.env.FIX_ZIP
  const zipSha = process.env.FIX_SHA
  if (!dbFile || !dataRoot || !projectPath || !planFile || !zipPath || !zipSha) {
    throw new Error('missing fixture env')
  }

  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')) as ChangePlan
  const db = await openVpmDb({
    file: dbFile,
    backupsDir: path.join(path.dirname(dbFile), 'backups')
  })
  const operations = new OperationStore(db)
  const reader = new ProjectFsReader(projectPath)
  const service = new InstallTransactionService({
    operations,
    plans: { get: () => plan },
    projects: {
      load: () => ({ projectPath: reader.root, snapshot: readProjectSnapshot(reader, reader.root) })
    },
    packages: {
      ensurePackage: async () => ({
        path: zipPath,
        sha256: zipSha,
        size: fs.statSync(zipPath).size,
        reused: false
      })
    },
    vault: new VaultStore({ dataRoot }),
    dataRoot,
    freeBytes: () => 50 * 1024 * 1024 * 1024,
    sleep: async () => undefined,
    hooks: {
      crashOnError: true,
      onPoint: (point) => {
        if (point === 'move-in:item:after') throw new Error('simulated process death')
      }
    }
  })

  try {
    await service.apply({ projectKey: plan.projectKey, planId: 'fixture' })
    process.exit(0)
  } catch {
    // 真实死亡：不 closeVpmDb、不清理，直接退出。
    process.exit(37)
  }
}

void main()
