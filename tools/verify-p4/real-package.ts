import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CacheEntryStore, PackageCacheService, VpmCacheStore } from '../../src/main/vpm/cache'
import { closeVpmDb, openVpmDb } from '../../src/main/vpm/db'
import { createVpmHttpClient } from '../../src/main/vpm/http'
import { extractPackageZip } from '../../src/main/vpm/install'
import { createNodeTransport } from './lib/node-transport'

/**
 * 真机验证：从 VRChat 官方仓库真实下载一个包 → 缓存/hash → 真实解压。
 *
 * 只用真实网络与真实 zip；不启动 Electron、不开窗口。
 * 运行：`npx vite-node tools/verify-p4/real-package.ts`
 */

const INDEX_URL = 'https://vrchat.github.io/packages/index.json'
const PACKAGE = 'com.vrchat.base'
const VERSION = '3.7.0'

function ok(label: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
    process.exitCode = 1
    return
  }
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-verify-real-'))
  const dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  const db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  const http = createVpmHttpClient({
    transport: createNodeTransport(),
    isNetworkAllowed: () => true,
    userAgent: 'Atrium/0.9.0 verify-p4'
  })
  const store = new VpmCacheStore({ dataRoot })
  const entries = new CacheEntryStore(db)
  const cache = new PackageCacheService({ store, entries, http, quotaBytes: 512 * 1024 * 1024 })

  try {
    console.log(`\n[1/5] 读取官方仓库索引 ${INDEX_URL}`)
    const index = await http.getJson(INDEX_URL)
    const body = index.body as {
      packages?: Record<string, { versions?: Record<string, { url?: string; zipSHA256?: string; zipSize?: number }> }>
    }
    const version = body.packages?.[PACKAGE]?.versions?.[VERSION]
    ok('索引返回 200 且能找到包', index.status === 200 && !!version, `${PACKAGE}@${VERSION}`)
    if (!version?.url || !version.zipSHA256) throw new Error('索引里没有 url/zipSHA256')

    console.log(`\n[2/5] 真实下载 ${version.url}`)
    const started = Date.now()
    const first = await cache.ensurePackage({
      url: version.url,
      sha256: version.zipSHA256,
      size: version.zipSize ?? null
    })
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    ok('下载完成且 SHA-256 与仓库一致', first.sha256 === version.zipSHA256, first.sha256)
    ok('落盘大小 > 0', first.size > 0, `${(first.size / 1024 / 1024).toFixed(2)} MiB / ${seconds}s`)
    ok('缓存路径是 <cache>/packages/<前两位>/<sha>.zip', first.path.includes(`${path.sep}packages${path.sep}${first.sha256.slice(0, 2)}${path.sep}`), first.path)
    ok('首次是下载而不是复用', first.reused === false)

    console.log('\n[3/5] 再次请求同一个包（应命中缓存并完整重算 hash）')
    const second = await cache.ensurePackage({ url: version.url, sha256: version.zipSHA256, size: version.zipSize ?? null })
    ok('第二次标记为 reused', second.reused === true)
    ok('路径与第一次一致', second.path === first.path)
    const rows = entries.list()
    ok('vpm_cache_entry 有一行', rows.length === 1, JSON.stringify(rows[0]))

    console.log('\n[4/5] 真实解压到同卷临时目录')
    // 和事务一样：先建好父目录，再由 extractPackageZip 自己 mkdir 目标（非递归）。
    fs.mkdirSync(path.join(root, 'extract'), { recursive: true })
    const target = path.join(root, 'extract', PACKAGE)
    const extracted = await extractPackageZip({
      zipPath: first.path,
      targetDir: target,
      expected: { name: PACKAGE, version: VERSION }
    })
    ok('识别到包根', fs.existsSync(extracted.packageJsonPath), extracted.rootDir)
    ok('name/version 与期望一致', extracted.name === PACKAGE && extracted.version === VERSION, `${extracted.name}@${extracted.version}`)
    ok('条目数与字节数 > 0', extracted.entries > 0 && extracted.bytes > 0, `${extracted.entries} entries / ${(extracted.bytes / 1024 / 1024).toFixed(2)} MiB`)

    console.log('\n[5/5] 检查解压结果的真实内容')
    const manifest = extracted.manifest as {
      name?: string
      version?: string
      unity?: string
      dependencies?: Record<string, string>
      vpmDependencies?: Record<string, string>
    }
    ok('package.json 的 name/version 与目录一致', manifest.name === PACKAGE && manifest.version === VERSION)
    const depKey = manifest.vpmDependencies ? 'vpmDependencies' : manifest.dependencies ? 'dependencies' : null
    ok(
      'package.json 带依赖声明',
      !!depKey,
      depKey ? `${depKey}: ${Object.keys(manifest[depKey] as Record<string, string>).join(', ').slice(0, 120)}` : ''
    )
    ok('package.json 带 unity 版本约束', typeof manifest.unity === 'string', String(manifest.unity))
    const files = fs.readdirSync(extracted.rootDir, { recursive: true }) as string[]
    const metaCount = files.filter((name) => name.endsWith('.meta')).length
    ok('保留了 .meta 文件', metaCount > 0, `${metaCount} 个 .meta`)
    const unityMeta = path.join(extracted.rootDir, 'package.json.meta')
    ok('package.json.meta 存在且非空', fs.existsSync(unityMeta) && fs.statSync(unityMeta).size > 0)

    console.log('\n结论：真实下载 / hash 校验 / 内容寻址缓存 / 真实 zip 解压 全部通过。')
  } finally {
    closeVpmDb(db)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验证失败：', error)
  process.exitCode = 1
})
