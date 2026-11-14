import { useEffect, useMemo, useState } from 'react'
import { Copy, GitCommit, GitMerge } from 'lucide-react'
import type { CommitDetail, DiffResult } from '@shared/types'
import { api } from '@/lib/api'
import { absoluteTime, dirName, fileName, hash7, relativeTime, statusLetter, statusTone } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAsyncData } from '@/lib/useAsyncData'
import { useAppStore } from '@/store/app'
import { IconButton } from '@/components/ui/Button'
import { Banner, EmptyState, LoadingBlock, Spinner } from '@/components/ui/Feedback'
import { DiffView } from '@/components/DiffView'
import { RefBadges, copyText } from './parts'

interface HistoryDetailProps {
  repoPath: string
  version: number
  hash: string | null
  onOpenCommit: (hash: string) => void
}

export function HistoryDetail({ repoPath, version, hash, onOpenCommit }: HistoryDetailProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const currentBranch = useAppStore((state) => state.repo?.branch ?? null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [bodyOpen, setBodyOpen] = useState(false)

  const detail = useAsyncData<CommitDetail | null>(
    () => (hash ? api.commitDetail(repoPath, hash) : Promise.resolve(null)),
    [repoPath, version, hash]
  )

  const diff = useAsyncData<DiffResult | null>(
    () =>
      hash && selectedFile
        ? api.diff.commit(repoPath, hash, selectedFile, {
            context: settings.diffContext,
            ignoreWhitespace: settings.ignoreWhitespace
          })
        : Promise.resolve(null),
    [repoPath, version, hash, selectedFile, settings.diffContext, settings.ignoreWhitespace]
  )

  useEffect(() => {
    setBodyOpen(false)
    setSelectedFile(null)
  }, [hash])

  useEffect(() => {
    const files = detail.data?.files ?? []
    if (!files.some((file) => file.path === selectedFile)) {
      setSelectedFile(files[0]?.path ?? null)
    }
  }, [detail.data, selectedFile])

  // `Commit.body` may arrive as the raw full message (subject included); strip
  // the subject so the detail pane does not show it twice.
  const bodyText = useMemo(() => {
    const data = detail.data
    if (!data) return ''
    const raw = (data.body ?? '').trim()
    const subject = (data.subject ?? '').trim()
    if (!raw) return ''
    if (subject && raw === subject) return ''
    if (subject && raw.startsWith(subject)) return raw.slice(subject.length).replace(/^\s+/, '')
    return raw
  }, [detail.data])
  const bodyLong = useMemo(() => bodyText.length > 320 || bodyText.split('\n').length > 4, [bodyText])
  const commit = detail.data

  return (
    <div className="hist-detail">
      {/* 32px header stays visible while the detail body scrolls */}
      <div className="hist-detail-bar">
        <span className={cn('hist-detail-hash mono', !hash && 'is-empty')}>
          {hash ? commit?.shortHash || hash7(hash) : '—'}
        </span>
        <IconButton
          icon={Copy}
          label="复制完整 hash"
          size={22}
          disabled={!hash}
          onClick={() => {
            if (hash) void copyText(commit?.hash ?? hash, '已复制完整 hash')
          }}
        />
        <RefBadges refs={commit?.refs ?? []} currentBranch={currentBranch} max={4} />
        <span className="hist-detail-bar-spacer" />
        {detail.loading ? <Spinner size={12} /> : null}
      </div>

      {!hash ? (
        <div className="hist-detail-empty">
          <EmptyState
            className="empty-compact"
            art="history"
            title="未选择提交"
            desc="在左侧列表中选择一个提交查看详情。"
          />
        </div>
      ) : (
        <>
          <div className="hist-detail-top">
            {detail.error ? <Banner kind="error">{detail.error}</Banner> : null}
            {!commit && detail.loading ? <LoadingBlock label="加载提交详情…" /> : null}

            {commit ? (
              <>
                <h2 className="hist-subject-lg">{commit.subject || '(无提交信息)'}</h2>

                {bodyText ? (
                  <>
                    <div className={cn('hist-body', bodyOpen && 'is-open')}>{bodyText}</div>
                    {bodyLong ? (
                      <button type="button" className="hist-body-toggle" onClick={() => setBodyOpen((open) => !open)}>
                        {bodyOpen ? '收起提交信息' : '展开提交信息'}
                      </button>
                    ) : null}
                  </>
                ) : null}

                <div className="hist-meta">
                  <span className="hist-meta-item hist-author-line">
                    <span className="hist-meta-strong">{commit.author.name}</span>
                    <span className="hist-meta-sep">·</span>
                    <span className="hist-meta-email mono truncate" title={commit.author.email}>
                      {commit.author.email}
                    </span>
                  </span>
                  <span className="hist-meta-item" title={absoluteTime(commit.author.time)}>
                    {absoluteTime(commit.author.time)}
                    <span className="subtle">· {relativeTime(commit.author.time)}</span>
                  </span>
                </div>

                {commit.parents.length > 0 ? (
                  <div className="hist-parents">
                    <span className="hist-parents-label">
                      {commit.parents.length > 1 ? (
                        <>
                          <GitMerge size={12} strokeWidth={1.7} /> parents
                        </>
                      ) : (
                        <>
                          <GitCommit size={12} strokeWidth={1.7} /> parent
                        </>
                      )}
                    </span>
                    {commit.parents.map((parent) => (
                      <button
                        key={parent}
                        type="button"
                        className="hist-parent mono"
                        title={`查看 ${parent}`}
                        onClick={() => onOpenCommit(parent)}
                      >
                        {hash7(parent)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="hist-parents">
                    <span className="hist-parents-label">root commit</span>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {commit ? (
            commit.files.length === 0 ? (
              <div className="hist-files hist-files--empty">
                <div className="hist-files-hd">
                  <span>文件 · 0</span>
                </div>
                <EmptyState
                  className="empty-compact"
                  art="changes"
                  title="没有文件变化"
                  desc="此提交只包含元数据或空提交。"
                />
              </div>
            ) : (
              <>
                <div className="hist-files">
                  <div className="hist-files-hd">
                    <span>文件 · {commit.stats.files}</span>
                    {commit.stats.additions > 0 ? <span className="stat-add">+{commit.stats.additions}</span> : null}
                    {commit.stats.deletions > 0 ? <span className="stat-del">−{commit.stats.deletions}</span> : null}
                  </div>
                  <div className="hist-files-list">
                    {commit.files.map((file) => (
                      <button
                        key={`${file.path}:${file.oldPath ?? ''}`}
                        type="button"
                        className={cn('hist-file', selectedFile === file.path && 'is-active')}
                        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                        onClick={() => setSelectedFile(file.path)}
                      >
                        <span className={cn('status-letter', `is-${statusTone(file.status)}`)}>
                          {statusLetter(file.status)}
                        </span>
                        <span className="hist-filepath truncate">
                          {dirName(file.path) ? <span className="subtle">{dirName(file.path)}/</span> : null}
                          {fileName(file.path)}
                        </span>
                        <span className="hist-file-stats">
                          {file.binary ? (
                            <span className="subtle">binary</span>
                          ) : (
                            <>
                              <span className="stat-add">+{file.additions}</span>
                              <span className="stat-del">−{file.deletions}</span>
                            </>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="hist-diff">
                  <DiffView
                    diff={diff.data}
                    loading={diff.loading}
                    emptyLabel={selectedFile ? '该文件没有可显示的差异' : '选择一个文件查看差异'}
                    showFileHeader={false}
                    compactToolbar
                    side="commit"
                  />
                </div>
              </>
            )
          ) : null}
        </>
      )}
    </div>
  )
}
