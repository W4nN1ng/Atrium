import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VpmDataRootPick, VpmStatus } from '../../src/shared/vpm/types'

const status = { enabled: false, safeMode: false } as VpmStatus
const pick: VpmDataRootPick = { path: null, validation: null }

let vpm: {
  status: ReturnType<typeof vi.fn>
  enable: ReturnType<typeof vi.fn>
  disable: ReturnType<typeof vi.fn>
  pickDataRoot: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.resetModules()
  vpm = {
    status: vi.fn(async () => status),
    enable: vi.fn(async () => status),
    disable: vi.fn(async () => status),
    pickDataRoot: vi.fn(async () => pick)
  }
  ;(globalThis as { window?: unknown }).window = { a: { vpm } }
})

describe('renderer/vpm/api', () => {
  it('forwards the four P0 calls with their original arguments', async () => {
    const { vpmApi } = await import('../../src/renderer/vpm/api')

    await expect(vpmApi.status()).resolves.toBe(status)
    await expect(vpmApi.enable('E:\\AtriumVPM')).resolves.toBe(status)
    await expect(vpmApi.disable()).resolves.toBe(status)
    await expect(vpmApi.pickDataRoot()).resolves.toBe(pick)

    expect(vpm.status).toHaveBeenCalledTimes(1)
    expect(vpm.enable).toHaveBeenCalledWith('E:\\AtriumVPM')
    expect(vpm.disable).toHaveBeenCalledTimes(1)
    expect(vpm.pickDataRoot).toHaveBeenCalledTimes(1)
  })
})
