import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const VPM = path.join(ROOT, 'src', 'renderer', 'vpm')
const UI = path.join(ROOT, 'src', 'renderer', 'components', 'ui.tsx')

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (entry.name.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

function openingTags(source: string, tag: string): string[] {
  const needle = `<${tag}`
  const out: string[] = []
  let from = 0
  while (true) {
    const start = source.indexOf(needle, from)
    if (start < 0) break
    let depth = 0
    let quote: string | null = null
    let end = -1
    for (let index = start + needle.length; index < source.length; index++) {
      const char = source[index]
      if (quote) {
        if (char === '\\') {
          index++
          continue
        }
        if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        continue
      }
      if (char === '{') depth++
      else if (char === '}') depth = Math.max(0, depth - 1)
      else if (char === '>' && depth === 0) {
        end = index + 1
        break
      }
    }
    if (end < 0) break
    out.push(source.slice(start, end))
    from = end
  }
  return out
}

describe('VPM accessibility guard (P8-E)', () => {
  it('gives every VPM Modal a title', () => {
    const failures: string[] = []
    for (const file of walk(VPM)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const tag of openingTags(source, 'Modal')) {
        if (!/\btitle=/.test(tag)) failures.push(path.relative(ROOT, file))
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('gives every VPM Switch an accessible name', () => {
    const failures: string[] = []
    for (const file of walk(VPM)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const tag of openingTags(source, 'Switch')) {
        if (!/\bariaLabel=/.test(tag)) failures.push(path.relative(ROOT, file))
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('does not use fake button roles inside VPM cards', () => {
    const failures: string[] = []
    for (const file of walk(VPM)) {
      const source = fs.readFileSync(file, 'utf8')
      if (/role="button"/.test(source)) failures.push(path.relative(ROOT, file))
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps the shared row menu keyboard-semantic and the operation dialog announced', () => {
    const ui = fs.readFileSync(UI, 'utf8')
    expect(ui).toContain('aria-haspopup="menu"')
    expect(ui).toContain('aria-expanded={open}')
    expect(ui).toContain('role="menu"')
    expect(ui).toContain('role="menuitem"')
    expect(ui).toContain("event.key === 'ArrowDown'")
    expect(ui).toContain("event.key === 'Escape'")

    const dialog = fs.readFileSync(
      path.join(VPM, 'components', 'packages', 'VpmOperationDialog.tsx'),
      'utf8'
    )
    expect(dialog).toContain('role="status"')
    expect(dialog).toContain('aria-live="polite"')
    expect(dialog).toContain('role="alert"')
  })

  it('marks package/plan/maintenance errors as alerts', () => {
    for (const relative of [
      'components/packages/VpmApplyPlanSheet.tsx',
      'components/plan/VpmPlanSheet.tsx',
      'components/CatalogDialog.tsx',
      'components/projects/VpmCreateProjectDialog.tsx',
      'components/projects/VpmMaintenancePanel.tsx',
      'components/log/MaintenanceLogPanel.tsx'
    ]) {
      const source = fs.readFileSync(path.join(VPM, relative), 'utf8')
      expect(source, relative).toContain('role="alert"')
    }
  })
})
