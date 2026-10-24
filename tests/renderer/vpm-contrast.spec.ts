import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const CSS = path.join(ROOT, 'src', 'renderer', 'styles.css')

function block(source: string, selector: string): Record<string, string> {
  const match = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(source)
  if (!match) throw new Error(`missing ${selector}`)
  const out: Record<string, string> = {}
  for (const item of match[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[item[1]] = item[2].slice(1)
  }
  return out
}

function luminance(hex: string): number {
  const channels = hex.match(/../g)?.map((part) => parseInt(part, 16) / 255) ?? []
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('VPM/theme contrast (P8-E)', () => {
  const css = fs.readFileSync(CSS, 'utf8')
  const themes = {
    dark: block(css, ':root,\\s*html\\.dark'),
    light: block(css, 'html\\.light')
  }

  for (const [name, colors] of Object.entries(themes)) {
    it(`${name} normal text meets WCAG AA (4.5:1) on panel and background`, () => {
      const pairs: Array<[string, string, string]> = [
        ['text/panel', colors.text, colors.panel],
        ['text/bg', colors.text, colors.bg],
        ['muted/panel', colors.muted, colors.panel],
        ['muted/bg', colors.muted, colors.bg],
        ['faint/panel', colors.faint, colors.panel],
        ['faint/bg', colors.faint, colors.bg],
        ['bad/panel', colors.bad, colors.panel],
        ['bad/bg', colors.bad, colors.bg],
        ['warn/panel', colors.warn, colors.panel],
        ['warn/bg', colors.warn, colors.bg],
        ['ok/panel', colors.ok, colors.panel],
        ['ok/bg', colors.ok, colors.bg],
        ['accent/panel', colors.accent, colors.panel],
        ['accent/bg', colors.accent, colors.bg],
        ['white/accent-strong', 'ffffff', colors['accent-strong']]
      ]
      for (const [label, foreground, background] of pairs) {
        expect(foreground, `${name} ${label} missing color`).toBeTruthy()
        expect(background, `${name} ${label} missing background`).toBeTruthy()
        const ratio = contrast(foreground, background)
        expect(ratio, `${name} ${label}=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
