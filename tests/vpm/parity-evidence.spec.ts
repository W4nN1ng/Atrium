import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const PARITY = path.join(ROOT, 'docs', 'VPM-PARITY.md')
const GAPS = path.join(ROOT, 'docs', 'VPM-GAPS.md')

interface Row {
  id: string
  target: string
  actual: string
  evidence: string
  destination: string
}

function rows(): Row[] {
  const text = fs.readFileSync(PARITY, 'utf8')
  const out: Row[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\|\s*([A-K]\d+)\s*\|/.exec(line)
    if (!match) continue
    const cells = line.split('|')
    if (cells.length !== 8) throw new Error(`bad columns for ${match[1]}`)
    const audit = cells[6]
    const get = (name: string): string =>
      (new RegExp(`${name}=([^；]+)`).exec(audit) ?? [])[1]?.trim() ?? ''
    out.push({
      id: match[1],
      target: cells[3].trim(),
      actual: get('实际'),
      evidence: get('证据'),
      destination: get('去向')
    })
  }
  return out
}

describe('VPM-PARITY evidence (P8-D)', () => {
  it('has every A-K row with actual status, evidence, difference and destination', () => {
    const all = rows()
    expect(all).toHaveLength(124)
    const ids = all.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K']) {
      expect(ids.some((id) => id.startsWith(group)), `missing group ${group}`).toBe(true)
    }
    for (const row of all) {
      expect(['完整', '部分', '不做'], `${row.id} actual`).toContain(row.actual)
      expect(row.evidence, `${row.id} evidence`).not.toBe('')
      expect(row.destination, `${row.id} destination`).not.toBe('')
      expect(row.destination, `${row.id} destination`).not.toMatch(/待定|未开始|TODO/)
    }
  })

  it('keeps not-done rows only where the target is not-done', () => {
    for (const row of rows().filter((item) => item.actual === '不做')) {
      expect(row.target, `${row.id} target`).toBe('不做')
    }
  })

  it('routes every partial row to a gap, a known limitation or a product decision', () => {
    for (const row of rows().filter((item) => item.actual === '部分')) {
      expect(row.destination, `${row.id} destination`).toMatch(/GAP-|已知限制|产品裁定|接受/)
    }
  })

  it('lists every target-complete-but-partial row in VPM-GAPS', () => {
    const gapText = fs.readFileSync(GAPS, 'utf8')
    const bad = rows().filter((item) => item.target === '完整' && item.actual === '部分')
    expect(bad.length).toBeGreaterThan(0)
    for (const row of bad) {
      expect(gapText, `${row.id} missing from VPM-GAPS`).toMatch(new RegExp(`\\b${row.id}\\b`))
    }
    for (const id of ['GAP-01', 'GAP-02', 'GAP-03', 'GAP-04', 'GAP-05', 'GAP-06', 'GAP-07', 'GAP-08', 'GAP-09', 'GAP-10']) {
      expect(gapText).toContain(id)
    }
  })

  it('does not claim a complete row without evidence', () => {
    for (const row of rows().filter((item) => item.actual === '完整')) {
      expect(row.evidence.length, `${row.id} evidence`).toBeGreaterThan(3)
      expect(row.evidence, `${row.id} evidence`).not.toBe('无')
    }
  })
})
