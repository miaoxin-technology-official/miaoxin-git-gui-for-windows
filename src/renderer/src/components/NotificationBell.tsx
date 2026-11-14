// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { relativeTime } from '@/lib/format'
import { useAppStore } from '@/store/app'
import { IconButton } from './ui/Button'

export function NotificationBell(): React.JSX.Element {
  const notifications = useAppStore((s) => s.notifications)
  const markRead = useAppStore((s) => s.markNotificationsRead)
  const clear = useAppStore((s) => s.clearNotifications)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const unread = notifications.filter((item) => !item.read).length

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div className="arb-notif-wrap" ref={wrapRef}>
      <div className="arb-notif-btn">
        <IconButton
          icon={Bell}
          label={`通知${unread > 0 ? `（${unread} 条未读）` : ''}`}
          size={24}
          active={open}
          onClick={() => {
            setOpen((value) => !value)
            if (!open) markRead()
          }}
        />
        {unread > 0 ? <span className="arb-notif-badge num">{unread > 99 ? '99+' : unread}</span> : null}
      </div>
      {open ? (
        <div className="arb-notif-panel">
          <div className="arb-notif-head">
            <span className="arb-notif-title">通知</span>
            <div className="arb-notif-head-actions">
              <button
                type="button"
                className="arb-iconbtn"
                title="全部标记为已读"
                disabled={unread === 0}
                onClick={() => markRead()}
              >
                <CheckCheck size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="arb-iconbtn"
                title="清空通知"
                disabled={notifications.length === 0}
                onClick={() => clear()}
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          <div className="arb-notif-list scroll-y">
            {notifications.length === 0 ? (
              <div className="arb-notif-empty">暂无通知</div>
            ) : (
              notifications.map((item) => (
                <div className={`arb-notif-item is-${item.kind}`} key={item.id}>
                  <span className="arb-notif-dot" />
                  <div className="arb-notif-body">
                    <div className="arb-notif-message">{item.title}</div>
                    {item.detail ? <div className="arb-notif-detail">{item.detail}</div> : null}
                    <div className="arb-notif-time">{relativeTime(Math.floor(item.time / 1000))}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
