import { useLayoutEffect, useRef, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { useHotkeys } from '@/lib/useHotkeys'
import { useAppStore } from '@/store/app'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Fields'

interface CommitBoxProps {
  repo: string
  /** number of files in the index */
  stagedCount: number
  /** unstaged + untracked files, used for the "stage all and commit" affordance */
  worktreeCount: number
}

const MIN_INPUT_HEIGHT = 88
const MAX_INPUT_HEIGHT = 208

/**
 * Commit message editor pinned to the bottom of the Changes list. Deliberately
 * borderless: it should read as an editor strip, not as a form.
 */
export function CommitBox({ repo, stagedCount, worktreeCount }: CommitBoxProps): React.JSX.Element {
  const refresh = useAppStore((state) => state.refresh)
  const pushToast = useAppStore((state) => state.pushToast)
  const branch = useAppStore((state) => state.repo?.branch ?? null)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [stagingAll, setStagingAll] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busy = committing || stagingAll

  // auto-grow: at least 4 lines, at most ~12 lines before scrolling internally
  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(Math.max(element.scrollHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT)}px`
  }, [message])

  const trimmed = message.trim()
  const canCommitStaged = trimmed.length > 0 && stagedCount > 0 && !busy
  const canStageAll = worktreeCount > 0 && !busy
  const branchLabel = branch ? (branch.length > 16 ? `${branch.slice(0, 15)}…` : branch) : null
  const commitLabel =
    stagedCount === 0 ? '没有已暂存的改动' : branchLabel ? `提交到 ${branchLabel}` : '提交'

  const stageAllChanges = async (): Promise<void> => {
    if (busy || worktreeCount === 0) return
    setStagingAll(true)
    try {
      await api.changes.stageAll(repo)
      pushToast('已暂存全部改动', 'success')
      await refresh()
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    } finally {
      setStagingAll(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    const text = message.trim()
    if (text.length === 0) {
      pushToast('提交信息不能为空', 'error')
      return
    }
    if (stagedCount === 0) {
      pushToast('暂存区没有可提交的改动，请先暂存（Add）', 'error')
      return
    }
    setCommitting(true)
    try {
      const result = await api.commit(repo, { message: text, amend })
      setMessage('')
      setAmend(false)
      pushToast(`已提交 ${result.shortHash}`, 'success')
      await refresh()
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    } finally {
      setCommitting(false)
    }
  }

  const commitBest = (): void => {
    const state = useAppStore.getState()
    if (state.settingsOpen || state.paletteOpen || state.cloneOpen || state.initOpen) return
    if (stagedCount > 0) void submit()
    else pushToast('暂存区没有可提交的改动，请先暂存（Add）', 'error')
  }

  useHotkeys({ 'mod+enter': commitBest }, { allowInInputs: true })

  return (
    <div className="changes-commit">
      <textarea
        ref={inputRef}
        rows={4}
        className="changes-commit-input"
        placeholder="提交信息（首行为标题）"
        value={message}
        spellCheck={false}
        onChange={(event) => setMessage(event.target.value)}
      />

      <div className="changes-commit-bar">
        <div className="changes-commit-left">
          <Checkbox checked={amend} onChange={setAmend} label="amend" />
          {trimmed.length > 0 ? (
            <span className="changes-commit-count num">{trimmed.length} 字符</span>
          ) : null}
        </div>
        <div className="changes-commit-right">
          <Button
            variant="secondary"
            size="sm"
            loading={stagingAll}
            disabled={!canStageAll}
            onClick={() => void stageAllChanges()}
            title="暂存全部改动（Add），不会提交"
          >
            暂存全部改动
          </Button>
          <Button
            variant="primary"
            loading={committing}
            disabled={!canCommitStaged}
            onClick={() => void submit()}
            title={stagedCount === 0 ? '先暂存改动才能提交' : '只提交已暂存的改动'}
          >
            {commitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
