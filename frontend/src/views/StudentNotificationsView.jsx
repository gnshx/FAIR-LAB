import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function StudentNotificationsView() {
  const { currentUser } = useAuth();
  const { subscribe } = useSocket();

  const [filter, setFilter] = useState('ALL');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState({
    bookingOutcome: true,
    roundCloses: true,
    checkInReminder: true,
    scoreChanges: false
  });

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', {
        headers: { 'x-user-id': currentUser }
      });
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    setLoading(true);
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const unsubs = [
      subscribe('booking.confirmed', fetchNotifications),
      subscribe('booking.cancelled', fetchNotifications),
      subscribe('allocation.completed', fetchNotifications)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchNotifications]);

  const handleMarkAllRead = async () => {
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
      body: JSON.stringify({})
    });
    setItems(prev => prev.map(i => ({ ...i, is_read: 1 })));
  };

  const unreadCount = items.filter(i => !i.is_read).length;

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filter === 'UNREAD') return !i.is_read;
      if (filter === 'BOOKINGS') return (i.type || '').toUpperCase().includes('BOOKING') || (i.type || '').toUpperCase().includes('ALLOCATION');
      if (filter === 'SYSTEM') return !(i.type || '').toUpperCase().includes('BOOKING');
      return true;
    });
  }, [items, filter]);

  const togglePref = (key) => setPrefs(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Notifications
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Booking results and system updates
          </p>
        </div>

        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
          className="h-9 px-4 rounded-xl bg-white hover:bg-[#F8FAFC] disabled:opacity-50 border border-[#E5E7EB] text-xs font-semibold text-[#0F172A] transition-colors self-start sm:self-auto"
        >
          Mark all as read
        </button>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'ALL', label: 'All' },
          { id: 'UNREAD', label: `Unread · ${unreadCount}` },
          { id: 'BOOKINGS', label: 'Bookings' },
          { id: 'SYSTEM', label: 'System' }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`h-8 px-4 rounded-full text-xs font-semibold transition-colors ${
              filter === tab.id
                ? 'bg-[#4F46E5] text-white'
                : 'bg-white border border-[#E5E7EB] text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Split Layout (Exact 06_student_notifications.png) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <section className="xl:col-span-8 fl-card p-6">
          <h2 className="text-[14px] font-bold text-[#0F172A] mb-4">Latest</h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-xl bg-[#F1F5F9] animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              You&apos;re all caught up — no notifications in this category.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(n => {
                const unread = !n.is_read;
                return (
                  <div
                    key={n.notification_id}
                    className={`px-4 py-3.5 rounded-xl flex items-start justify-between gap-4 transition-colors ${
                      unread ? 'bg-[#EEF2FF]' : 'bg-white hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          unread ? 'bg-[#4F46E5]' : 'bg-[#CBD5E1]'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0F172A]">{n.title}</div>
                        <div className="text-xs text-[#64748B] mt-0.5">{n.message}</div>
                      </div>
                    </div>
                    <span className="text-[11px] text-[#94A3B8] shrink-0 whitespace-nowrap tabular-nums">
                      {n.created_at ? new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Just now'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Delivery Preferences */}
        <aside className="xl:col-span-4 fl-card p-6">
          <h2 className="text-[14px] font-bold text-[#0F172A]">Notify me when</h2>
          <p className="text-xs text-[#64748B] mt-0.5 mb-5">Delivery preferences</p>

          <div className="divide-y divide-[#F1F5F9]">
            {[
              { key: 'bookingOutcome', label: 'Booking confirmed or rejected' },
              { key: 'roundCloses', label: 'Allocation round closes' },
              { key: 'checkInReminder', label: 'Check-in reminder' },
              { key: 'scoreChanges', label: 'Priority score changes' }
            ].map(item => {
              const on = prefs[item.key];
              return (
                <div key={item.key} className="py-4 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[#0F172A]">{item.label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => togglePref(item.key)}
                    className={`w-10 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                      on ? 'bg-[#4F46E5] justify-end' : 'bg-[#E2E8F0] justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

