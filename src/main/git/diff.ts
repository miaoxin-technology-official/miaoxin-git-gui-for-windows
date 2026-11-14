import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DiffFile, DiffHunk, DiffLine, DiffOptions, DiffResult, FileStatus } from '@shared/types'
import { decodeSmart, splitBuffer, mergeEncodings, type DetectedEncoding } from './encoding'
import { assertSafeRef, gitFailure, runGit } from './exec'

/**
 * Unified diff parsing and the five diff sources used by the renderer.
 *
 * Encoding: git diff output is consumed as raw bytes and split on LF before any
 * decoding, then every line is decoded with `decodeSmart`. A patch can therefore
 * mix UTF-8 and GBK files without one file's bytes corrupting another's; hunk
 * text is decoded with the file's own encoding and surfaced as
 * `DiffFile.encoding`. The parser is also tolerant of new/deleted/renamed/copied
 * files, mode changes, binary files, submodule pointer changes and combined
 * (`diff --cc`) diffs that git emits for unresolved merges.
 */

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'tif',
  'tiff',
  'svg'
])

/** Extensions we are willing to re-diff as text when git reports "binary". */
const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'text',
  'json',
  'jsonc',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'xml',
  'yml',
  'yaml',
  'ini',
  'toml',
  'csv',
  'log',
  'sh',
  'ps1',
  'bat',
  'gitignore',
  'gitattributes',
  'env'
])

function extensionOf(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot === -1) return name.toLowerCase().replace(/^\./, '')
  return name.slice(dot + 1).toLowerCase()
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(filePath))
}

export function isTextPath(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(filePath))
}

/** Decodes git's C-style quoted paths ("a/..." with \ooo escapes) to UTF-8. */
export function unquoteGitPath(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('"')) return text
  const end = text.lastIndexOf('"')
  const body = end > 0 ? text.slice(1, end) : text.slice(1)
  const bytes: number[] = []
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'))
      continue
    }
    index += 1
    const next = body[index]
    if (next === undefined) break
    switch (next) {
      case 'n':
        bytes.push(10)
        break
      case 't':
        bytes.push(9)
        break
      case 'r':
        bytes.push(13)
        break
      case 'a':
        bytes.push(7)
        break
      case 'b':
        bytes.push(8)
        break
      case 'f':
        bytes.push(12)
        break
      case 'v':
        bytes.push(11)
        break
      case '"':
        bytes.push(34)
        break
      case '\\':
        bytes.push(92)
        break
      default: {
        if (next >= '0' && next <= '7') {
          let octal = next
          let taken = 1
          while (taken < 3) {
            const peek = body[index + 1]
            if (peek === undefined || peek < '0' || peek > '7') break
            index += 1
            octal += body[index]
            taken += 1
          }
          bytes.push(parseInt(octal, 8))
        } else {
          bytes.push(...Buffer.from(next, 'utf8'))
        }
      }
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function stripGitPrefix(rawPath: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (rawPath.startsWith(prefix)) return rawPath.slice(prefix.length)
  }
  return rawPath
}

/** `--- a/x` / `+++ b/x` payload (quotes, trailing tab) → repo-relative path. */
function headerPath(payload: string): string | null {
  let text: string
  if (payload.trimStart().startsWith('"')) {
    text = unquoteGitPath(payload.trimStart())
  } else {
    text = payload.endsWith('\t') ? payload.slice(0, -1) : payload
  }
  if (!text || text === '/dev/null' || text === 'NUL') return null
  return stripGitPrefix(text, ['a/', 'b/'])
}

interface DiffGitPaths {
  oldPath: string
  newPath: string
}

function parseDiffGitLine(line: string): DiffGitPaths | null {
  const quoted = /^diff --git ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(line)
  if (quoted) {
    return {
      oldPath: stripGitPrefix(unquoteGitPath(quoted[1]), ['a/']),
      newPath: stripGitPrefix(unquoteGitPath(quoted[2]), ['b/'])
    }
  }
  const rest = line.slice('diff --git '.length)
  const separator = rest.indexOf(' b/')
  if (rest.startsWith('a/') && separator > 0) {
    const rawOld = rest.slice(0, separator)
    const rawNew = rest.slice(separator + 1)
    return {
      oldPath: stripGitPrefix(unquoteGitPath(rawOld), ['a/']),
      newPath: stripGitPrefix(unquoteGitPath(rawNew), ['b/'])
    }
  }
  return null
}

interface HunkState {
  hunk: DiffHunk
  combined: boolean
  oldLine: number
  newLine: number
}

function parseHunkHeader(line: string, index: number, combined: boolean): HunkState | null {
  if (combined) {
    if (!/^@{3,} /.test(line)) return null
    const minusMatches = [...line.matchAll(/-(\d+)(?:,(\d+))?/g)]
    const plusMatch = /\+(\d+)(?:,(\d+))?/.exec(line)
    if (minusMatches.length === 0 || !plusMatch) return null
    const closeIndex = line.lastIndexOf('@@@')
    const section = closeIndex >= 0 ? line.slice(closeIndex + 3).trim() : ''
    const hunk: DiffHunk = {
      index,
      header: line,
      section,
      oldStart: Number(minusMatches[0][1]),
      oldLines: minusMatches[0][2] === undefined ? 1 : Number(minusMatches[0][2]),
      newStart: Number(plusMatch[1]),
      newLines: plusMatch[2] === undefined ? 1 : Number(plusMatch[2]),
      lines: []
    }
    return { hunk, combined: true, oldLine: hunk.oldStart, newLine: hunk.newStart }
  }
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[ \t]?(.*)$/.exec(line)
  if (!match) return null
  const hunk: DiffHunk = {
    index,
    header: line,
    section: match[5] ?? '',
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
    lines: []
  }
  return { hunk, combined: false, oldLine: hunk.oldStart, newLine: hunk.newStart }
}

/** One decoded patch line together with the encoding it was decoded with. */
export interface DecodedPatchLine {
  text: string
  encoding: DetectedEncoding
}

interface FileAccumulator {
  file: DiffFile
  modeOld: string | null
  modeNew: string | null
  headerOldPath: string | null
  headerNewPath: string | null
  renameFrom: string | null
  renameTo: string | null
  copyFrom: string | null
  copyTo: string | null
  combined: boolean
  explicitStatus: FileStatus | null
  encodings: Set<DetectedEncoding>
}

function createAccumulator(combined: boolean): FileAccumulator {
  return {
    file: {
      path: '',
      status: 'modified',
      binary: false,
      hunks: [],
      additions: 0,
      deletions: 0,
      mode: null,
      isImage: false
    },
    modeOld: null,
    modeNew: null,
    headerOldPath: null,
    headerNewPath: null,
    renameFrom: null,
    renameTo: null,
    copyFrom: null,
    copyTo: null,
    combined,
    explicitStatus: null,
    encodings: new Set<DetectedEncoding>()
  }
}

function finalizeAccumulator(acc: FileAccumulator): DiffFile | null {
  const file = acc.file
  if (acc.renameFrom || acc.renameTo) {
    file.status = 'renamed'
    file.oldPath = acc.renameFrom ?? file.oldPath
    file.path = acc.renameTo ?? file.path
  } else if (acc.copyFrom || acc.copyTo) {
    file.status = 'copied'
    file.oldPath = acc.copyFrom ?? file.oldPath
    file.path = acc.copyTo ?? file.path
  } else if (acc.explicitStatus) {
    file.status = acc.explicitStatus
    if (file.status === 'deleted') file.path = file.path || acc.headerOldPath || ''
    else file.path = file.path || acc.headerNewPath || ''
  } else if (file.status === 'deleted') {
    file.path = file.path || acc.headerOldPath || ''
  } else if (file.status === 'added') {
    file.path = file.path || acc.headerNewPath || ''
  } else {
    file.path = file.path || acc.headerNewPath || acc.headerOldPath || ''
    if (acc.headerOldPath && acc.headerNewPath && acc.headerOldPath !== acc.headerNewPath) {
      file.oldPath = acc.headerOldPath
    }
  }
  if (!file.path) return null

  // A mode-only change (no hunks, no rename) is reported as such so the UI can
  // label it "权限变更" instead of a content modification.
  if (
    !acc.combined &&
    acc.modeOld !== null &&
    acc.modeNew !== null &&
    file.hunks.length === 0 &&
    file.status === 'modified' &&
    acc.explicitStatus === null
  ) {
    const symlink = acc.modeOld === '120000' || acc.modeNew === '120000'
    file.status = symlink ? 'typechange' : 'modechange'
  }
  if (acc.modeOld !== null && acc.modeNew !== null) {
    file.mode = { old: acc.modeOld, new: acc.modeNew }
  }
  file.isImage = isImagePath(file.path)
  if (acc.combined && file.status === 'modified' && file.hunks.length > 0) file.status = 'conflicted'

  // Encoding is reported for text content only (binary files are detected by
  // git, or by the text fallback below).
  if (!file.binary && file.hunks.length > 0) {
    file.encoding = mergeEncodings(acc.encodings)
  }
  return file
}

interface ParseOptions {
  /** Force a repo-relative path (used for untracked files diffed via --no-index). */
  pathOverride?: string
  /** Force the status (untracked diffs are "added"). */
  forceStatus?: FileStatus
}

/** Core parser operating on lines that were already decoded individually. */
export function parsePatchLines(lines: DecodedPatchLine[], options: ParseOptions = {}): DiffResult {
  const files: DiffFile[] = []
  let acc: FileAccumulator | null = null
  let hunk: HunkState | null = null

  const appendHunkLine = (state: HunkState, decoded: DecodedPatchLine): void => {
    const rawLine = decoded.text
    if (rawLine === '') return
    acc!.encodings.add(decoded.encoding)
    // A UTF-8 BOM lives at the start of the file content, which lands right
    // after the diff line marker; drop it so the diff never shows U+FEFF.
    const stripBom = (text: string): string => (text.startsWith('\uFEFF') ? text.slice(1) : text)
    if (state.combined) {
      const prefix = rawLine.slice(0, 2)
      const text = stripBom(rawLine.slice(2))
      const isAdd = prefix.includes('+')
      const isDel = !isAdd && prefix.includes('-')
      let type: DiffLine['type'] = 'context'
      if (isAdd) type = 'add'
      else if (isDel) type = 'del'
      const diffLine: DiffLine = {
        type,
        text,
        oldLine: isDel ? state.oldLine : null,
        newLine: isDel ? null : state.newLine
      }
      if (isDel) state.oldLine += 1
      else state.newLine += 1
      state.hunk.lines.push(diffLine)
      if (type === 'add') acc!.file.additions += 1
      if (type === 'del') acc!.file.deletions += 1
      return
    }

    const marker = rawLine[0]
    const text = stripBom(rawLine.slice(1))
    if (marker === '\\') {
      state.hunk.lines.push({ type: 'meta', text: rawLine, oldLine: null, newLine: null })
      return
    }
    if (marker === ' ') {
      state.hunk.lines.push({ type: 'context', text, oldLine: state.oldLine, newLine: state.newLine })
      state.oldLine += 1
      state.newLine += 1
      return
    }
    if (marker === '+') {
      state.hunk.lines.push({ type: 'add', text, oldLine: null, newLine: state.newLine })
      state.newLine += 1
      acc!.file.additions += 1
      return
    }
    if (marker === '-') {
      state.hunk.lines.push({ type: 'del', text, oldLine: state.oldLine, newLine: null })
      state.oldLine += 1
      acc!.file.deletions += 1
      return
    }
    state.hunk.lines.push({ type: 'meta', text: rawLine, oldLine: null, newLine: null })
  }

  for (const decoded of lines) {
    const rawLine = decoded.text
    // Structural lines may carry a trailing CR from CRLF content; content lines
    // keep it so the decoded text matches the original bytes.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

    if (
      line.startsWith('diff --git ') ||
      line.startsWith('diff --cc ') ||
      line.startsWith('diff --combined ')
    ) {
      if (acc) {
        const finalized = finalizeAccumulator(acc)
        if (finalized) files.push(finalized)
      }
      const combined = !line.startsWith('diff --git ')
      acc = createAccumulator(combined)
      hunk = null
      if (combined) {
        const payload = unquoteGitPath(line.replace(/^diff --(?:cc|combined) /, ''))
        acc.file.path = payload.replace(/^[a-z]\//, '')
      } else {
        const paths = parseDiffGitLine(line)
        if (paths) {
          acc.headerOldPath = paths.oldPath
          acc.headerNewPath = paths.newPath
          acc.file.path = paths.newPath
        }
      }
      continue
    }

    if (!acc) continue

    if (line.startsWith('@@')) {
      const state = parseHunkHeader(line, acc.file.hunks.length, acc.combined)
      if (state) {
        hunk = state
        acc.file.hunks.push(state.hunk)
      }
      continue
    }

    if (hunk) {
      appendHunkLine(hunk, decoded)
      continue
    }

    /* ---------------------------------------------------------- file header */
    if (line.startsWith('new file mode ')) {
      acc.explicitStatus = 'added'
      acc.modeNew = line.slice('new file mode '.length).trim()
      acc.file.status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode ')) {
      acc.explicitStatus = 'deleted'
      acc.modeOld = line.slice('deleted file mode '.length).trim()
      acc.file.status = 'deleted'
      continue
    }
    if (line.startsWith('old mode ')) {
      acc.modeOld = line.slice('old mode '.length).trim()
      continue
    }
    if (line.startsWith('new mode ')) {
      acc.modeNew = line.slice('new mode '.length).trim()
      continue
    }
    if (line.startsWith('rename from ')) {
      acc.renameFrom = unquoteGitPath(line.slice('rename from '.length))
      continue
    }
    if (line.startsWith('rename to ')) {
      acc.renameTo = unquoteGitPath(line.slice('rename to '.length))
      continue
    }
    if (line.startsWith('copy from ')) {
      acc.copyFrom = unquoteGitPath(line.slice('copy from '.length))
      continue
    }
    if (line.startsWith('copy to ')) {
      acc.copyTo = unquoteGitPath(line.slice('copy to '.length))
      continue
    }
    if (line.startsWith('--- ')) {
      const parsed = headerPath(line.slice(4))
      acc.headerOldPath = parsed
      if (!acc.file.path && parsed) acc.file.path = parsed
      continue
    }
    if (line.startsWith('+++ ')) {
      const parsed = headerPath(line.slice(4))
      acc.headerNewPath = parsed
      if (parsed) acc.file.path = parsed
      continue
    }
    if (
      line.startsWith('index ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('dissimilarity index ')
    ) {
      continue
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      acc.file.binary = true
      if (line.startsWith('Binary files ')) {
        const match = /^Binary files (.*) and (.*) differ$/.exec(line)
        if (match) {
          const left = headerPath(match[1])
          const right = headerPath(match[2])
          if (right) acc.file.path = right
          if (left && right && left !== right) acc.file.oldPath = left
        }
      }
      continue
    }
  }

  if (acc) {
    const finalized = finalizeAccumulator(acc)
    if (finalized) files.push(finalized)
  }

  if (options.pathOverride) {
    const target = options.pathOverride
    if (files.length === 0) {
      files.push({
        path: target,
        status: options.forceStatus ?? 'added',
        binary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
        mode: null,
        isImage: isImagePath(target),
        encoding: 'utf-8'
      })
    } else {
      for (const file of files) {
        file.path = target
        delete file.oldPath
        file.status = options.forceStatus ?? 'added'
        file.isImage = isImagePath(target)
      }
    }
  }

  return { files, stats: statsOf(files), raw: lines.map((line) => line.text).join('\n') }
}

/** Parses a patch that is already decoded as UTF-8 (used by tests/synthetic input). */
export function parsePatch(raw: string, options: ParseOptions = {}): DiffResult {
  const lines = raw.split('\n').map((text) => ({ text, encoding: 'utf-8' as DetectedEncoding }))
  return parsePatchLines(lines, options)
}

/**
 * Parses raw `git diff` bytes: split on LF first, decode every line with
 * `decodeSmart`. This keeps mixed-encoding patches intact.
 */
export function parsePatchBytes(buffer: Buffer, options: ParseOptions = {}): DiffResult {
  const byteLines = splitBuffer(buffer, 0x0a)
  const lines = byteLines.map((bytes) => {
    const decoded = decodeSmart(bytes)
    return { text: decoded.text, encoding: decoded.encoding }
  })
  return parsePatchLines(lines, options)
}

/* -------------------------------------------------------------------- args */

export function diffArgs(options: DiffOptions = {}): string[] {
  const context = Math.max(0, Math.floor(options.context ?? 3))
  const args = ['--no-color', '--no-ext-diff', '-M', `--unified=${context}`]
  if (options.ignoreWhitespace) args.push('-w')
  if (options.ignoreSpaceAtEol) args.push('--ignore-space-at-eol')
  return args
}

function statsOf(files: DiffFile[]): DiffResult['stats'] {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { files: files.length, additions, deletions }
}

function resultOf(files: DiffFile[], raw: string): DiffResult {
  return { files, stats: statsOf(files), raw }
}

async function runDiff(args: string[], cwd: string, friendly: string): Promise<DiffResult> {
  const result = await runGit(args, { cwd })
  if (result.code !== 0) throw gitFailure(friendly, result)
  return parsePatchBytes(result.stdoutBuffer)
}

/** True when `file` has an entry in the index (i.e. is not untracked). */
export async function isTrackedFile(repo: string, file: string): Promise<boolean> {
  const result = await runGit(['ls-files', '--error-unmatch', '--', file], { cwd: repo })
  return result.code === 0
}

async function emptyTreeHash(repo: string): Promise<string> {
  const result = await runGit(['hash-object', '-t', 'tree', '--stdin'], { cwd: repo, input: '' })
  const hash = result.stdout.trim()
  if (result.code !== 0 || !hash) throw gitFailure('无法创建空树对象', result)
  return hash
}

/* ------------------------------------------------- UTF-16 / binary fallback */

interface BlobPair {
  oldBytes: Buffer | null
  newBytes: Buffer | null
}

/** Reads a blob from a revision (`HEAD:path`, `:path`, `<hash>:path`). */
async function showBlob(repo: string, spec: string): Promise<Buffer | null> {
  const result = await runGit(['show', spec], { cwd: repo })
  if (result.code !== 0) return null
  return result.stdoutBuffer
}

async function readWorktreeFile(repo: string, file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.resolve(repo, file))
  } catch {
    return null
  }
}

function splitTextLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (normalized === '') return []
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Builds a coarse (prefix/suffix-trimmed) text diff for files git sees as binary. */
function buildFallbackTextDiff(filePath: string, pair: BlobPair): DiffFile | null {
  const oldDecoded = pair.oldBytes ? decodeSmart(pair.oldBytes) : null
  const newDecoded = pair.newBytes ? decodeSmart(pair.newBytes) : null
  const encoding = newDecoded?.encoding ?? oldDecoded?.encoding ?? 'utf-8'
  if (encoding !== 'utf-16le' && encoding !== 'utf-16be') return null
  const oldLines = oldDecoded ? splitTextLines(oldDecoded.text) : []
  const newLines = newDecoded ? splitTextLines(newDecoded.text) : []
  if (oldLines.length === 0 && newLines.length === 0) return null

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)
  if (oldMiddle.length === 0 && newMiddle.length === 0) return null

  const status: FileStatus = oldLines.length === 0 ? 'added' : newLines.length === 0 ? 'deleted' : 'modified'
  const oldStart = oldLines.length === 0 ? 0 : 1
  const newStart = newLines.length === 0 ? 0 : 1
  const header = `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`
  const lines: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  for (let index = 0; index < prefix; index += 1) {
    lines.push({ type: 'context', text: oldLines[index], oldLine, newLine })
    oldLine += 1
    newLine += 1
  }
  for (const text of oldMiddle) {
    lines.push({ type: 'del', text, oldLine, newLine: null })
    oldLine += 1
  }
  for (const text of newMiddle) {
    lines.push({ type: 'add', text, oldLine: null, newLine })
    newLine += 1
  }
  for (const text of oldLines.slice(oldLines.length - suffix)) {
    lines.push({ type: 'context', text, oldLine, newLine })
    oldLine += 1
    newLine += 1
  }

  return {
    path: filePath,
    status,
    binary: false,
    hunks: [{ index: 0, header, section: '', oldStart, oldLines: oldLines.length, newStart, newLines: newLines.length, lines }],
    additions: newMiddle.length,
    deletions: oldMiddle.length,
    mode: null,
    isImage: isImagePath(filePath),
    encoding
  }
}

/** Replaces binary entries whose content is really UTF-16 text with a text diff. */
async function applyTextFallback(
  files: DiffFile[],
  getter: (file: DiffFile) => Promise<BlobPair | null>
): Promise<void> {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (!file.binary || !isTextPath(file.path)) continue
    let pair: BlobPair | null = null
    try {
      pair = await getter(file)
    } catch {
      pair = null
    }
    if (!pair) continue
    const replacement = buildFallbackTextDiff(file.path, pair)
    if (!replacement) continue
    if (file.oldPath) replacement.oldPath = file.oldPath
    files[index] = replacement
  }
}

/* ------------------------------------------------------------- diff sources */

/**
 * Diffs a single path. A pathspec hides the source side of a rename, which makes
 * `git diff -M -- new-name` report "added"; when that happens we re-run the diff
 * for the whole change set and pick the rename record instead.
 */
async function runDiffForFile(
  repo: string,
  baseArgs: string[],
  file: string,
  options: DiffOptions,
  friendly: string
): Promise<DiffResult> {
  const result = await runGit([...baseArgs, ...diffArgs(options), '--', file], { cwd: repo })
  if (result.code !== 0) throw gitFailure(friendly, result)
  const parsed = parsePatchBytes(result.stdoutBuffer)
  const suspect = parsed.files.length === 1 && parsed.files[0].status === 'added' && !parsed.files[0].oldPath
  if (suspect) {
    const full = await runGit([...baseArgs, ...diffArgs(options)], { cwd: repo })
    if (full.code === 0) {
      const all = parsePatchBytes(full.stdoutBuffer)
      const exact = all.files.find((candidate) => candidate.path === file)
      if (exact && exact.status !== 'added') return resultOf([exact], all.raw ?? '')
    }
  }
  return parsed
}

interface CachedDiffOptions {
  file?: string
  options: DiffOptions
}

/**
 * `git diff --cached` needs a valid HEAD; on a repository without commits
 * compare the index against the empty tree instead.
 */
async function cachedDiff(repo: string, parsedOptions: CachedDiffOptions): Promise<DiffResult> {
  const { file, options } = parsedOptions
  const base = ['diff', '--cached']
  const fallback = async (): Promise<string[]> => {
    const tree = await emptyTreeHash(repo)
    return ['diff', '--cached', tree]
  }
  let args = [...base, ...diffArgs(options), ...(file ? ['--', file] : [])]
  let result = await runGit(args, { cwd: repo })
  if (
    result.code !== 0 &&
    /ambiguous argument 'HEAD'|could not resolve 'HEAD'|unknown revision|does not have any commits/i.test(result.stderr)
  ) {
    args = [...(await fallback()), ...diffArgs(options), ...(file ? ['--', file] : [])]
    result = await runGit(args, { cwd: repo })
  }
  if (result.code !== 0) throw gitFailure('无法读取暂存区差异', result)
  const parsed = parsePatchBytes(result.stdoutBuffer)
  await applyTextFallback(parsed.files, async (entry) => ({
    oldBytes: await showBlob(repo, `HEAD:${entry.path}`),
    newBytes: await showBlob(repo, `:${entry.path}`)
  }))
  if (file && parsed.files.length === 1 && parsed.files[0].status === 'added' && !parsed.files[0].oldPath) {
    const fullArgs = [...base, ...diffArgs(options)]
    const full = await runGit(fullArgs, { cwd: repo })
    if (full.code === 0) {
      const all = parsePatchBytes(full.stdoutBuffer)
      const exact = all.files.find((candidate) => candidate.path === file)
      if (exact && exact.status !== 'added') return resultOf([exact], all.raw ?? '')
    }
  }
  return parsed
}

/** Untracked file: diff an empty temporary file against it via --no-index. */
async function untrackedDiff(repo: string, file: string, options: DiffOptions): Promise<DiffResult> {
  const target = path.resolve(repo, file)
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    throw new Error(`文件不存在：${file}`)
  }
  if (stat.isDirectory()) {
    return { files: [], stats: { files: 0, additions: 0, deletions: 0 }, raw: '' }
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arbor-diff-'))
  const empty = path.join(tmpDir, 'empty')
  try {
    await fs.writeFile(empty, '')
    // `--no-index` exits with 1 when the files differ; >1 is a real error.
    const result = await runGit(['diff', '--no-index', ...diffArgs(options), '--', empty, file], {
      cwd: repo
    })
    if (result.code > 1) throw gitFailure('无法读取未跟踪文件的差异', result)
    const parsed = parsePatchBytes(result.stdoutBuffer, { pathOverride: file, forceStatus: 'added' })
    await applyTextFallback(parsed.files, async () => ({
      oldBytes: null,
      newBytes: await readWorktreeFile(repo, file)
    }))
    return parsed
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function diffWorktree(
  repo: string,
  file: string,
  side: 'staged' | 'unstaged',
  options: DiffOptions = {}
): Promise<DiffResult> {
  if (!file) throw new Error('文件路径不能为空')
  if (side === 'staged') return cachedDiff(repo, { file, options })
  const tracked = await isTrackedFile(repo, file)
  if (!tracked) return untrackedDiff(repo, file, options)
  const parsed = await runDiffForFile(repo, ['diff'], file, options, '无法读取文件差异')
  await applyTextFallback(parsed.files, async (entry) => ({
    oldBytes: await showBlob(repo, `:${entry.path}`),
    newBytes: await readWorktreeFile(repo, entry.path)
  }))
  return parsed
}

export async function diffStaged(
  repo: string,
  file?: string,
  options: DiffOptions = {}
): Promise<DiffResult> {
  return cachedDiff(repo, { file, options })
}

/** Parent commit for a revision, `null` for a root commit. */
export async function parentOf(repo: string, hash: string): Promise<string | null> {
  const result = await runGit(['rev-list', '--parents', '-n', '1', '--no-walk', assertSafeRef(hash, '提交')], {
    cwd: repo
  })
  if (result.code !== 0) throw gitFailure('无法解析提交', result)
  const tokens = result.stdout.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) throw new Error(`未找到提交：${hash}`)
  return tokens.length > 1 ? tokens[1] : null
}

export async function diffCommit(
  repo: string,
  hash: string,
  file?: string,
  options: DiffOptions = {}
): Promise<DiffResult> {
  const safeHash = assertSafeRef(hash, '提交')
  const parent = await parentOf(repo, safeHash)
  const base = parent ? ['diff', parent, safeHash] : ['show', '--format=', safeHash]
  const parsed = file
    ? await runDiffForFile(repo, base, file, options, '无法读取提交差异')
    : await runDiff([...base, ...diffArgs(options)], repo, '无法读取提交差异')
  await applyTextFallback(parsed.files, async (entry) => ({
    oldBytes: parent ? await showBlob(repo, `${parent}:${entry.path}`) : null,
    newBytes: await showBlob(repo, `${safeHash}:${entry.path}`)
  }))
  return parsed
}

export async function diffRange(
  repo: string,
  from: string,
  to: string,
  file?: string,
  options: DiffOptions = {}
): Promise<DiffResult> {
  const safeFrom = assertSafeRef(from, '起始提交')
  const safeTo = assertSafeRef(to, '结束提交')
  const base = ['diff', safeFrom, safeTo]
  const parsed = file
    ? await runDiffForFile(repo, base, file, options, '无法读取提交区间差异')
    : await runDiff([...base, ...diffArgs(options)], repo, '无法读取提交区间差异')
  await applyTextFallback(parsed.files, async (entry) => ({
    oldBytes: await showBlob(repo, `${safeFrom}:${entry.path}`),
    newBytes: await showBlob(repo, `${safeTo}:${entry.path}`)
  }))
  return parsed
}

export async function diffStash(
  repo: string,
  index: number,
  file?: string,
  options: DiffOptions = {}
): Promise<DiffResult> {
  if (!Number.isInteger(index) || index < 0) throw new Error(`stash 索引不合法：${index}`)
  const ref = `stash@{${index}}`
  const verify = await runGit(['rev-parse', '--verify', ref], { cwd: repo })
  if (verify.code !== 0) throw new Error(`没有找到 stash@{${index}}`)
  const base = ['diff', `${ref}^`, ref]
  const parsed = file
    ? await runDiffForFile(repo, base, file, options, '无法读取 stash 差异')
    : await runDiff([...base, ...diffArgs(options)], repo, '无法读取 stash 差异')
  await applyTextFallback(parsed.files, async (entry) => ({
    oldBytes: await showBlob(repo, `${ref}^:${entry.path}`),
    newBytes: await showBlob(repo, `${ref}:${entry.path}`)
  }))
  return parsed
}

/** Raw patch bytes for a single file, used by hunk staging (byte preserving). */
export async function rawPatchForFile(
  repo: string,
  file: string,
  source: 'staged' | 'unstaged'
): Promise<Buffer> {
  const args =
    source === 'staged'
      ? ['diff', '--cached', '--no-color', '--no-ext-diff', '-M', '--unified=3', '--', file]
      : ['diff', '--no-color', '--no-ext-diff', '-M', '--unified=3', '--', file]
  const result = await runGit(args, { cwd: repo })
  if (result.code !== 0) throw gitFailure('无法生成补丁', result)
  return result.stdoutBuffer
}
