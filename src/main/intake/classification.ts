import fs from 'node:fs'
import path from 'node:path'
import type { IngestResult } from '../../shared/types'
import type { PreparedIntakePlan, PreparedUnit } from '../../shared/intake'
import { extractMetadata } from '../fingerprint/metadata'
import { classify, type ClassifyDeps } from '../classify/engine'
import { parseUnitypackage } from '../unpack/unitypackage'
import { safeJoin } from '../security/paths'

/** R21: source semantics survive filename sanitizing and library placement. */
export async function classifyPublishedUnit(plan: PreparedIntakePlan, unit: PreparedUnit, deps: ClassifyDeps) {
  const entries = unit.normalizedEntries.map(e => ({ ...e }))
  const sourceDirChain = path.dirname(plan.scanRoot).split(/[\\/]/).filter(s => s && !/^[a-z]:$/i.test(s)).slice(-4)
  const rawName = unit.displayName
  const metadata = await extractMetadata({ fileName: rawName, dirChain: sourceDirChain, reader: {
    files: () => entries,
    async readText(rel, maxBytes = 65536) {
      const file = safeJoin(unit.libraryPath, rel)
      if (!file) return null
      const st = await fs.promises.stat(file)
      if (!st.isFile() || st.size > maxBytes) return null
      return fs.promises.readFile(file, 'utf8')
    }
  } })
  // Keep the established Unity metadata signals, without expanding GUID content into the material tree.
  const extra: IngestResult['entries'] = []
  for (const entry of entries.filter(e => /\.unitypackage$/i.test(e.relPath) && e.size > 0 && e.size <= 300 * 1024 * 1024).slice(0, 12)) {
    const file = safeJoin(unit.libraryPath, entry.relPath)
    if (!file) continue
    const parsed = await parseUnitypackage(file, { scanRefs: false, maxEntries: 1200 })
    if (!parsed.ok) continue
    for (const item of parsed.entries) extra.push({ relPath: item.unityPath, size: 0, ext: path.extname(item.unityPath), isDir: false })
    if (parsed.hasEditorScript) extra.push({ relPath: 'Editor/dig.cs', size: 0, ext: '.cs', isDir: false })
    if (parsed.hasShader) extra.push({ relPath: 'dig.shader', size: 0, ext: '.shader', isDir: false })
  }
  const ingest: IngestResult = { assetId: unit.assetId ?? unit.id, rawName, sourceDirChain, stagingPath: unit.libraryPath,
    sourceArchivePath: unit.sources[0], detectedKind: 'folder', detectedFormat: 'dir', entries: [...entries, ...extra], metadata,
    nestedDepth: 0, totalBytes: entries.reduce((sum, e) => sum + e.size, 0), warnings: plan.warnings }
  return { ingest, classification: classify(ingest, deps) }
}
