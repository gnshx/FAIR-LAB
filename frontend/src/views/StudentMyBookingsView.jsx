import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function formatShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function addMinutes(timeStr, mins) {
  if (!timeStr || !timeStr.includes(':')) return '—';
  const [h, m] = timeStr.split(':').map(Number);
  const total = Math.max(0, h * 60 + m + mins);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function StudentMyBookingsView({ onNavigateToBook, onNavigate }) {
  const { currentUser, refreshProfile, switchUser, availableUsers } = useAuth();
  const { subscribe } = useSocket();

  const [filter, setFilter] = useState('UPCOMING');
  const [bookings, setBookings] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [activePass, setActivePass] = useState(null);
  const [isQrMaximized, setIsQrMaximized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsQrMaximized(false);
    };
    if (isQrMaximized) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQrMaximized]);

  const loadPass = useCallback(async (bookingId) => {
    if (!bookingId) {
      setActivePass(null);
      return;
    }
    try {
      const res = await fetch(`/api/bookings/${bookingId}/pass`);
      setActivePass(res.ok ? await res.json() : null);
    } catch {
      setActivePass(null);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/bookings/my-bookings', {
        headers: { 'x-user-id': currentUser }
      });
      if (res.ok) {
        const data = await res.json();
        const bList = data.bookings || [];
        const rList = data.pendingRequests || [];
        setBookings(bList);
        setPendingRequests(rList);

        const todayStr = getTodayStr();
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const defaultActive = bList.find(b => {
          if (b.status !== 'CONFIRMED' && b.status !== 'CHECKED_IN') return false;
          if (b.booking_date > todayStr) return true;
          if (b.booking_date === todayStr) {
            const [endH, endM] = (b.end_time || '23:59').split(':').map(Number);
            return (endH * 60 + (endM || 0)) > nowMinutes;
          }
          return false;
        });
        if (defaultActive) {
          setSelectedBookingId(prev => (bList.some(b => b.booking_id === prev && (b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') && b.booking_date >= todayStr) ? prev : defaultActive.booking_id));
          await loadPass(defaultActive.booking_id);
        } else {
          setSelectedBookingId(null);
          setActivePass(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [currentUser, loadPass]);

  useEffect(() => {
    setLoading(true);
    setSelectedBookingId(null);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const refresh = () => {
      fetchData();
      refreshProfile();
    };
    const unsubs = [
      subscribe('SLOT_UPDATED', refresh),
      subscribe('booking.confirmed', refresh),
      subscribe('booking.cancelled', refresh),
      subscribe('allocation.completed', refresh)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchData, refreshProfile]);

  const handleFilterChange = (tabId) => {
    setFilter(tabId);
    if (tabId === 'UPCOMING') {
      const todayStr = getTodayStr();
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const active = bookings.find(b => {
        if (b.status !== 'CONFIRMED' && b.status !== 'CHECKED_IN') return false;
        if (b.booking_date > todayStr) return true;
        if (b.booking_date === todayStr) {
          const [endH, endM] = (b.end_time || '23:59').split(':').map(Number);
          return (endH * 60 + (endM || 0)) > nowMinutes;
        }
        return false;
      });
      if (active) {
        setSelectedBookingId(active.booking_id);
        loadPass(active.booking_id);
      } else {
        setSelectedBookingId(null);
        setActivePass(null);
      }
    } else {
      setSelectedBookingId(null);
      setActivePass(null);
    }
  };

  const handleSelectRow = (row) => {
    if (row.kind === 'BOOKING') {
      setSelectedBookingId(row.id);
      loadPass(row.id);
    } else {
      setSelectedBookingId(row.id);
      setActivePass(null);
    }
  };

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Cancel this reservation? Voluntary cancellation carries 0 point penalty.')) return;
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
      body: JSON.stringify({ reason: 'Student cancelled from My Bookings' })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: 'Reservation cancelled cleanly with 0 penalty points.' });
      setActivePass(null);
      setSelectedBookingId(null);
      await fetchData();
      await refreshProfile();
    } else {
      setBanner({ type: 'error', text: d.error || 'Could not cancel booking.' });
    }
  };

  const handleWithdrawRequest = async (requestId) => {
    const res = await fetch(`/api/booking-requests/${requestId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': currentUser }
    });
    if (res.ok) {
      setBanner({ type: 'success', text: 'Queued request withdrawn with 0 penalty points.' });
      await fetchData();
    }
  };

  const handleDownloadPass = () => {
    if (activePass?.qrDataUrl) {
      const a = document.createElement('a');
      a.href = activePass.qrDataUrl;
      a.download = `fairlab-pass-${activePass.booking_id}.png`;
      a.click();
    } else {
      window.print();
    }
  };

  const handleOpenInGateDesk = async () => {
    if (!activePass?.signed_token) return;
    try {
      const gateDesk = availableUsers?.find(u => u.email === 'accessdesk.l106@iitbhilai.ac.in') || { user_id: 'usr-watchman-ram' };
      if (switchUser && gateDesk?.user_id) {
        await switchUser(gateDesk.user_id);
      }
      if (typeof window !== 'undefined') {
        window.history.pushState(null, '', `/access?token=${encodeURIComponent(activePass.signed_token)}`);
      }
      if (onNavigate) {
        onNavigate('admin-access');
      } else if (typeof window !== 'undefined') {
        window.location.href = `/access?token=${encodeURIComponent(activePass.signed_token)}`;
      }
    } catch {
      if (typeof window !== 'undefined') {
        window.location.href = `/access?token=${encodeURIComponent(activePass.signed_token)}`;
      }
    }
  };

  const unifiedRows = useMemo(() => {
    const bRows = bookings.map(b => ({
      kind: 'BOOKING',
      id: b.booking_id,
      workstation: b.display_label || b.machine_id,
      date: b.booking_date,
      start: b.start_time,
      end: b.end_time,
      status: b.status,
      checkInBy: b.status === 'CONFIRMED' ? addMinutes(b.start_time, 15) : '—'
    }));
    const rRows = pendingRequests.map(r => ({
      kind: 'REQUEST',
      id: r.request_id,
      workstation: r.preferred_label || r.preferred_machine_id || 'Any available PC',
      date: r.booking_date,
      start: r.start_time,
      end: r.end_time,
      status: r.status || 'QUEUED',
      checkInBy: '—'
    }));
    return [...bRows, ...rRows];
  }, [bookings, pendingRequests]);

  const counts = useMemo(() => ({
    UPCOMING: unifiedRows.filter(r => r.status === 'CONFIRMED' || r.status === 'CHECKED_IN' || r.status === 'QUEUED').length,
    PENDING: unifiedRows.filter(r => r.status === 'QUEUED' || r.status === 'PENDING').length,
    PAST: unifiedRows.filter(r => r.status === 'COMPLETED' || r.status === 'NO_SHOW' || r.status === 'WAITLISTED').length,
    CANCELLED: unifiedRows.filter(r => r.status === 'CANCELLED').length
  }), [unifiedRows]);

  const visibleRows = useMemo(() => {
    if (filter === 'UPCOMING') {
      return unifiedRows.filter(
        r => r.status === 'CONFIRMED' || r.status === 'CHECKED_IN' || r.status === 'QUEUED' || r.status === 'PENDING'
      );
    }
    if (filter === 'PENDING') return unifiedRows.filter(r => r.status === 'QUEUED' || r.status === 'PENDING');
    if (filter === 'PAST') return unifiedRows.filter(r => r.status === 'COMPLETED' || r.status === 'NO_SHOW' || r.status === 'WAITLISTED');
    if (filter === 'CANCELLED') return unifiedRows.filter(r => r.status === 'CANCELLED');
    return unifiedRows;
  }, [unifiedRows, filter]);

  const isPassDisplayable = useMemo(() => {
    if (!activePass) return false;
    // If explicitly selected a specific booking
    if (selectedBookingId && selectedBookingId === activePass.booking_id) return true;
    // In UPCOMING view, only display if user has an active upcoming booking
    if (filter === 'UPCOMING') {
      const todayStr = getTodayStr();
      return bookings.some(b => b.booking_id === activePass.booking_id && (b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') && b.booking_date >= todayStr);
    }
    return false;
  }, [activePass, selectedBookingId, filter, bookings]);

  const renderBadge = (status) => {
    const s = (status || '').toUpperCase();
    if (s === 'CONFIRMED' || s === 'CHECKED_IN') return { label: s === 'CHECKED_IN' ? 'Checked in' : 'Confirmed', cls: 'bg-[#DCFCE7] text-[#15803D]' };
    if (s === 'QUEUED' || s === 'PENDING') return { label: 'Pending', cls: 'bg-[#FEF3C7] text-[#B45309]' };
    if (s === 'COMPLETED') return { label: 'Completed', cls: 'bg-[#F1F5F9] text-[#475569]' };
    if (s === 'WAITLISTED' || s === 'NO_SHOW') return { label: s === 'NO_SHOW' ? 'No-show' : 'Not allocated', cls: 'bg-[#FEE2E2] text-[#DC2626]' };
    return { label: 'Cancelled', cls: 'bg-[#F1F5F9] text-[#64748B]' };
  };

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            My bookings
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Confirmed reservations, requests and QR passes
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateToBook}
          className="h-10 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors inline-flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[17px]">add</span>
          <span>New booking request</span>
        </button>
      </div>

      {/* Filter Pills (Exact 04_student_my_bookings.png) */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'UPCOMING', label: `Upcoming · ${counts.UPCOMING}` },
          { id: 'PENDING', label: `Pending · ${counts.PENDING}` },
          { id: 'PAST', label: 'Past' },
          { id: 'CANCELLED', label: 'Cancelled' }
        ].map(tab => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleFilterChange(tab.id)}
              className={`h-8 px-4 rounded-full text-xs font-semibold transition-colors ${
                active
                  ? 'bg-[#4F46E5] text-white'
                  : 'bg-white border border-[#E5E7EB] text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D]'
              : 'bg-[#FEE2E2] border-[#FECACA] text-[#DC2626]'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Main Split: Reservations Table (8 cols) + QR Access Pass (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        <section className="xl:col-span-8 fl-card overflow-hidden">
          <div className="px-6 py-4 border-b border-[#F1F5F9]">
            <h2 className="text-[14px] font-bold text-[#0F172A]">Reservations</h2>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 rounded-xl bg-[#F1F5F9] animate-pulse" />
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="py-14 text-center text-xs text-[#64748B]">
              No reservations found in this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                  <tr>
                    <th className="py-3 px-6 font-medium">Workstation</th>
                    <th className="py-3 px-4 font-medium">Date</th>
                    <th className="py-3 px-4 font-medium">Interval</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-6 font-medium">Check-in by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {visibleRows.map(row => {
                    const badge = renderBadge(row.status);
                    const isSelected = selectedBookingId === row.id;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => handleSelectRow(row)}
                        className={`transition-colors ${
                          row.kind === 'BOOKING' ? 'cursor-pointer' : ''
                        } ${isSelected ? 'bg-[#EEF2FF]/60' : 'hover:bg-[#F8FAFC]'}`}
                      >
                        <td className="py-4 px-6 font-bold text-[#0F172A] font-mono">{row.workstation}</td>
                        <td className="py-4 px-4 text-[#475569] whitespace-nowrap">{formatShort(row.date)}</td>
                        <td className="py-4 px-4 text-[#475569] font-mono tabular-nums whitespace-nowrap">
                          {row.start} – {row.end}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-[#475569] font-mono tabular-nums">
                          {row.kind === 'REQUEST' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWithdrawRequest(row.id);
                              }}
                              className="text-[#DC2626] hover:underline font-sans font-semibold text-[11px]"
                            >
                              Withdraw
                            </button>
                          ) : (
                            row.checkInBy
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right: QR Access Pass Panel */}
        <aside
          id="printable-pass-card"
          className={`xl:col-span-4 fl-card p-4 sm:p-6 flex flex-col justify-between ${
            isPassDisplayable ? 'order-first xl:order-last' : ''
          }`}
        >
          {isPassDisplayable ? (
            <>
              <div>
                <h2 className="text-[14px] font-bold text-[#0F172A]">QR access pass</h2>
                <p className="text-xs text-[#64748B] mt-0.5 font-mono">
                  {activePass.machine_id} · {formatShort(activePass.booking_date)} · {activePass.start_time} – {activePass.end_time}
                </p>

                <div className="my-7 flex flex-col items-center justify-center">
                  <div
                    role="button"
                    tabIndex={0}
                    onDoubleClick={() => setIsQrMaximized(true)}
                    className="relative group w-44 h-44 rounded-2xl border-2 border-[#E5E7EB] bg-white p-3 flex items-center justify-center shadow-sm cursor-zoom-in hover:border-[#4F46E5] hover:shadow-md transition-all select-none"
                    title="Double-click to maximize QR pass"
                  >
                    {activePass.qrDataUrl ? (
                      <img src={activePass.qrDataUrl} alt="Signed QR Pass" className="w-full h-full object-contain pointer-events-none" />
                    ) : (
                      <span className="material-symbols-outlined text-[64px] text-[#0F172A]">qr_code_2</span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsQrMaximized(true);
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-[#0F172A]/70 hover:bg-[#4F46E5] text-white flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity"
                      title="Maximize QR pass"
                    >
                      <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsQrMaximized(true)}
                    className="text-[11px] text-[#64748B] hover:text-[#4F46E5] flex items-center gap-1 mt-2 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">zoom_in</span>
                    <span>Double-click to maximize</span>
                  </button>
                </div>

                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between py-2 border-b border-[#F1F5F9]">
                    <span className="text-[#64748B]">Status</span>
                    <strong className="text-[#0F172A] font-semibold">
                      {activePass.booking_status === 'CHECKED_IN' || activePass.status === 'CHECKED_IN'
                        ? 'Checked in · active'
                        : activePass.booking_status === 'COMPLETED' || activePass.status === 'USED'
                        ? 'Completed'
                        : activePass.booking_status === 'CANCELLED' || activePass.status === 'REVOKED'
                        ? 'Cancelled'
                        : activePass.booking_status === 'NO_SHOW' || activePass.status === 'EXPIRED'
                        ? 'No-show / expired'
                        : 'Valid · unused'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-[#F1F5F9]">
                    <span className="text-[#64748B]">Check-in window</span>
                    <strong className="text-[#0F172A] font-mono tabular-nums">
                      {addMinutes(activePass.start_time, -15)} – {addMinutes(activePass.start_time, 15)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">Token</span>
                    <strong className="text-[#0F172A] font-semibold">Single-use, no personal data</strong>
                  </div>
                </div>
              </div>

              <div className="mt-7 space-y-2.5">
                {(activePass.booking_status === 'CONFIRMED' || activePass.booking_status === 'CHECKED_IN') && (
                  <button
                    type="button"
                    onClick={handleOpenInGateDesk}
                    className="w-full h-10 rounded-xl bg-[#10B981] hover:bg-[#059669] text-white font-semibold text-xs shadow-brand flex items-center justify-center gap-1.5 transition-colors"
                    title="Verify this digital pass at the physical Lab L-106 Turnstile Gate Scanner"
                  >
                    <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                    <span>Verify at Turnstile Gate (Demo)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadPass}
                  className="w-full h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
                >
                  Download pass
                </button>
                {activePass.booking_status === 'CONFIRMED' && (
                  <button
                    type="button"
                    onClick={() => handleCancelBooking(activePass.booking_id)}
                    className="w-full h-10 rounded-xl bg-white hover:bg-[#FEF2F2] border border-[#E5E7EB] hover:border-[#FECACA] text-[#0F172A] hover:text-[#DC2626] font-semibold text-xs transition-colors"
                  >
                    Cancel reservation
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-[24px]">qr_code_2</span>
              </div>
              <h3 className="text-sm font-bold text-[#0F172A]">No active QR pass</h3>
              <p className="text-xs text-[#64748B] mt-1 mb-5 max-w-[240px]">
                Book a workstation to receive a single-use HMAC-SHA256 entry pass.
              </p>
              <button
                type="button"
                onClick={onNavigateToBook}
                className="h-9 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs"
              >
                Book workstation
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Maximized QR Pass Lightbox Modal */}
      {isQrMaximized && activePass && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setIsQrMaximized(false)}
          className="fixed inset-0 z-50 bg-[#0F172A]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => setIsQrMaximized(false)}
            className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#E2E8F0] relative text-center flex flex-col items-center select-none"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setIsQrMaximized(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#475569] flex items-center justify-center transition-colors"
              title="Close (Esc)"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EEF2FF] text-[#4F46E5] text-xs font-bold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-[#4F46E5]" />
              IIT Bhilai · Lab L-106 Pass
            </div>

            <h3 className="text-2xl font-black text-[#0F172A] tracking-tight font-mono">
              {activePass.machine_id}
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5 font-medium">
              {formatShort(activePass.booking_date)} · {activePass.start_time} – {activePass.end_time}
            </p>

            {/* High-Resolution QR Container */}
            <div
              onDoubleClick={() => setIsQrMaximized(false)}
              className="my-5 p-4 sm:p-5 bg-white rounded-3xl border-2 border-[#0F172A] shadow-lg flex items-center justify-center w-64 h-64 sm:w-80 sm:h-80 max-w-[78vw] max-h-[78vw] cursor-zoom-out"
              title="Double-click to minimize"
            >
              {activePass.qrDataUrl ? (
                <img
                  src={activePass.qrDataUrl}
                  alt="Maximized Signed QR Pass"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="material-symbols-outlined text-[96px] text-[#0F172A]">qr_code_2</span>
              )}
            </div>

            <div className="w-full bg-[#F8FAFC] rounded-2xl p-3 border border-[#E2E8F0] text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Check-in window:</span>
                <span className="font-mono font-bold text-[#0F172A]">
                  {addMinutes(activePass.start_time, -15)} – {addMinutes(activePass.start_time, 15)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Pass ID:</span>
                <span className="font-mono text-[11px] font-semibold text-[#475569]">
                  {activePass.booking_id}
                </span>
              </div>
            </div>

            <div className="mt-5 w-full flex items-center gap-3">
              {(activePass.booking_status === 'CONFIRMED' || activePass.booking_status === 'CHECKED_IN') && (
                <button
                  type="button"
                  onClick={() => {
                    setIsQrMaximized(false);
                    handleOpenInGateDesk();
                  }}
                  className="flex-1 h-11 rounded-xl bg-[#10B981] hover:bg-[#059669] text-white font-semibold text-xs shadow-brand flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                  <span>Verify Gate</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDownloadPass}
                className="flex-1 h-11 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Download</span>
              </button>
            </div>

            <p className="text-[11px] text-[#94A3B8] mt-3">
              Press <kbd className="px-1.5 py-0.5 rounded bg-[#F1F5F9] font-mono text-[10px]">Esc</kbd> or double-click to minimize
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

