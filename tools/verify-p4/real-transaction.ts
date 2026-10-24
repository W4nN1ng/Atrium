import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CacheEntryStore, PackageCacheService, VpmCacheStore } from '../../src/main/vpm/cache'
import { closeVpmDb, openVpmDb } from '../../src/main/vpm/db'
import { createVpmHttpClient } from '../../src/main/vpm/http'
import { InstallTransactionService, OperationStore } from '../../src/main/vpm/install'
import { ProjectFsReader } from '../../src/main/vpm/projects'
import { VaultStore } from '../../src/main/vpm/vault'
import { sha256Hex } from '../../src/shared/vpm/domain/hash'
import {
  buildChangePlan,
  type ChangePlan,
  type ChangePlanRequest
} from '../../src/shared/vpm/domain/plan'
import { projectKeyOf, projectSlugOf, readProjectSnapshot } from '../../src/shared/vpm/domain/project'
import type {
  ResolverCatalogPackage,
  ResolverInstalled
} from '../../src/shared/vpm/domain/resolver'
import { createNodeTransport } from './lib/node-transport'

/**
 * 真机验证：把官方仓库的真实包（com.vrchat.base 3.7.0，936 个文件）完整走一遍事务。
 *
 * 安装 → 校验包目录/manifest/journal；再卸载 → 校验旧包进了回滚仓。
 * 只开临时工程、不启动 Unity、不开窗口。
 *
 * 运行：`npx vite-node tools/verify-p4/real-transaction.ts`
 */

const INDEX_URL = 'https://vrchat.github.io/packages/index.json'
const PACKAGE = 'com.vrchat.base'
const VERSION = '3.7.0'
const UNITY = '2022.3.22f1'

function ok(label: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
    process.exitCode = 1
    return
  }
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

function countFiles(root: string): { files: number; metas: number } {
  let files = 0
  let metas = 0
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name))
        continue
      }
      files++
      if (entry.name.endsWith('.meta')) metas++
    }
  }
  walk(root)
  return { files, metas }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-verify-tx-'))
  const dataRoot = path.join(root, 'data')
  const project = path.join(root, 'DemoProject')
  fs.mkdirSync(dataRoot)
  fs.mkdirSync(path.join(project, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${UNITY}\n`)
  const manifestText = '{\n  "dependencies": {},\n  "locked": {}\n}'
  const manifestPath = path.join(project, 'Packages', 'vpm-manifest.json')
  fs.writeFileSync(manifestPath, manifestText)
  const projectKey = projectKeyOf(fs.realpathSync.native(project))

  const db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  const http = createVpmHttpClient({
    transport: createNodeTransport(),
    isNetworkAllowed: () => true,
    userAgent: 'Atrium/0.9.0 verify-p4'
  })
  const cacheStore = new VpmCacheStore({ dataRoot })
  const packageCache = new PackageCacheService({
    store: cacheStore,
    entries: new CacheEntryStore(db),
    http,
    quotaBytes: 512 * 1024 * 1024
  })
  const vault = new VaultStore({ dataRoot })
  const operations = new OperationStore(db)

  const reader = new ProjectFsReader(project)
  const snapshot = (): ReturnType<typeof readProjectSnapshot> => {
    const current = new ProjectFsReader(project)
    return readProjectSnapshot(current, current.root)
  }

  const makePlan = (
    requests: ChangePlanRequest[],
    catalog: ResolverCatalogPackage[],
    installed: ResolverInstalled[]
  ): ChangePlan => {
    const current = snapshot()
    return buildChangePlan({
      projectKey,
      unityVersion: UNITY,
      manifestHashBefore: current.manifestHash ?? sha256Hex(manifestText),
      roots: current.manifest.dependencies,
      locked: {},
      installed,
      catalog,
      requests,
      options: { protectedPackages: ['com.avca.bridge'] }
    })
  }

  try {
    console.log(`\n[1/6] 拉官方索引并准备真实包 ${PACKAGE}@${VERSION}`)
    const index = await http.getJson(INDEX_URL)
    const body = index.body as {
      packages?: Record<string, { versions?: Record<string, { url?: string; zipSHA256?: string; zipSize?: number }> }>
    }
    const version = body.packages?.[PACKAGE]?.versions?.[VERSION]
    if (!version?.url || !version.zipSHA256) throw new Error('索引里没有 url/zipSHA256')
    ok('索引可用', index.status === 200, version.url)

    const seedZip = process.env.VERIFY_ZIP
    if (seedZip) {
      // 网络不稳定时用已下载的真实包预热缓存；走的仍是缓存命中 + 完整重算 hash 的真实路径。
      const target = cacheStore.pathForPackage(version.zipSHA256)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(seedZip, target)
      console.log(`  用本地真实包预热缓存：${seedZip}`)
    }

    console.log('\n[2/6] 安装真实包（真实下载 → 缓存 → 解压 → 换入 → manifest 最后写）')
    const plan = makePlan(
      [{ kind: 'install', name: PACKAGE }],
      [{ name: PACKAGE, version: VERSION, sha256: version.zipSHA256, url: version.url, size: version.zipSize ?? null, repoId: 'official' }],
      []
    )
    const plans = new Map<string, ChangePlan>([['verify-install', plan]])
    const service = new InstallTransactionService({
      operations,
      plans: { get: (id: string) => { const hit = plans.get(id); if (!hit) throw new Error('no plan'); return hit } },
      projects: { load: () => ({ projectPath: project, snapshot: snapshot() }) },
      packages: packageCache,
      vault,
      dataRoot,
      sleep: async () => undefined
    })
    const started = Date.now()
    const installed = await service.apply({ projectKey, planId: 'verify-install' })
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    ok(
      '事务提交',
      installed.status === 'committed',
      `${installed.status} / ${seconds}s / ${installed.errorCode ?? '-'} / ${installed.errorDetail ?? '-'}`
    )
    if (installed.status !== 'committed') {
      console.log('  warnings:', JSON.stringify(installed.warnings, null, 1).slice(0, 1200))
      throw new Error('transaction did not commit')
    }
    ok('包目录就位', fs.existsSync(path.join(project, 'Packages', PACKAGE, 'package.json')))
    const counts = countFiles(path.join(project, 'Packages', PACKAGE))
    ok('真实文件数 > 900', counts.files > 900, `${counts.files} 个文件 / ${counts.metas} 个 .meta`)

    const afterInstall = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      locked?: Record<string, { version: string }>
    }
    ok('manifest.dependencies 有这条根依赖', afterInstall.dependencies?.[PACKAGE] === '*', String(afterInstall.dependencies?.[PACKAGE]))
    ok('manifest.locked 写的是精确版本', afterInstall.locked?.[PACKAGE]?.version === VERSION, afterInstall.locked?.[PACKAGE]?.version)

    const journalPath = path.join(project, '.atrium-tx', installed.operationId, 'journal.json')
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { commitPoint: string; moves: unknown[] }
    ok('journal 提交点已写', journal.commitPoint === 'manifest_written')
    ok('事务区没有残留 install/trash', !fs.existsSync(path.join(project, '.atrium-tx', installed.operationId, 'install')))

    console.log('\n[3/6] 从缓存再装一次同一个包（命中缓存，不重复下载）')
    const cached = await packageCache.ensurePackage({ url: version.url, sha256: version.zipSHA256, size: version.zipSize ?? null })
    ok('缓存命中', cached.reused === true, cached.path)

    console.log('\n[4/6] 卸载真实包（旧目录进事务区 → 回滚仓）')
    const removePlan = makePlan(
      [{ kind: 'remove', name: PACKAGE }],
      [],
      [{ name: PACKAGE, version: VERSION }]
    )
    plans.set('verify-remove', removePlan)
    const removed = await service.apply({ projectKey, planId: 'verify-remove' })
    ok('卸载提交', removed.status === 'committed', removed.status)
    ok('包目录已移走', !fs.existsSync(path.join(project, 'Packages', PACKAGE)))
    const afterRemove = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      locked?: Record<string, unknown>
    }
    ok('manifest 已清空', Object.keys(afterRemove.dependencies ?? {}).length === 0 && Object.keys(afterRemove.locked ?? {}).length === 0)
    ok('vault_pending 已归零', removed.vaultPending === false)

    console.log('\n[5/6] 回滚仓里是完整的旧包')
    const vaultDir = path.join(
      dataRoot,
      'vault',
      projectSlugOf(projectKey),
      removed.operationId,
      'packages',
      PACKAGE
    )
    ok('回滚仓目录存在', fs.existsSync(vaultDir), vaultDir)
    const vaultCounts = countFiles(vaultDir)
    ok('回滚仓文件数与安装时一致', vaultCounts.files === counts.files, `${vaultCounts.files} vs ${counts.files}`)
    const vaultManifest = JSON.parse(fs.readFileSync(path.join(vaultDir, 'package.json'), 'utf8')) as { version?: string }
    ok('回滚仓里的版本是 3.7.0', vaultManifest.version === VERSION, String(vaultManifest.version))

    console.log('\n[6/6] 再次安装（验证卸载后还能重装）')
    const reinstall = makePlan(
      [{ kind: 'install', name: PACKAGE }],
      [{ name: PACKAGE, version: VERSION, sha256: version.zipSHA256, url: version.url, size: version.zipSize ?? null, repoId: 'official' }],
      []
    )
    plans.set('verify-reinstall', reinstall)
    const again = await service.apply({ projectKey, planId: 'verify-reinstall' })
    ok('重装提交', again.status === 'committed', again.status)
    ok('包目录回来了', fs.existsSync(path.join(project, 'Packages', PACKAGE, 'package.json')))

    console.log('\n结论：真实包从下载到装/卸/重装、manifest 与回滚仓全部通过。')
  } finally {
    closeVpmDb(db)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验证失败：', error)
  process.exitCode = 1
})
