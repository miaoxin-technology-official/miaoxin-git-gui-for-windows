// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/store/app'
import { Button } from './ui/Button'
import { Banner, useToast } from './ui/Feedback'
import { ConfirmDialog } from './ui/Overlay'

function label(kind: string): string {
  switch (kind) {
    case 'merge':
      return '合并'
    case 'rebase':
      return '变基'
    case 'cherry-pick':
      return '拣选'
    case 'revert':
      return '还原'
    case 'am':
      return '应用补丁'
    case 'bisect':
      return '二分查找'
    default:
      return kind
  }
}

export function OperationBanner(): React.JSX.Element | null {
  const repo = useAppStore((s) => s.repo)
  const refresh = useAppStore((s) => s.refresh)
  const setSection = useAppStore((s) => s.setSection)
  const { toast } = useToast()
  const [busy, setBusy] = useState<'continue' | 'abort' | null>(null)
  const [confirmAbort, setConfirmAbort] = useState(false)

  if (!repo?.operation) return null
  const operation = repo.operation
  const conflicts = operation.conflicts.length

  async function run(kind: 'continue' | 'abort'): Promise<void> {
    if (!repo) return
    setBusy(kind)
    try {
      const result = kind === 'continue' ? await api.operation.continue(repo.path) : await api.operation.abort(repo.path)
      await refresh()
      if (!result.ok) {
        toast(
          kind === 'continue'
            ? conflicts > 0
              ? '仍有未解决的冲突，请处理后再继续'
              : '操作未能继续，请查看输出'
            : '中止操作失败',
          'error'
        )
      } else {
        toast(kind === 'continue' ? `${label(operation.kind)}已完成` : `已中止${label(operation.kind)}`, 'success')
      }
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
      setConfirmAbort(false)
    }
  }

  return (
    <div className="arb-operation-wrap">
      <Banner
        kind="warn"
        actions={
          <>
            {conflicts > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setSection('changes')}>
                处理冲突
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => void run('continue')} loading={busy === 'continue'}>
              继续
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAbort(true)}>
              中止
            </Button>
          </>
        }
      >
        <span className="arb-operation-title">
          <AlertTriangle size={13} strokeWidth={1.8} />
          {label(operation.kind)}尚未完成
          {conflicts > 0 ? ` · ${conflicts} 个文件存在冲突` : ''}
        </span>
        <span className="arb-operation-detail">
          {operation.detail || '解决冲突或确认改动后继续；也可以中止并回到操作前的状态。'}
        </span>
      </Banner>
      <ConfirmDialog
        open={confirmAbort}
        title={`中止${label(operation.kind)}？`}
        description="当前操作的中间状态会被清除，已修改的文件会保留在工作区，可以稍后手动处理。"
        confirmText="中止"
        danger
        loading={busy === 'abort'}
        onConfirm={() => void run('abort')}
        onCancel={() => setConfirmAbort(false)}
      />
    </div>
  )
}
