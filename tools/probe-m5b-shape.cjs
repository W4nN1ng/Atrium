/**
 * M5-B 设计用的只读探针：搞清楚"压缩包型容器里到底有多少 .unitypackage"。
 * 一个字节都不写：库只 readonly 打开，磁盘只做 readdir / stat / 列包内清单。
 *
 * 用法：node tools/probe-m5b-shape.cjs [--deep N]
 *   --deep N  额外抽 N 个压缩包列出成员清单（默认 10，每个要起一次外部进程，慢）
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const LIB = process.env.AVCA_LIB || 'E:\\vrc\\A'
const DB_FILE = path.join(process.env.APPDATA || '', 'A', 'library.db')
const DEEP = Number(process.argv.includes('--deep') ? process.argv[process.argv.indexOf('--deep') + 1] : 10)

const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz)$/i
const UP_RE = /\.unitypackage$/i

// ---------------------------------------------------------------- 磁盘侧
function walk(dir, depth, cb) {
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth > 0) walk(full, depth - 1, cb)
      continue
    }
    cb(full, e.name)
  }
}

const extCount = new Map()
const extBytes = new Map()
let files = 0
walk(LIB, 12, (full, name) => {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  const ext = (m ? m[1] : '(无)').toLowerCase()
  files++
  extCount.set(ext, (extCount.get(ext) || 0) + 1)
  try {
    extBytes.set(ext, (extBytes.get(ext) || 0) + fs.statSync(full).size)
  } catch {
    /* 忽略 */
  }
})
console.log(`\n=== 磁盘：${LIB} —— ${files} 个文件 ===`)
for (const [ext, n] of [...extCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${ext.padEnd(14)} ${String(n).padStart(5)} 个   ${((extBytes.get(ext) || 0) / 1048576).toFixed(0)} MB`)
}

// 散装 .unitypackage 有几个直接在库根某层里（= M5-A 已经能导的那批）
let looseUp = 0
walk(LIB, 12, (full, name) => {
  if (UP_RE.test(name)) looseUp++
})
console.log(`  磁盘上真实存在的 .unitypackage 文件：${looseUp} 个`)
/** 分卷 / rar / 加密这些"抽取要另开一条路"的形态，数量先量出来 */
for (const ext of ['rar', 'zip', '7z', 'tar', 'gz', '001', 'r00', 'part1', 'exe']) {
  console.log(`  [按扩展名] ${ext.padEnd(8)} ${extCount.get(ext) || 0} 个  ${(((extBytes.get(ext) || 0)) / 1048576).toFixed(0)} MB`)
}

/** 点名的那个大容器：80 个包的说法要能复现 */
const BIG = path.join(LIB, '插件道具合集-初音的VRC小店')
if (fs.existsSync(BIG)) {
  let up = 0
  let maxDepth = 0
  let any = 0
  const perDir = new Map()
  const depths = new Map()
  walk(BIG, 12, (full, name) => {
    any++
    if (UP_RE.test(name)) {
      up++
      const d = path.dirname(full)
      perDir.set(d, (perDir.get(d) || 0) + 1)
      const rel = path.relative(BIG, full).split(path.sep).length
      depths.set(rel, (depths.get(rel) || 0) + 1)
      maxDepth = Math.max(maxDepth, rel)
    }
  })
  console.log(`\n=== ${path.basename(BIG)}：${any} 文件 / ${up} 个 .unitypackage，最深 ${maxDepth} 层，最挤的目录 ${Math.max(...perDir.values(), 0)} 个/目录 ===`)
  /**
   * 层数直方图是给 M5-B 量的：`findPackages(dir, depth = 4)` 只能看到
   * "根/一级/二级/文件"，第 5 层往后的包**现在根本找不到**。
   * 这里的 rel = 相对容器根的路径段数（文件算最后一段）。
   */
  console.log(`  层数分布（相对容器根的段数）：${[...depths.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}层:${n}`).join('  ')}`)
  console.log(`  findPackages(depth=4) 能看见 ${[...depths.entries()].filter(([d]) => d <= 5).reduce((a, [, n]) => a + n, 0)} 个 / 看不见 ${[...depths.entries()].filter(([d]) => d > 5).reduce((a, [, n]) => a + n, 0)} 个`)
  for (const [d, n] of [...perDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  ${String(n).padStart(3)} 个  ${path.relative(BIG, d) || '(根)'}`)
  }
}

// ---------------------------------------------------------------- 库侧
const Database = require('better-sqlite3')
if (!fs.existsSync(DB_FILE)) {
  console.log('\n(没有 library.db，跳过库侧)')
} else {
  const db = new Database(DB_FILE, { readonly: true })
  const rows = db
    .prepare(
      `select id, name, kind, content_type, storage_mode, is_bundle, parent_asset_id,
              attachment_kind, library_path, source_path, size_bytes
         from asset`
    )
    .all()
  const pick = (r) => (r.library_path || r.source_path || '').replace(/\\/g, '/')
  const top = rows.filter((r) => !r.parent_asset_id && !r.attachment_kind)
  const byShape = new Map()
  for (const r of top) {
    const p = pick(r)
    const shape = ARCHIVE_RE.test(p) ? '压缩包' : UP_RE.test(p) ? '散装 unitypackage' : p ? '目录/其他' : '无路径'
    byShape.set(shape, (byShape.get(shape) || 0) + 1)
  }
  console.log(`\n=== 库：${rows.length} 行；顶层非附属 ${top.length} 张卡 ===`)
  for (const [k, n] of [...byShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${n}`)

  /** package_entry 里到底有没有东西 —— 决定"GUID 从哪来"这条路能不能走 */
  const pe = db.prepare(`select count(*) n, count(distinct asset_id) a from package_entry`).get()
  const peUp = db
    .prepare(`select count(distinct asset_id) n from package_entry where unity_path is not null`)
    .get()
  console.log(`  package_entry：${pe.n} 行 / 涉及 ${pe.a} 个素材（unity_path 非空的素材 ${peUp.n}）`)

  /** 顶层压缩包卡的体积分布（决定"要不要整包解压"） */
  const arch = top.filter((r) => ARCHIVE_RE.test(pick(r)))
  const sizes = arch.map((r) => r.size_bytes || 0).sort((a, b) => a - b)
  const mb = (x) => (x / 1048576).toFixed(1)
  console.log(
    `  顶层压缩包卡：${arch.length} 张，体积 中位 ${mb(sizes[sizes.length >> 1] || 0)} MB / ` +
      `最大 ${mb(sizes[sizes.length - 1] || 0)} MB / 合计 ${mb(sizes.reduce((a, b) => a + b, 0))} MB`
  )
  db.close()
}

// ---------------------------------------------------------------- 抽包实测
/** 列真实压缩包的成员：里面有没有 .unitypackage、嵌套几层、有多大 */
const SEVEN = path.resolve(__dirname, '..', 'resources', 'bin', '7z.exe')

function listMembers(file) {
  if (!fs.existsSync(SEVEN)) return { err: '没有 resources/bin/7z.exe' }
  try {
    const out = execFileSync(SEVEN, ['l', '-slt', '-ba', '--', file], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const names = out
      .split(/\r?\n/)
      .filter((l) => /^Path = /.test(l))
      .map((l) => l.slice(7).trim())
      .filter((n) => n && !n.includes('=') && !/[/\\]$/.test(n))
    /** -slt 会先输出一行 `Path = <包本身>`，不排掉就被当成成员数 */
    const members = names.filter((n) => path.normalize(n) !== path.normalize(file) && !n.toLowerCase().endsWith(path.basename(file).toLowerCase()))
    return { names: members, all: names }
  } catch (e) {
    return { err: String(e && e.message ? e.message : e).slice(0, 140) }
  }
}

if (fs.existsSync(DB_FILE) && fs.existsSync(SEVEN)) {
  const db = new Database(DB_FILE, { readonly: true })
  const arch = db
    .prepare(
      `select id, name, kind, library_path, source_path, size_bytes from asset
        where parent_asset_id is null and attachment_kind is null
          and (lower(coalesce(library_path, source_path)) like '%.zip' or lower(coalesce(library_path, source_path)) like '%.rar'
               or lower(coalesce(library_path, source_path)) like '%.7z')
        order by size_bytes desc`
    )
    .all()
  db.close()
  /** 体积降序取一半 + 升序取一半，免得只量到大的；去重，否则 DEEP 大了会把同一个包数两遍 */
  const half = Math.max(1, Math.floor(DEEP / 2))
  const picked = [...new Set([...arch.slice(0, half), ...arch.slice(-half)])]
  console.log(`\n=== 抽 ${picked.length} / ${arch.length} 个顶层压缩包卡列成员（7z 逐个起进程，慢）===`)
  let withUp = 0
  let totalUp = 0
  let maxDepthSeen = 0
  /** 内层包在包内的层数分布：段数 ≥2 的那些，现在的 digUnitypackages 定位不到（basename 找不到文件） */
  const upDepth = new Map()
  let digBroken = 0
  let digOk = 0
  /** 按扩展名分开统计：rar 走不了流式，这条限制到底咬不咬人要看它 */
  const byExt = new Map()
  let upBytes = 0
  let maxUp = 0
  let nestedArchives = 0
  const perArchive = new Map()
  for (const r of picked) {
    const p = r.library_path || r.source_path
    const m = /\.([a-z0-9]+)$/i.exec(p)
    const ext = (m ? m[1] : '?').toLowerCase()
    const st = byExt.get(ext) || { n: 0, withUp: 0, ups: 0 }
    st.n++
    const { names, err } = listMembers(p)
    if (err) {
      console.log(`  [列不出来] ${r.name} → ${err}`)
      byExt.set(ext, st)
      continue
    }
    const ups = (names || []).filter((n) => UP_RE.test(n))
    const depth = ups.length ? Math.max(...ups.map((n) => n.split(/[/\\]/).length)) : 0
    maxDepthSeen = Math.max(maxDepthSeen, depth)
    if (ups.length) {
      withUp++
      totalUp += ups.length
      st.withUp++
      st.ups += ups.length
      perArchive.set(r.name, ups.length)
      for (const u of ups) {
        const d = u.split(/[/\\]/).length
        upDepth.set(d, (upDepth.get(d) || 0) + 1)
        if (d > 1) digBroken++
        else digOk++
      }
    }
    if (names.some((n) => ARCHIVE_RE.test(n))) nestedArchives++
    byExt.set(ext, st)
    console.log(
      `  ${String(ups.length).padStart(3)} 个内层包 / 共 ${String(names.length).padStart(4)} 条，最深 ${depth} 层，` +
        `${((r.size_bytes || 0) / 1048576).toFixed(0)} MB [${ext}] ${r.name.slice(0, 36)}`
    )
  }
  console.log(`\n  → 抽样里 ${withUp}/${picked.length} 个含 .unitypackage，合计 ${totalUp} 个，成员路径最深 ${maxDepthSeen} 层`)
  console.log(
    `  → 内层包在包内的段数分布：${[...upDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}段:${n}`).join('  ')}` +
      `；其中 **${digBroken} 个现在的 digUnitypackages 定位不到**（用 basename 找，落在子目录），${digOk} 个能找到`
  )
  console.log('  → 按扩展名：' + [...byExt.entries()].map(([e, s]) => `${e}: ${s.n} 张卡/${s.withUp} 张含包/${s.ups} 个包`).join('   '))
  console.log(`  → 里面还套着压缩包（zip 里有 zip/rar）的卡：${nestedArchives} 张`)
  const hist = new Map()
  for (const n of perArchive.values()) {
    const k = n === 1 ? '1 个' : n <= 5 ? '2-5 个' : n <= 20 ? '6-20 个' : '>20 个'
    hist.set(k, (hist.get(k) || 0) + 1)
  }
  console.log(`  → 每张含包卡里的内层包个数分布：${[...hist.entries()].map(([k, n]) => `${k}:${n} 张`).join('  ')}`)

}
