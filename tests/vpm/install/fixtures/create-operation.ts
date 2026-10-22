import fs from 'node:fs'
import path from 'node:path'
import { openVpmDb, closeVpmDb } from '../../../../src/main/vpm/db'
import { OperationStore } from '../../../../src/main/vpm/install'
import { projectKeyOf } from '../../../../src/shared/vpm/domain/project'

/**
 * 跨进程并发验证用的子进程：尝试为同一个工程建一个操作。
 *
 * 成功打印 `{ok:true}`，被唯一索引/活动检查挡住打印 `{ok:false,code}`。
 * 只用环境变量传参，避免 argv 被 vite-node 改写。
 */
async function main(): Promise<void> {
  const dbFile = process.env.FIX_DB
  const projectPath = process.env.FIX_PROJECT
  const planHash = process.env.FIX_PLAN_HASH
  const id = process.env.FIX_OP_ID
  if (!dbFile || !projectPath || !planHash || !id) throw new Error('missing fixture env')

  const db = await openVpmDb({
    file: dbFile,
    backupsDir: path.join(path.dirname(dbFile), 'backups')
  })
  try {
    const real = fs.realpathSync.native(projectPath)
    const store = new OperationStore(db)
    const operation = store.create({
      id,
      projectKey: projectKeyOf(real),
      projectPath: real,
      kind: 'install',
      plan: { changes: [] },
      planHash
    })
    console.log(JSON.stringify({ ok: true, id: operation.id }))
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        code: (error as { code?: string }).code ?? 'unknown',
        message: (error as Error).message.slice(0, 120)
      })
    )
  } finally {
    closeVpmDb(db)
  }
}

void main()
