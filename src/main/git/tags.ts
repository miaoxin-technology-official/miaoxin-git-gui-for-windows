import type { TagInfo } from '@shared/types'
import { decodeLines } from './encoding'
import { assertSafeRef, NETWORK_TIMEOUT, runGitOk } from './exec'

/**
 * Tags via `for-each-ref refs/tags`. Annotated tags expose their tagger and
 * message through `%(taggername)` / `%(contents:subject)`; for lightweight tags
 * those fields describe the commit they point at, so they are ignored.
 */

const TAG_FORMAT = [
  '%(refname:short)',
  '%(objectname)',
  '%(objecttype)',
  '%(*objectname)',
  '%(taggername)',
  '%(creatordate:unix)',
  '%(contents:subject)'
].join('%00')

export function parseTagList(output: string | Buffer): TagInfo[] {
  const tags: TagInfo[] = []
  const lines = typeof output === 'string' ? output.split('\n') : decodeLines(output).map((line) => line.text)
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) continue
    const fields = line.split('\0')
    const name = fields[0] ?? ''
    if (!name) continue
    const objectName = fields[1] ?? ''
    const annotated = (fields[2] ?? '') === 'tag'
    const peeled = fields[3] ?? ''
    const time = Number(fields[5] ?? '0')
    const tag: TagInfo = {
      name,
      target: annotated ? peeled || objectName : objectName,
      annotated,
      time: Number.isFinite(time) && time > 0 ? time : undefined
    }
    if (annotated) {
      if (fields[4]) tag.tagger = fields[4]
      if (fields[6]) tag.message = fields[6]
    }
    tags.push(tag)
  }
  return tags
}

export async function readTags(repo: string): Promise<TagInfo[]> {
  const result = await runGitOk(
    ['for-each-ref', 'refs/tags', '--sort=-creatordate', `--format=${TAG_FORMAT}`],
    { cwd: repo },
    '无法读取标签列表'
  )
  return parseTagList(result.stdoutBuffer)
}

function assertTagName(name: string): string {
  const safe = assertSafeRef(name, '标签名')
  if (/[\s~^:?*[\\]/.test(safe) || safe.includes('..') || safe.endsWith('.lock')) {
    throw new Error(`标签名不合法：${safe}`)
  }
  return safe
}

function assertTarget(target: string): string {
  return assertSafeRef(target, '目标提交')
}

export async function createTag(
  repo: string,
  name: string,
  target?: string,
  message?: string
): Promise<void> {
  const safeName = assertTagName(name)
  const safeTarget = target ? assertTarget(target) : null
  if (message && message.trim()) {
    const args = ['tag', '-a', safeName, '-m', message]
    if (safeTarget) args.push(safeTarget)
    await runGitOk(args, { cwd: repo }, `无法创建标签 ${safeName}`)
    return
  }
  const args = ['tag', safeName]
  if (safeTarget) args.push(safeTarget)
  await runGitOk(args, { cwd: repo }, `无法创建标签 ${safeName}`)
}

export async function deleteTag(repo: string, name: string, remote?: string): Promise<void> {
  const safeName = assertTagName(name)
  if (remote) {
    const safeRemote = assertSafeRef(remote, '远程名称')
    await runGitOk(
      ['push', safeRemote, '--delete', `refs/tags/${safeName}`],
      { cwd: repo, timeoutMs: NETWORK_TIMEOUT },
      `无法删除远程标签 ${safeName}`
    )
  }
  await runGitOk(['tag', '-d', safeName], { cwd: repo }, `无法删除标签 ${safeName}`)
}
