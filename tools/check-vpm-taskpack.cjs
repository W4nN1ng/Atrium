/**
 * VPM 任务包一致性检查（只读，无依赖）。
 *
 * 检查：
 *  - tasks/ 里的任务卡与 VPM-TASKS.md 总表一一对应，ID 不重复；
 *  - VPM-PARITY.md 中“完整/部分/额外”的行至少被一张任务卡覆盖；
 *  - 任务卡引用的阶段规格章节确实存在；
 *  - 文档里的相对链接都能落地。
 *
 * 用法：node tools/check-vpm-taskpack.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TASKS = path.join(ROOT, 'docs', 'prompts', 'tasks')
const BOARD = path.join(ROOT, 'docs', 'VPM-TASKS.md')
const PARITY = path.join(ROOT, 'docs', 'VPM-PARITY.md')

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

function check() {
  const errors = []
  const files = fs
    .readdirSync(TASKS)
    .filter((name) => /^P\d-[A-E]\.md$/.test(name))
    .sort()
  const fileIds = files.map((name) => name.replace(/\.md$/, ''))
  const board = read(BOARD)
  const boardIds = [...board.matchAll(/^\| (P\d-[A-E]) \|/gm)].map((m) => m[1])

  if (fileIds.length !== boardIds.length) {
    errors.push(`任务卡 ${fileIds.length} 张，任务板 ${boardIds.length} 行`)
  }
  for (const id of new Set(boardIds)) {
    if (boardIds.filter((x) => x === id).length > 1) errors.push(`任务板 ID 重复：${id}`)
  }
  for (const id of boardIds) if (!fileIds.includes(id)) errors.push(`任务板有、任务卡缺：${id}`)
  for (const id of fileIds) if (!boardIds.includes(id)) errors.push(`任务卡有、任务板缺：${id}`)

  const cards = Object.fromEntries(
    files.map((name) => [name.replace(/\.md$/, ''), read(path.join(TASKS, name))])
  )
  const allCards = Object.values(cards).join('\n')

  const parity = read(PARITY)
  const wanted = []
  for (const line of parity.split('\n')) {
    const m = /^\| ([A-I]\d+) \| .*? \| (完整|部分|额外) \|/.exec(line)
    if (m) wanted.push(m[1])
  }
  for (const id of new Set(wanted)) {
    const re = new RegExp('(^|[^A-Za-z0-9])' + id + '([^A-Za-z0-9]|$)')
    if (!re.test(allCards)) errors.push(`对账项没有任务卡覆盖：${id}`)
  }

  const stageNums = {}
  for (let n = 0; n <= 9; n++) {
    const file = path.join(ROOT, 'docs', 'prompts', `VPM-P${n}.md`)
    const text = read(file)
    stageNums[`P${n}`] = new Set(
      [...text.matchAll(/^#{2,3}\s+([0-9]+(?:\.[0-9]+)?)[.、\s]/gm)].map((m) => m[1])
    )
  }
  for (const [id, text] of Object.entries(cards)) {
    const stage = (/阶段规格：`\.\.\/VPM-(P\d)\.md`/.exec(text) || [])[1]
    if (!stage) {
      errors.push(`${id} 没有阶段规格引用`)
      continue
    }
    const ref = (/只读 ([^\n]+)/.exec(text) || [])[1] || ''
    for (const m of ref.matchAll(/§([0-9]+(?:\.[0-9]+)?)/g)) {
      if (!stageNums[stage].has(m[1])) errors.push(`${id} 引用不存在的 ${stage} §${m[1]}`)
    }
  }

  const docs = [
    'docs/VPM-ARCHITECTURE.md',
    'docs/VPM-TASKS.md',
    'docs/VPM-PARITY.md',
    'docs/VPM-MERGE-PLAN.md',
    'docs/VPM-IMPLEMENTATION-GUIDE.md',
    'docs/VPM-CLEANROOM.md',
    'docs/VPM-ROLLBACK.md',
    'docs/DEVELOPMENT.md',
    'docs/HANDOVER.md',
    'docs/prompts/README.md',
    'docs/prompts/_COMMON.md',
    ...files.map((name) => `docs/prompts/tasks/${name}`),
    ...Array.from({ length: 10 }, (_, i) => `docs/prompts/VPM-P${i}.md`)
  ]
  for (const relative of docs) {
    const file = path.join(ROOT, relative)
    const text = read(file)
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1].split('#')[0]
      if (!target || /^(https?:|mailto:)/.test(target)) continue
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
        errors.push(`${relative} 链接失效：${m[1]}`)
      }
    }
  }

  if (errors.length) {
    console.error('✗ VPM 任务包检查失败：')
    for (const error of errors) console.error('  - ' + error)
    process.exit(1)
  }
  console.log(`✓ VPM 任务包一致：${fileIds.length} 张任务卡、${new Set(wanted).size} 个对账项`)
}

check()
