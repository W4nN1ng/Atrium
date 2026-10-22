import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CacheEntryStore, PackageCacheService, VpmCacheStore } from '../../src/main/vpm/cache'
import { closeVpmDb, openVpmDb } from '../../src/main/vpm/db'
import type { VpmHttpPort } from '../../src/main/vpm/http'
import { makeZip } from '../../tests/vpm/install/zip-fixture'

/**
 * 缓存一致性压力验证：并发下载 + 小配额淘汰之后，
 * `vpm_cache_entry` 与磁盘上的文件是否还对得上。
 *
 * 用假 HTTP 端口（写真实 zip 字节、算真实 hash），不联网、不开窗口。
 * 运行：`npx vite-node tools/verify-p4/cache-stress.ts`
 */

const PACKAGES = 24
const CONCURRENCY = 8
const QUOTA_FACTOR = 4

function sha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-verify-cache-'))
  const dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  const db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  const store = new VpmCacheStore({ dataRoot })
  const entries = new CacheEntryStore(db)

  const files = new Map<string, Buffer>()
  for (let index = 0; index < PACKAGES; index++) {
    const buffer = makeZip([
      {
        name: 'package.json',
        data: JSON.stringify({ name: `com.verify.p${index}`, version: '1.0.0' })
      },
      { name: 'payload.bin', data: Buffer.alloc(8 * 1024, index) }
    ])
    files.set(`https://verify.test/p${index}.zip`, buffer)
  }
  const oneSize = [...files.values()][0].length
  const quota = oneSize * QUOTA_FACTOR

  const port: VpmHttpPort = {
    getJson: async () => {
      throw new Error('unused')
    },
    downloadToFile: async (url, dest) => {
      const buffer = files.get(url)
      if (!buffer) throw new Error(`unknown url ${url}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      fs.writeFileSync(dest, buffer)
      return { size: buffer.length, sha256: sha(buffer), finalUrl: url }
    }
  }

  const cache = new PackageCacheService({ store, entries, http: port, quotaBytes: quota })
  const urls = [...files.keys()]

  try {
    console.log(`\n[1/4] ${PACKAGES} 个包、并发 ${CONCURRENCY}、配额 ${QUOTA_FACTOR} 个包大小`)
    const started = Date.now()
    const fulfilled: Array<{ url: string; sha256: string }> = []
    const rejected: string[] = []
    for (let index = 0; index < urls.length; index += CONCURRENCY) {
      const batch = urls.slice(index, index + CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map((url) =>
          cache.ensurePackage({
            url,
            sha256: sha(files.get(url) as Buffer),
            size: files.get(url)?.length ?? null
          })
        )
      )
      settled.forEach((item, offset) => {
        if (item.status === 'fulfilled') fulfilled.push({ url: batch[offset], sha256: item.value.sha256 })
        else rejected.push((item.reason as { code?: string })?.code ?? 'unknown')
      })
    }
    console.log(
      `  成功 ${fulfilled.length}，拒绝 ${rejected.length}（${[...new Set(rejected)].join(',') || '-'}），` +
        `用时 ${((Date.now() - started) / 1000).toFixed(1)}s`
    )
    const unexpected = rejected.filter((code) => code !== 'vpmCacheQuotaExceeded')
    console.log(
      unexpected.length === 0
        ? '  ✓ 只有“配额不足”会被拒绝，没有把并发问题伪装成网络/写入错误'
        : `  ✗ 出现了非预期错误：${unexpected.join(',')}`
    )

    console.log('\n[2/4] 成功返回的 hash 与请求一致')
    const badHash = fulfilled.filter((item) => item.sha256 !== sha(files.get(item.url) as Buffer))
    console.log(badHash.length === 0 ? '  ✓ 全部一致' : `  ✗ ${badHash.length} 个不一致`)

    console.log('\n[3/4] 配额、DB 行与磁盘文件的一致性')
    const usage = cache.usage()
    const onDisk = new Set(store.listPackages().map((file) => file.sha256))
    const rows = entries.list()
    const rowsWithoutFile = rows.filter((row) => !onDisk.has(row.sha256))
    const filesWithoutRow = [...onDisk].filter((hash) => !rows.some((row) => row.sha256 === hash))
    const tmpLeft = fs.readdirSync(store.tmpRoot).filter((name) => name.endsWith('.part'))

    console.log(
      `  配额 ${(quota / 1024).toFixed(0)} KiB，实际占用 ${(usage.bytes / 1024).toFixed(0)} KiB，${usage.files} 个文件`
    )
    console.log(
      `  行数 ${rows.length}，磁盘文件 ${onDisk.size}，孤儿行 ${rowsWithoutFile.length}，无行文件 ${filesWithoutRow.length}，残留 .part ${tmpLeft.length}`
    )

    console.log('\n[4/4] 被淘汰的包可以重新下载（自愈）')
    const evictedUrl = urls[0]
    const reFetched = await cache.ensurePackage({
      url: evictedUrl,
      sha256: sha(files.get(evictedUrl) as Buffer),
      size: files.get(evictedUrl)?.length ?? null
    })
    const healed =
      fs.existsSync(reFetched.path) && sha(fs.readFileSync(reFetched.path)) === reFetched.sha256
    console.log(healed ? '  ✓ 重新下载并校验通过' : '  ✗ 重新下载后文件/hash 不对')

    const pass =
      usage.bytes <= quota &&
      rowsWithoutFile.length === 0 &&
      filesWithoutRow.length === 0 &&
      tmpLeft.length === 0 &&
      badHash.length === 0 &&
      unexpected.length === 0 &&
      healed &&
      fulfilled.length > 0
    console.log(
      pass
        ? '\n结论：并发下载 + 淘汰后，配额、vpm_cache_entry 与磁盘文件保持一致，没有孤儿行/残留临时文件。'
        : '\n结论：发现不一致，需要复查。'
    )
    if (!pass) process.exitCode = 1
  } finally {
    closeVpmDb(db)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('验证失败：', error)
  process.exitCode = 1
})
