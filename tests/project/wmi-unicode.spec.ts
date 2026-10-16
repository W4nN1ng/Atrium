import { expect, it, vi } from 'vitest'

// Run the real PowerShell transport with a controlled process row. Keep the
// production encoding preamble, replacing only the external process query.
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile(file: string, args: string[], options: any, callback: any) {
    const argv = [...args], index = argv.indexOf('-EncodedCommand') + 1
    const script = Buffer.from(argv[index], 'base64').toString('utf16le')
    const row = '31415|Unity.exe -projectPath "E:/隔离项目/模型"'
    const controlled = script.replace(/try\s*\{[\s\S]*\}\s*$/, `Write-Output '${row}'`)
    if (controlled === script) throw Error('Production PowerShell query boundary changed')
    argv[index] = Buffer.from(controlled, 'utf16le').toString('base64')
    return actual.execFile(file, argv, options, callback)
  } }
})

import { probeUnityProcesses } from '../../src/main/project/wmi'

it.runIf(process.platform === 'win32')('preserves Chinese project paths through real PowerShell stdout', async () => {
  const result = await probeUnityProcesses({ timeoutMs: 15000 })
  expect(result.error).toBeNull()
  expect(result.projects).toEqual([{ pid: 31415, projectPath: 'E:\\隔离项目\\模型' }])
})
