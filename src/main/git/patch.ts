import type { HunkApplyArgs } from '@shared/types'
import { splitBuffer } from './encoding'
import { gitFailure, runGit } from './exec'
import { isTrackedFile, rawPatchForFile } from './diff'

/**
 * Hunk-level staging.
 *
 * Strategy (contract §4): re-compute the full patch for the requested source,
 * keep the file header, splice in exactly one hunk and feed that patch to
 * `git apply` over stdin. Staging a worktree hunk uses `--cached`; un-staging a
 * staged hunk applies the cached patch in reverse.
 *
 * The patch is handled as raw bytes end to end so GBK/GB18030 file content is
 * applied exactly as git produced it (re-encoding through a JS string would
 * corrupt the bytes).
 */

export interface SplitPatchBytes {
  header: Buffer[]
  hunks: Buffer[][]
}

function isHunkHeader(line: Buffer): boolean {
  return line.length >= 2 && line[0] === 0x40 && line[1] === 0x40 // "@@"
}

function trimTrailingEmpty(lines: Buffer[]): Buffer[] {
  const result = [...lines]
  while (result.length > 0 && result[result.length - 1].length === 0) result.pop()
  return result
}

/** Splits a single-file patch buffer into header lines and raw hunk line groups. */
export function splitPatchBytes(raw: Buffer): SplitPatchBytes {
  const lines = splitBuffer(raw, 0x0a)
  const firstHunk = lines.findIndex(isHunkHeader)
  if (firstHunk === -1) return { header: trimTrailingEmpty(lines), hunks: [] }
  const header = lines.slice(0, firstHunk)
  const hunks: Buffer[][] = []
  let current: Buffer[] | null = null
  for (let index = firstHunk; index < lines.length; index += 1) {
    const line = lines[index]
    if (isHunkHeader(line)) {
      if (current) hunks.push(trimTrailingEmpty(current))
      current = [line]
      continue
    }
    if (current) current.push(line)
  }
  if (current) hunks.push(trimTrailingEmpty(current))
  return { header, hunks: hunks.filter((hunk) => hunk.length > 0) }
}

function joinLines(lines: Buffer[]): Buffer {
  const parts: Buffer[] = []
  for (const line of lines) {
    parts.push(line)
    parts.push(Buffer.from('\n'))
  }
  return Buffer.concat(parts)
}

/** Builds the byte patch that contains only the `hunkIndex`th hunk of a file. */
export function buildHunkPatch(raw: Buffer, hunkIndex: number): Buffer {
  const { header, hunks } = splitPatchBytes(raw)
  if (hunks.length === 0) throw new Error('该文件没有可应用的 hunk')
  if (!Number.isInteger(hunkIndex) || hunkIndex < 0 || hunkIndex >= hunks.length) {
    throw new Error(`hunk 不存在：${hunkIndex}`)
  }
  return Buffer.concat([joinLines(header), joinLines(hunks[hunkIndex])])
}

export async function applyHunk(repo: string, args: HunkApplyArgs): Promise<void> {
  if (!args.file) throw new Error('文件路径不能为空')
  const source: 'staged' | 'unstaged' = args.source === 'staged' ? 'staged' : 'unstaged'
  const reverse = Boolean(args.reverse)

  if (!(await isTrackedFile(repo, args.file))) {
    throw new Error('未跟踪文件不支持部分暂存，请先暂存整个文件')
  }

  const raw = await rawPatchForFile(repo, args.file, source)
  const patch = buildHunkPatch(raw, Math.floor(args.hunkIndex))

  const command = ['apply']
  if (source === 'staged') {
    command.push('--cached')
    if (reverse) command.push('-R')
  } else if (reverse) {
    command.push('-R')
  } else {
    command.push('--cached')
  }
  command.push('--whitespace=nowarn')

  const result = await runGit(command, { cwd: repo, input: patch })
  if (result.code !== 0) {
    const action = reverse
      ? source === 'staged'
        ? '取消暂存该 hunk'
        : '还原该 hunk'
      : '暂存该 hunk'
    throw gitFailure(`无法${action}`, result)
  }
}
