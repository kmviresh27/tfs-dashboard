import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../api/apiClient.js';

const VIEWED_KEY = 'av-notif-viewed';
const POLL_MS = 3 * 60 * 1000;
const PANEL_WIDTH = 320;

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function getItemTimestamp(item) {
  return item?.timestamp || item?.sentAt || item?.createdAt || item?.time || null;
}

function normalizeItems(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.history)
      ? payload.history
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  return list
    .filter(Boolean)
    .map((item, index) => {
      const timestamp = toTimestamp(getItemTimestamp(item));
      return {
        ...item,
        _timestamp: timestamp,
        _id: item.id ?? `${timestamp || 'notification'}-${index}`,
      };
    })
    .sort((a, b) => b._timestamp - a._timestamp);
}

function getNotificationKind(item) {
  const type = String(item?.type || 'digest').toLowerCase();
  if (type.includes('test')) return 'test';
  if (type.includes('anomaly') || type.includes('threshold')) return 'anomaly';
  return 'digest';
}

function getNotificationLabel(kind) {
  if (kind === 'test') return 'Test';
  if (kind === 'anomaly') return 'Anomaly';
  return 'Digest';
}

function getNotificationIcon(kind) {
  if (kind === 'test') return '🔔';
  if (kind === 'anomaly') return '🚨';
  return '📬';
}

function buildSummary(item) {
  if (item?.summary) return item.summary;
  return [
    item?.target ? `Target: ${item.target}` : null,
    Number.isFinite(Number(item?.count)) ? `Count: ${item.count}` : null,
    item?.status && item.status !== 'ok' ? `Status: ${item.status}` : null,
  ].filter(Boolean).join(' · ') || 'Notification update';
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Unknown';
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return 'Just now';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationCenter() {
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const [viewedAt, setViewedAt] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const raw = Number(window.localStorage.getItem(VIEWED_KEY) || 0);
    return Number.isFinite(raw) ? raw : 0;
  });

  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiFetch('/api/notifications/history');
      setItems(normalizeItems(data));
    } catch {
      // Keep the last successful history on transient fetch failures.
    }
  }, []);

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(8, rect.right - PANEL_WIDTH),
      Math.max(8, window.innerWidth - PANEL_WIDTH - 8)
    );
    setPanelPos({ top: rect.bottom + 8, left });
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = window.setInterval(loadNotifications, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    if (!open) return undefined;

    updatePosition();

    function handlePointerDown(event) {
      const insideButton = buttonRef.current?.contains(event.target);
      const insidePanel = panelRef.current?.contains(event.target);
      if (!insideButton && !insidePanel) setOpen(false);
    }

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open, updatePosition]);

  const visibleItems = useMemo(() => items.slice(0, 10), [items]);
  const unreadCount = useMemo(
    () => items.filter(item => item._timestamp > viewedAt).length,
    [items, viewedAt]
  );

  function handleToggle() {
    if (!open) {
      updatePosition();
      loadNotifications();
    }
    setOpen(prev => !prev);
  }

  function handleMarkAllRead() {
    const nextViewedAt = Date.now();
    window.localStorage.setItem(VIEWED_KEY, String(nextViewedAt));
    setViewedAt(nextViewedAt);
  }

  return (
    <div className="tb-notification-wrap">
      <button
        ref={buttonRef}
        className={`topbar-icon-btn tb-notification-btn${open ? ' active' : ''}`}
        type="button"
        title="Notification center"
        aria-label="Notification center"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleToggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && <span className="tb-notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="tb-notification-panel"
          role="dialog"
          aria-label="Notification history"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          <div className="tb-notification-header">
            <div>
              <div className="tb-notification-title">Notifications</div>
              <div className="tb-notification-subtitle">
                {items.length
                  ? `Last ${Math.min(items.length, 10)} history item${Math.min(items.length, 10) === 1 ? '' : 's'}`
                  : 'History updates will appear here'}
              </div>
            </div>
            <button
              type="button"
              className="tb-notification-mark"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
          </div>

          {visibleItems.length ? (
            <div className="tb-notification-list">
              {visibleItems.map(item => {
                const kind = getNotificationKind(item);
                return (
                  <div key={item._id} className="tb-notification-item">
                    <div className="tb-notification-item-icon" data-kind={kind}>{getNotificationIcon(kind)}</div>
                    <div className="tb-notification-item-body">
                      <div className="tb-notification-item-meta">
                        <span className="tb-notification-item-type">{getNotificationLabel(kind)}</span>
                        <span className="tb-notification-item-time">{formatTimeAgo(item._timestamp)}</span>
                      </div>
                      <div className="tb-notification-item-summary">{buildSummary(item)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tb-notification-empty">No notifications yet</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
