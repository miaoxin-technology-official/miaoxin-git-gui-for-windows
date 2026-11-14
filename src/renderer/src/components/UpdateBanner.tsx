// SPDX-License-Identifier: AGPL-3.0-or-later
import { Download, ExternalLink, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/app'
import { Button } from './ui/Button'

export function UpdateBanner(): React.JSX.Element | null {
  const info = useAppStore((s) => s.updateInfo)
  const downloading = useAppStore((s) => s.updateDownloading)
  const dismissed = useAppStore((s) => s.updateDismissedTag)
  const downloadUpdate = useAppStore((s) => s.downloadUpdate)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  if (!info?.updateAvailable || !info.latestTag || dismissed === info.latestTag) return null

  return (
    <div className="arb-update-card" role="status">
      <button type="button" className="arb-update-close" aria-label="关闭更新提示" onClick={dismissUpdate}>
        <X size={14} strokeWidth={1.8} />
      </button>
      <div className="arb-update-text">
        发现新版本 <strong className="mono">{info.latestVersion ?? info.latestTag}</strong>，请更新后使用
      </div>
      <div className="arb-update-actions">
        <Button
          size="sm"
          variant="ghost"
          icon={ExternalLink}
          onClick={() => void api.updates.openTag(info.latestTag as string)}
        >
          查看发布页
        </Button>
        <Button size="sm" variant="primary" icon={Download} loading={downloading} onClick={() => void downloadUpdate()}>
          立即更新
        </Button>
      </div>
    </div>
  )
}
