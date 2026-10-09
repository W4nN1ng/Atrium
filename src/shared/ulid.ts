/**
 * 26 字符 ULID（Crockford base32）。
 * 自己实现而不是装 `ulid` 包：逻辑不到 60 行，少一个运行时依赖，
 * 而且这里需要"同一毫秒内单调递增"以保证按 id 排序即按创建时间排序。
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastTime = 0
let lastRandom: number[] = []

function encodeTime(msec: number, length: number): string {
  let str = ''
  let t = msec
  for (let i = length; i > 0; i--) {
    const mod = t % 32
    str = ENCODING[mod] + str
    t = Math.floor(t / 32)
  }
  return str
}

function randomChars(length: number): string {
  let out = ''
  const buf = new Uint8Array(length)
  // node 18+ 有全局 crypto；主进程与 worker 都能用
  globalThis.crypto.getRandomValues(buf)
  for (let i = 0; i < length; i++) out += ENCODING[buf[i] % 32]
  return out
}

function incrementRandom(prev: number[]): string {
  const digits = [...prev]
  let i = digits.length - 1
  for (; i >= 0; i--) {
    if (digits[i] + 1 <= 31) {
      digits[i] += 1
      break
    }
    digits[i] = 0
  }
  if (i === -1) throw new Error('ULID: same-millisecond entropy exhausted')
  return digits.map((d) => ENCODING[d]).join('')
}

export function ulid(seedTime?: number): string {
  const time = seedTime ?? Date.now()
  const chars = encodeTime(time, 10)
  if (time <= lastTime) {
    const next = incrementRandom(lastRandom)
    lastRandom = next.split('').map((c) => ENCODING.indexOf(c))
    return chars + next
  }
  lastTime = time
  const rnd = randomChars(16)
  lastRandom = rnd.split('').map((c) => ENCODING.indexOf(c))
  return chars + rnd
}

export function decodeTime(id: string): number {
  let t = 0
  for (let i = 0; i < 10; i++) t = t * 32 + ENCODING.indexOf(id[i])
  return t
}

export function isValidUlid(id: string): boolean {
  return id.length === 26 && [...id].every((c) => ENCODING.indexOf(c) >= 0)
}
