import iconv from 'iconv-lite'
import os from 'node:os'

/**
 * 文本/文件名解码。日文素材的 zip 文件名和 txt 十有八九是 cp932(Shift-JIS)，
 * 按 UTF-8 硬解会得到乱码或 U+FFFD —— 这是这个库的必踩坑（第 1 份 §12 坑 5）。
 *
 * 顺序：UTF-8(BOM) → UTF-8(严格) → cp932 / GBK / EUC-JP 候选评分。
 * iconv-lite 解 cp932/GBK 时不会抛错（未知字节静默变成 ? ），所以"不抛错"不能只靠 try/catch，
 * 必须再看有没有替换符 —— 这是上一版容易写错的地方。
 */

export type TextEncoding = 'UTF-8(BOM)' | 'UTF-8' | 'cp932' | 'GBK' | 'EUC-JP' | 'latin1' | 'empty'

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

function hasBadChars(s: string): boolean {
  // U+FFFD 替换符、NUL、以及孤立的代理项都算坏码
  if (s.includes('\uFFFD') || s.includes('\u0000')) return true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true
    }
  }
  return false
}

function suspiciousQuestionRatio(s: string): boolean {
  // cp932/GBK 解错时常见大量 '?' 或全角标点错位
  const q = (s.match(/\?/g) ?? []).length
  return s.length > 24 && q / s.length > 0.12
}

/**
 * cp932 和 GBK 解码**都不会抛错**，所以"取第一个不报错的"根本不够用：
 * 实测 `E:\vrc\A\插件\shinano表情\6117553 Shinano_FaceAnimation.rar.rar` 里的
 * 「FREE無料」字节是 9F6F C1CF，按 cp932 解成「FREE殪ﾁﾏ」也是"成功"的。
 * 只能给候选解码打分：假名是强正向信号，半角片假名是"GBK 字节被当 cp932 解"的典型产物。
 */
export function scoreDecoded(s: string): number {
  if (!s) return Number.NEGATIVE_INFINITY
  let score = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (c === 0xfffd) score -= 20
    else if (c >= 0xff61 && c <= 0xff9f) score -= 12 // 半角片假名
    else if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) score -= 10
    else if (c >= 0x3041 && c <= 0x30ff) score += 8 // 平假名 / 片假名：日文素材的强信号
    else if (c >= 0x4e00 && c <= 0x9fff) score += 2 // CJK 统一表意
    else if (c >= 0xac00 && c <= 0xd7af) score += 1
    else if (c < 0x80) score += 0.5
    else score -= 1
  }
  return score / Math.sqrt(s.length)
}

// EUC-JP 与 GBK 的假名字节区重叠，单靠假名/CJK 数量会让「時」与「箕」打平。
// 常见日中说明文用字只作平手时的弱证据；同时包括简体字，避免偏向日文而损坏 GBK。
const COMMON_CJK = new Set(
  [...('一二三四五六七八九十百千万年月日時分秒前後上下左右中大小高低新古長短全文名前場所種類色形' +
    '本書読説明使用方法設定変更確認必要利用規約禁止許可素材衣装表情髪顔目体耳手足入出取扱追加' +
    '更新修正専用無断転載個人商営利無料有料対象対応保存削除作成表示動画画像音楽注意問題解決' +
    '基本初期選択操作適応導着替改済日本語漢字汉化说明仅供个传平台时语们请文件设置备份错误' +
    '下载上传目录压缩包路径失败重新安装导入帮助测试许可资源版本免费购买步骤如何')]
)

function scoreCommonCjk(s: string): number {
  let common = 0
  for (const ch of s) if (COMMON_CJK.has(ch)) common++
  return s.length > 0 ? common / Math.sqrt(s.length) : 0
}

/** 系统 ANSI 码页决定"平手时偏向谁"：中文 Windows 上 GBK 更可能是对的 */
function preferGbkOnTie(): boolean {
  try {
    const withLocale = os as typeof os & { locale?: () => string }
    const loc = typeof withLocale.locale === 'function' ? withLocale.locale() : Intl.DateTimeFormat().resolvedOptions().locale
    return /^zh/i.test(loc ?? '')
  } catch {
    return false
  }
}

export function decodeUtf8Strict(buf: Buffer): string | null {
  try {
    return UTF8_STRICT.decode(buf)
  } catch {
    return null
  }
}

export interface DecodedText {
  text: string
  encoding: TextEncoding
}

export function decodeText(buf: Buffer): DecodedText {
  if (buf.length === 0) return { text: '', encoding: 'empty' }

  // UTF-16 with BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'UTF-8' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]
      swapped[i] = swapped[i + 1]
      swapped[i + 1] = t
    }
    return { text: swapped.toString('utf16le'), encoding: 'UTF-8' }
  }
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    const s = buf.toString('utf8', 3)
    if (!hasBadChars(s)) return { text: s, encoding: 'UTF-8(BOM)' }
  }
  // 纯 ASCII 直接算 UTF-8
  const pureAscii = buf.every((b) => b < 0x80)
  if (pureAscii) return { text: buf.toString('ascii'), encoding: 'UTF-8' }

  const asUtf8 = decodeUtf8Strict(buf)
  if (asUtf8 !== null && !hasBadChars(asUtf8)) return { text: asUtf8, encoding: 'UTF-8' }

  const asCp932 = iconv.decode(buf, 'cp932')
  const asGbk = iconv.decode(buf, 'gbk')
  const sCp = scoreDecoded(asCp932)
  const sGbk = scoreDecoded(asGbk)
  const gbkWins = sGbk > sCp || (sGbk === sCp && preferGbkOnTie())
  const winner = gbkWins ? { text: asGbk, encoding: 'GBK' as const } : { text: asCp932, encoding: 'cp932' as const }

  // 保留 cp932 / GBK 的既有优先级，只有 EUC-JP 提供更强证据时才替换。
  const asEucJp = iconv.decode(buf, 'euc-jp')
  if (!hasBadChars(asEucJp) && !suspiciousQuestionRatio(asEucJp)) {
    const sEucJp = scoreDecoded(asEucJp)
    const winnerScore = gbkWins ? sGbk : sCp
    // 单字「時/箕」的原始字节完全相同，弱用字提示不能覆盖既有判断。
    const enoughEvidence = (asEucJp.match(/[\u3041-\u30ff]/g)?.length ?? 0) >= 2 ||
      [...asEucJp].filter(ch => COMMON_CJK.has(ch)).length >= 2
    if (sEucJp > winnerScore ||
      (sEucJp === winnerScore && enoughEvidence && scoreCommonCjk(asEucJp) > scoreCommonCjk(winner.text))) {
      return { text: asEucJp, encoding: 'EUC-JP' }
    }
  }
  if (!hasBadChars(winner.text) && !suspiciousQuestionRatio(winner.text)) return winner

  // 全都不干净：用 latin1 兜底。它能把每个字节都映射成一个字符，
  // 绝不产生 U+FFFD —— 文件名/条目名里带替换符会变成没法点击的垃圾路径。
  return { text: buf.toString('latin1').replace(/\u0000/g, ''), encoding: 'latin1' }
}

/**
 * zip 条目名：flag bit 11 表示"声明是 UTF-8"。
 * 没声明时字节可能是 cp932 / GBK / EUC-JP / 裸 UTF-8 —— 先按 UTF-8 严格试，
 * 失败后候选评分，最后用 latin1 无替换符兜底。
 */
export function decodeZipName(raw: Buffer, declaredUtf8: boolean): { name: string; encoding: TextEncoding } {
  if (declaredUtf8) {
    const s = decodeUtf8Strict(raw)
    if (s !== null) return { name: s, encoding: 'UTF-8' }
  }
  const d = decodeText(raw)
  return { name: d.text, encoding: d.encoding }
}

/** 归一化路径分隔符并去掉首尾空白，供后续 safeJoin 使用 */
export function normalizeEntryPath(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.\/+/, '').trim()
}
