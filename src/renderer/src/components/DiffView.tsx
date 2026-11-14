// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DiffView — shared unified / split diff renderer.
 *
 * Used by Changes (working tree side-by-side with the file list) and by
 * History (commit detail). It is a pure renderer: the caller owns fetching and
 * staging; hunk actions are exposed through optional callbacks.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { DiffFile, DiffHunk, DiffLine, DiffResult } from '@shared/types'
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  FileDiff,
  FileImage,
  Minus,
  Plus,
  Rows2,
  WrapText
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { dirName, fileName, statusLabel, statusTone } from '@/lib/format'
import { useAppStore } from '@/store/app'
import { IconButton, Button } from './ui/Button'
import { Banner, EmptyState, LoadingBlock } from './ui/Feedback'
import { Segmented } from './ui/Fields'
import '@/styles/diff.css'

export type DiffMode = 'unified' | 'split'

/** Where the diff comes from; only affects the empty-state copy. */
export type DiffSide = 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'commit'

export interface DiffViewProps {
  /** repository root; optional so History can reuse the view with only diff/loading/emptyLabel */
  repo?: string
  diff: DiffResult | null
  loading?: boolean
  emptyLabel?: string
  emptyDesc?: string
  onStageHunk?: (filePath: string, hunkIndex: number) => void
  onUnstageHunk?: (filePath: string, hunkIndex: number) => void
  showFileHeader?: boolean
  /** hide the file/stat summary in the top toolbar; only keep the view controls */
  compactToolbar?: boolean
  error?: string | null
  side?: DiffSide
  /** optional retry hook displayed with the error banner */
  onRetry?: () => void
}

/* ------------------------------------------------------------------ copy */

const EMPTY_COPY: Record<DiffSide | 'default', { title: string; desc: string }> = {
  staged: {
    title: '暂存区没有可显示的差异',
    desc: '把工作区改动暂存后，这里会显示该文件的 diff。'
  },
  unstaged: {
    title: '工作区没有可显示的差异',
    desc: '在当前文件中没有找到未暂存的改动。'
  },
  untracked: {
    title: '未跟踪文件没有 diff',
    desc: '未跟踪文件不在 Git 索引中，先暂存该文件才能查看差异。'
  },
  conflicted: {
    title: '冲突文件没有可显示的差异',
    desc: '解决冲突后，这里会显示解决后的差异。'
  },
  commit: {
    title: '没有可显示的差异',
    desc: '该提交没有修改任何文件。'
  },
  default: {
    title: '选择一个文件查看差异',
    desc: '在文件列表中选中一个文件，右侧会以 unified 或 split 模式显示 diff。'
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i

/** Non-UTF-8 files get a quiet hint chip so users can trust CJK text rendering. */
function encodingLabel(encoding: string | undefined): string | null {
  if (!encoding) return null
  const normalized = encoding.trim().toLowerCase()
  if (!normalized || normalized === 'utf-8' || normalized === 'utf8') return null
  return encoding.trim().toUpperCase()
}

function emptyCopy(
  side: DiffSide | undefined,
  label: string | undefined,
  desc: string | undefined
): { title: string; desc: string } {
  const base = EMPTY_COPY[side ?? 'default']
  return { title: label ?? base.title, desc: desc ?? base.desc }
}

/* ------------------------------------------------------------ word diff */

interface WordSegment {
  text: string
  changed: boolean
}

const WORD_DIFF_LINE_LIMIT = 3000
const WORD_DIFF_MAX_TOKENS = 90000
const WORD_DIFF_MAX_PAIRS = 400

function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|\s+|[\s\S]/g) ?? []
}

function pushSegment(list: WordSegment[], text: string, changed: boolean): void {
  if (!text) return
  const last = list[list.length - 1]
  if (last && last.changed === changed) last.text += text
  else list.push({ text, changed })
}

/**
 * LCS over words: produces the two token streams with changed runs flagged.
 * Returns null when the pair is too large or identical (no highlighting).
 */
function diffWords(oldText: string, newText: string): { old: WordSegment[]; next: WordSegment[] } | null {
  if (oldText === newText) return null
  if (oldText.length > 1600 || newText.length > 1600) return null
  const a = tokenize(oldText)
  const b = tokenize(newText)
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return null
  if (n * m > WORD_DIFF_MAX_TOKENS) return null

  const width = m + 1
  const dp = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width
    const nextRow = row + width
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[row + j] =
        a[i] === b[j]
          ? dp[nextRow + j + 1] + 1
          : Math.max(dp[nextRow + j], dp[row + j + 1])
    }
  }

  const oldSegments: WordSegment[] = []
  const nextSegments: WordSegment[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushSegment(oldSegments, a[i], false)
      pushSegment(nextSegments, b[j], false)
      i += 1
      j += 1
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      pushSegment(oldSegments, a[i], true)
      i += 1
    } else {
      pushSegment(nextSegments, b[j], true)
      j += 1
    }
  }
  while (i < n) {
    pushSegment(oldSegments, a[i], true)
    i += 1
  }
  while (j < m) {
    pushSegment(nextSegments, b[j], true)
    j += 1
  }
  return { old: oldSegments, next: nextSegments }
}

/** Line text as delivered by the main process (the +/-/space marker is already stripped). */
function lineBody(line: DiffLine): string {
  return line.text
}

function lineMarker(line: DiffLine): string {
  if (line.type === 'add') return '+'
  if (line.type === 'del') return '-'
  if (line.type === 'context') return ' '
  return ''
}

function totalLines(files: DiffFile[]): number {
  let count = 0
  for (const file of files) {
    for (const hunk of file.hunks) count += hunk.lines.length
  }
  return count
}

/* --------------------------------------------------------------- render */

function WordSegments({ segments }: { segments?: WordSegment[] }): React.JSX.Element | null {
  if (!segments || segments.length === 0) return null
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <mark className="diff-word" key={index}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </>
  )
}

function LineNumber({ value }: { value: number | null }): React.JSX.Element {
  return <span className="diff-no num mono">{value ?? ''}</span>
}

interface HunkActionProps {
  hunk: DiffHunk
  filePath: string
  onStageHunk?: (filePath: string, hunkIndex: number) => void
  onUnstageHunk?: (filePath: string, hunkIndex: number) => void
}

function HunkHeader({ hunk, filePath, onStageHunk, onUnstageHunk }: HunkActionProps): React.JSX.Element {
  return (
    <div className="diff-hunk-hd">
      <span className="diff-hunk-title mono" title={hunk.header}>
        {hunk.header || `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
      </span>
      {onStageHunk || onUnstageHunk ? (
        <span className="diff-hunk-actions">
          {onStageHunk ? (
            <button
              type="button"
              className="diff-hunk-btn"
              onClick={() => onStageHunk(filePath, hunk.index)}
              title="暂存此块改动"
            >
              <Plus size={12} strokeWidth={1.8} />
              暂存此块
            </button>
          ) : null}
          {onUnstageHunk ? (
            <button
              type="button"
              className="diff-hunk-btn"
              onClick={() => onUnstageHunk(filePath, hunk.index)}
              title="取消暂存此块改动"
            >
              <Minus size={12} strokeWidth={1.8} />
              取消暂存此块
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

function UnifiedHunk({
  filePath,
  hunk,
  wordDiffEnabled,
  onStageHunk,
  onUnstageHunk
}: {
  filePath: string
  hunk: DiffHunk
  wordDiffEnabled: boolean
  onStageHunk?: (filePath: string, hunkIndex: number) => void
  onUnstageHunk?: (filePath: string, hunkIndex: number) => void
}): React.JSX.Element {
  const wordMap = useMemo(() => {
    const map = new Map<number, WordSegment[]>()
    if (!wordDiffEnabled) return map
    const lines = hunk.lines
    if (lines.length === 0 || lines.length > 900) return map
    let pairs = 0
    let i = 0
    while (i < lines.length) {
      if (lines[i].type !== 'del') {
        i += 1
        continue
      }
      const delStart = i
      while (i < lines.length && lines[i].type === 'del') i += 1
      const addStart = i
      while (i < lines.length && lines[i].type === 'add') i += 1
      const pairCount = Math.min(addStart - delStart, i - addStart)
      for (let k = 0; k < pairCount; k += 1) {
        if (pairs >= WORD_DIFF_MAX_PAIRS) break
        pairs += 1
        const result = diffWords(lineBody(lines[delStart + k]), lineBody(lines[addStart + k]))
        if (result) {
          map.set(delStart + k, result.old)
          map.set(addStart + k, result.next)
        }
      }
      if (pairs >= WORD_DIFF_MAX_PAIRS) return map
    }
    return map
  }, [hunk.lines, wordDiffEnabled])

  return (
    <div className="diff-hunk">
      <HunkHeader hunk={hunk} filePath={filePath} onStageHunk={onStageHunk} onUnstageHunk={onUnstageHunk} />
      <div className="diff-lines">
        {hunk.lines.map((line, index) => {
          if (line.type === 'meta') {
            return (
              <div className="diff-line is-meta" key={index}>
                <span className="diff-code">{line.text}</span>
              </div>
            )
          }
          const segments = wordMap.get(index)
          return (
            <div className={cn('diff-line', `is-${line.type}`)} key={index}>
              <LineNumber value={line.oldLine} />
              <LineNumber value={line.newLine} />
              <span className={cn('diff-marker', `is-${line.type}`)}>{lineMarker(line)}</span>
              <span className="diff-code">
                {segments ? <WordSegments segments={segments} /> : lineBody(line)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
  meta: DiffLine | null
}

function SplitHunk({
  filePath,
  hunk,
  wordDiffEnabled,
  onStageHunk,
  onUnstageHunk
}: {
  filePath: string
  hunk: DiffHunk
  wordDiffEnabled: boolean
  onStageHunk?: (filePath: string, hunkIndex: number) => void
  onUnstageHunk?: (filePath: string, hunkIndex: number) => void
}): React.JSX.Element {
  const { rows, words } = useMemo(() => {
    const nextRows: SplitRow[] = []
    const wordMap = new Map<DiffLine, WordSegment[]>()
    const lines = hunk.lines
    const allowed = wordDiffEnabled && lines.length > 0 && lines.length <= 900
    let pairs = 0
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line.type === 'meta') {
        nextRows.push({ left: null, right: null, meta: line })
        i += 1
        continue
      }
      if (line.type === 'context') {
        nextRows.push({ left: line, right: line, meta: null })
        i += 1
        continue
      }
      const delStart = i
      while (i < lines.length && lines[i].type === 'del') i += 1
      const addStart = i
      while (i < lines.length && lines[i].type === 'add') i += 1
      const delCount = addStart - delStart
      const addCount = i - addStart
      const rowCount = Math.max(delCount, addCount)
      for (let k = 0; k < rowCount; k += 1) {
        const left = k < delCount ? lines[delStart + k] : null
        const right = k < addCount ? lines[addStart + k] : null
        if (allowed && left && right && pairs < WORD_DIFF_MAX_PAIRS) {
          pairs += 1
          const result = diffWords(lineBody(left), lineBody(right))
          if (result) {
            wordMap.set(left, result.old)
            wordMap.set(right, result.next)
          }
        }
        nextRows.push({ left, right, meta: null })
      }
    }
    return { rows: nextRows, words: wordMap }
  }, [hunk.lines, wordDiffEnabled])

  return (
    <div className="diff-hunk">
      <HunkHeader hunk={hunk} filePath={filePath} onStageHunk={onStageHunk} onUnstageHunk={onUnstageHunk} />
      <div className="diff-split">
        {rows.map((row, index) =>
          row.meta ? (
            <div className="diff-line is-meta diff-split-meta" key={`m-${index}`}>
              <span className="diff-code">{row.meta.text}</span>
            </div>
          ) : (
            <Fragment key={`r-${index}`}>
              <SplitCell line={row.left} column="old" segments={row.left ? words.get(row.left) : undefined} />
              <SplitCell line={row.right} column="new" segments={row.right ? words.get(row.right) : undefined} />
            </Fragment>
          )
        )}
      </div>
    </div>
  )
}

function SplitCell({
  line,
  column,
  segments
}: {
  line: DiffLine | null
  column: 'old' | 'new'
  segments?: WordSegment[]
}): React.JSX.Element {
  if (!line) {
    return (
      <div className="diff-split-cell is-placeholder">
        <span className="diff-no" />
        <span className="diff-marker" />
        <span className="diff-code" />
      </div>
    )
  }
  return (
    <div className={cn('diff-split-cell', `is-${line.type}`)}>
      <LineNumber value={column === 'old' ? line.oldLine : line.newLine} />
      <span className={cn('diff-marker', `is-${line.type}`)}>{lineMarker(line)}</span>
      <span className="diff-code">
        {segments ? <WordSegments segments={segments} /> : lineBody(line)}
      </span>
    </div>
  )
}

function DiffFileSection({
  file,
  mode,
  wrap,
  showHeader,
  wordDiffEnabled,
  defaultCollapsed = false,
  onStageHunk,
  onUnstageHunk
}: {
  file: DiffFile
  mode: DiffMode
  wrap: boolean
  showHeader: boolean
  wordDiffEnabled: boolean
  defaultCollapsed?: boolean
  onStageHunk?: (filePath: string, hunkIndex: number) => void
  onUnstageHunk?: (filePath: string, hunkIndex: number) => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const isImage = file.isImage || IMAGE_EXT.test(file.path)
  const encoding = encodingLabel(file.encoding)

  /* a mode-only / metadata-only change has no hunks: one quiet line instead of
     an empty collapsible header */
  if (!file.binary && !isImage && file.hunks.length === 0) {
    return (
      <section className="diff-file">
        <div className="diff-file-empty">没有可显示的文本差异</div>
      </section>
    )
  }

  const header = showHeader ? (
    <div className="diff-file-hd">
      <button
        type="button"
        className="diff-file-toggle"
        aria-expanded={!collapsed}
        title={collapsed ? '展开文件 diff' : '折叠文件 diff'}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? <ChevronRight size={14} strokeWidth={1.7} /> : <ChevronDown size={14} strokeWidth={1.7} />}
        <FileDiff size={14} strokeWidth={1.7} className="diff-file-icon" />
        <span className="diff-file-path truncate mono">
          {file.oldPath && file.oldPath !== file.path ? (
            <>
              <span className="diff-file-old truncate">{file.oldPath}</span>
              <span className="diff-file-arrow"> → </span>
            </>
          ) : null}
          <span className="diff-file-name">{fileName(file.path)}</span>
          <span className="diff-file-dir">{dirName(file.path) ? ` ${dirName(file.path)}` : ''}</span>
        </span>
      </button>
      <span className={cn('chip diff-status-chip', `is-${statusTone(file.status)}`)}>{statusLabel(file.status)}</span>
      {encoding ? <span className="chip diff-encoding-chip mono">{encoding}</span> : null}
      {file.binary ? <span className="chip diff-binary-chip">二进制</span> : null}
      <span className="diff-file-stats num">
        <span className="stat-add">+{file.additions}</span>
        <span className="stat-del">−{file.deletions}</span>
      </span>
    </div>
  ) : null

  return (
    <section className="diff-file">
      {header}
      {!collapsed || !showHeader ? (
        <div className={cn('diff-file-body', wrap && 'is-wrap')}>
          {isImage ? (
            <div className="diff-notice">
              <FileImage size={22} strokeWidth={1.5} className="diff-notice-icon" />
              <div className="diff-notice-title">图片文件</div>
              <div className="diff-notice-desc">图片内容不会在差异面板中加载，可在资源管理器中打开查看。</div>
            </div>
          ) : file.binary ? (
            <div className="diff-notice">
              <FileDiff size={22} strokeWidth={1.5} className="diff-notice-icon" />
              <div className="diff-notice-title">二进制文件，不支持预览</div>
              <div className="diff-notice-desc">该文件的差异无法以文本形式显示。</div>
            </div>
          ) : mode === 'split' ? (
            file.hunks.map((hunk) => (
              <SplitHunk
                key={hunk.index}
                filePath={file.path}
                hunk={hunk}
                wordDiffEnabled={wordDiffEnabled}
                onStageHunk={onStageHunk}
                onUnstageHunk={onUnstageHunk}
              />
            ))
          ) : (
            file.hunks.map((hunk) => (
              <UnifiedHunk
                key={hunk.index}
                filePath={file.path}
                hunk={hunk}
                wordDiffEnabled={wordDiffEnabled}
                onStageHunk={onStageHunk}
                onUnstageHunk={onUnstageHunk}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}

export function DiffView({
  repo = '',
  diff,
  loading,
  emptyLabel,
  emptyDesc,
  onStageHunk,
  onUnstageHunk,
  showFileHeader = true,
  compactToolbar = false,
  error,
  side,
  onRetry
}: DiffViewProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const setSettings = useAppStore((state) => state.setSettings)
  const [mode, setMode] = useState<DiffMode>(settings.diffMode)

  useEffect(() => {
    setMode(settings.diffMode)
  }, [settings.diffMode])

  const files = diff?.files ?? []
  const lines = useMemo(() => totalLines(files), [files])
  const showModeToggle = files.length > 0
  const wrap = settings.diffWrap
  /** Very large multi-file diffs (History) only auto-render the first screens. */
  const autoCollapseFrom = files.length > 20 ? 10 : -1

  const stats = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const file of files) {
      additions += file.additions
      deletions += file.deletions
    }
    return { additions, deletions }
  }, [files])

  if (error) {
    return (
      <div className="diff-root diff-root--message">
        <Banner
          kind="error"
          actions={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                重试
              </Button>
            ) : undefined
          }
        >
          {error}
        </Banner>
      </div>
    )
  }

  if (loading && !diff) {
    return (
      <div className="diff-root diff-root--message">
        <LoadingBlock label="正在读取差异" />
      </div>
    )
  }

  if (!diff || files.length === 0) {
    const copy = emptyCopy(side, emptyLabel, emptyDesc)
    return (
      <div className="diff-root diff-root--empty">
        <EmptyState art={side === 'commit' ? 'history' : 'changes'} title={copy.title} desc={copy.desc} />
      </div>
    )
  }

  return (
    <div className={cn('diff-root', mode === 'split' && 'is-split', wrap && 'is-wrap')} data-repo={repo || undefined}>
      {loading ? <div className="diff-loading-bar" /> : null}
      <div className={cn('diff-toolbar', compactToolbar && 'is-compact')}>
        {compactToolbar ? null : (
          <span className="diff-toolbar-stats num">
            <FileDiff size={13} strokeWidth={1.7} />
            <span>{files.length} 个文件</span>
            <span className="stat-add">+{stats.additions}</span>
            <span className="stat-del">−{stats.deletions}</span>
            {lines > WORD_DIFF_LINE_LIMIT ? <span className="diff-toolbar-hint">大文件已关闭词级高亮</span> : null}
            {autoCollapseFrom >= 0 ? (
              <span className="diff-toolbar-hint">
                其余 {files.length - autoCollapseFrom} 个文件默认折叠
              </span>
            ) : null}
          </span>
        )}
        <span className="diff-toolbar-actions">
          <IconButton
            icon={WrapText}
            label={wrap ? '关闭自动换行' : '开启自动换行'}
            active={wrap}
            size={26}
            onClick={() => void setSettings({ diffWrap: !wrap })}
          />
          {showModeToggle ? (
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'unified', label: '统一', icon: Rows2, title: '统一 diff' },
                { value: 'split', label: '分栏', icon: Columns2, title: '分栏 diff' }
              ]}
            />
          ) : null}
        </span>
      </div>
      <div className="diff-body">
        {files.map((file, index) => (
          <DiffFileSection
            key={`${file.path}:${index}`}
            file={file}
            mode={mode}
            wrap={wrap}
            showHeader={showFileHeader}
            wordDiffEnabled={lines <= WORD_DIFF_LINE_LIMIT}
            defaultCollapsed={index >= autoCollapseFrom}
            onStageHunk={onStageHunk}
            onUnstageHunk={onUnstageHunk}
          />
        ))}
      </div>
    </div>
  )
}

export default DiffView
