/**
 * Encoding detection for git output and diff content.
 *
 * Windows repositories routinely contain GBK/GB18030 encoded sources next to
 * UTF-8 files, so the backend never assumes UTF-8: every stream is split on the
 * relevant ASCII separators first and each fragment is decoded on its own with
 * `decodeSmart`. The detected encoding is surfaced on `DiffFile.encoding` so the
 * UI can show e.g. "编码 GB18030".
 */

export type DetectedEncoding = 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be'

export interface DecodedText {
  text: string
  encoding: DetectedEncoding
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

/** Splits a byte buffer on a single ASCII separator byte (e.g. NUL or LF). */
export function splitBuffer(buffer: Buffer, separator: number): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== separator) continue
    parts.push(buffer.subarray(start, index))
    start = index + 1
  }
  parts.push(buffer.subarray(start))
  return parts
}

function decodeUtf8Strict(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeGb18030Strict(bytes: Buffer): string | null {
  try {
    return new TextDecoder('gb18030', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeUtf16Le(bytes: Buffer): string {
  return new TextDecoder('utf-16le').decode(bytes)
}

function swap16(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes)
  for (let index = 0; index + 1 < copy.length; index += 2) {
    const first = copy[index]
    copy[index] = copy[index + 1]
    copy[index + 1] = first
  }
  return copy
}

/**
 * Decodes bytes using, in order:
 *   1. a byte-order mark (UTF-8 / UTF-16LE / UTF-16BE),
 *   2. strict UTF-8 (fatal decoder),
 *   3. strict GB18030 (covers GBK / GB2312),
 *   4. UTF-8 with U+FFFD replacement as a last resort.
 */
export function decodeSmart(buffer: Buffer): DecodedText {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM)) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8' }
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(UTF16LE_BOM)) {
    return { text: decodeUtf16Le(buffer.subarray(2)), encoding: 'utf-16le' }
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(UTF16BE_BOM)) {
    return { text: decodeUtf16Le(swap16(buffer.subarray(2))), encoding: 'utf-16be' }
  }

  const utf8 = decodeUtf8Strict(buffer)
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' }

  const gb = decodeGb18030Strict(buffer)
  if (gb !== null) return { text: gb, encoding: 'gb18030' }

  return { text: buffer.toString('utf8'), encoding: 'utf-8' }
}

/** Convenience wrapper for callers that only need the text. */
export function decodeSmartText(buffer: Buffer): string {
  return decodeSmart(buffer).text
}

/** Decodes LF separated output line by line (trailing CR stripped per line). */
export function decodeLines(buffer: Buffer): DecodedText[] {
  return splitBuffer(buffer, 0x0a).map((part) => {
    const decoded = decodeSmart(part)
    return {
      text: decoded.text.endsWith('\r') ? decoded.text.slice(0, -1) : decoded.text,
      encoding: decoded.encoding
    }
  })
}

/** Decodes NUL separated output token by token (for `-z` porcelain). */
export function decodeNulTokens(buffer: Buffer): DecodedText[] {
  return splitBuffer(buffer, 0).map((part) => decodeSmart(part))
}

/** Picks the most specific encoding seen among a file's diff lines. */
export function mergeEncodings(encodings: Iterable<DetectedEncoding>): DetectedEncoding {
  let result: DetectedEncoding = 'utf-8'
  for (const encoding of encodings) {
    if (encoding === 'utf-16le' || encoding === 'utf-16be') return encoding
    if (encoding === 'gb18030') result = 'gb18030'
  }
  return result
}
