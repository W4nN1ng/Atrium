import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MemorySecretStore,
  createSafeStorageSecretStore,
  packageScope,
  redactHeaders,
  repoScope,
  validateSecretHeaders,
  type SafeStorageLike
} from '../../../src/main/vpm/secrets'

let root: string
let file: string

/** 假 safeStorage：可逆的"加密"，用来验证落盘没有明文。 */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(value, 'utf8').reverse(),
    decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString('utf8')
  }
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-secrets-'))
  file = path.join(root, 'secrets.json')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('header validation', () => {
  it('normalizes names and rejects dangerous ones', () => {
    expect(validateSecretHeaders({ Authorization: 'Bearer x' })).toEqual({ authorization: 'Bearer x' })
    for (const bad of [
      { cookie: 'a=b' },
      { host: 'evil.test' },
      { 'content-length': '1' },
      { 'bad name': 'x' },
      { authorization: 'a\nb' },
      { authorization: '' }
    ]) {
      expect(codeOf(() => validateSecretHeaders(bad)), JSON.stringify(bad)).toBe('vpmSecretInvalid')
    }
    expect(codeOf(() => validateSecretHeaders({}))).toBe('vpmSecretInvalid')
  })

  it('redacts values for logs', () => {
    expect(redactHeaders({ authorization: 'Bearer secret' })).toEqual({ authorization: '***' })
  })
})

describe('memory store', () => {
  it('round-trips headers and only lists names', () => {
    const store = new MemorySecretStore()
    store.set(repoScope('repo-1'), { authorization: 'Bearer x' })
    expect(store.get(repoScope('repo-1'))).toEqual({ authorization: 'Bearer x' })
    expect(store.list()).toEqual([{ scope: 'repo:repo-1', names: ['authorization'] }])
    store.clear(repoScope('repo-1'))
    expect(store.get(repoScope('repo-1'))).toBeNull()
  })

  it('scopes packages per repo', () => {
    expect(packageScope('repo-1', 'Com.Example.A')).toBe('package:repo-1/com.example.a')
  })
})

describe('safeStorage store', () => {
  it('writes only ciphertext to disk', () => {
    const store = createSafeStorageSecretStore({ safeStorage: fakeSafeStorage(), file })
    store.set(repoScope('repo-1'), { authorization: 'Bearer super-secret' })

    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).not.toContain('super-secret')
    expect(raw).not.toContain('Bearer')
    expect(store.get(repoScope('repo-1'))).toEqual({ authorization: 'Bearer super-secret' })
  })

  it('refuses to store anything when encryption is unavailable', () => {
    const store = createSafeStorageSecretStore({ safeStorage: fakeSafeStorage(false), file })
    expect(store.available()).toBe(false)
    expect(codeOf(() => store.set(repoScope('r'), { authorization: 'x' }))).toBe('vpmSecretUnavailable')
    expect(fs.existsSync(file)).toBe(false)
    expect(store.get(repoScope('r'))).toBeNull()
  })

  it('treats undecryptable entries as missing instead of throwing', () => {
    const store = createSafeStorageSecretStore({ safeStorage: fakeSafeStorage(), file })
    store.set(repoScope('r'), { authorization: 'x' })
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { 'repo:r': { data: '!!!' } } }))
    expect(store.get(repoScope('r'))).toBeNull()
  })

  it('lists scopes without exposing values', () => {
    const store = createSafeStorageSecretStore({ safeStorage: fakeSafeStorage(), file })
    store.set(repoScope('a'), { authorization: 'x', 'x-api-key': 'y' })
    const listed = store.list()
    expect(listed).toEqual([{ scope: 'repo:a', names: ['authorization', 'x-api-key'] }])
    expect(JSON.stringify(listed)).not.toContain('x-api-key":"')
  })
})
