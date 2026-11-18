import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function formatNiceDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function statusPill(status) {
  const s = (status || '').toUpperCase();
  if (s === 'CONFIRMED' || s === 'CHECKED_IN' || s === 'ALLOCATED') {
    return { label: s === 'CHECKED_IN' ? 'Checked in' : 'Confirmed', cls: 'bg-[#DCFCE7] text-[#15803D]' };
  }
  if (s === 'QUEUED' || s === 'PENDING') {
    return { label: 'Pending', cls: 'bg-[#FEF3C7] text-[#B45309]' };
  }
  if (s === 'COMPLETED') {
    return { label: 'Completed', cls: 'bg-[#F1F5F9] text-[#475569]' };
  }
  if (s === 'REJECTED' || s === 'WAITLISTED' || s === 'NO_SHOW') {
    return { label: s === 'NO_SHOW' ? 'No-show' : 'Not allocated', cls: 'bg-[#FEE2E2] text-[#DC2626]' };
  }
  return { label: 'Cancelled', cls: 'bg-[#F1F5F9] text-[#64748B]' };
}

export default function StudentDashboardView({ onNavigate }) {
  const { profile, currentUser, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [fairness, setFairness] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activePass, setActivePass] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const headers = { 'x-user-id': currentUser };
      const [resFair, resMy, resNotif] = await Promise.all([
        fetch('/api/fairness/me', { headers }),
        fetch('/api/bookings/my-bookings', { headers }),
        fetch('/api/notifications', { headers })
      ]);

      if (resFair.ok) setFairness(await resFair.json());
      if (resNotif.ok) setNotifications(await resNotif.json());

      if (resMy.ok) {
        const myData = await resMy.json();
        const bList = myData.bookings || [];
        const rList = myData.pendingRequests || [];
        setBookings(bList);
        setPendingRequests(rList);

        const nextConfirmed = bList.find(b => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN');
        if (nextConfirmed) {
          const passRes = await fetch(`/api/bookings/${nextConfirmed.booking_id}/pass`);
          setActivePass(passRes.ok ? await passRes.json() : null);
        } else {
          setActivePass(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    setLoading(true);
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const refresh = () => {
      fetchDashboard();
      refreshProfile();
    };
    const unsubs = [
      subscribe('SLOT_UPDATED', refresh),
      subscribe('SCORE_CHANGED', refresh),
      subscribe('booking.confirmed', refresh),
      subscribe('booking.cancelled', refresh),
      subscribe('allocation.completed', refresh)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchDashboard, refreshProfile]);

  const handleCancelNext = async (bookingId) => {
    if (!window.confirm('Cancel this confirmed reservation? Voluntary cancellation carries 0 point penalty.')) return;
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
      body: JSON.stringify({ reason: 'Cancelled from student dashboard' })
    });
    if (res.ok) {
      setBanner({ type: 'success', text: 'Reservation cancelled with 0 penalty points.' });
      await fetchDashboard();
      await refreshProfile();
    } else {
      const d = await res.json();
      setBanner({ type: 'error', text: d.error || 'Could not cancel booking.' });
    }
  };

  const user = profile?.user;
  const firstName = (user?.name || 'Ganesh').split(' ')[0];
  const todayFull = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const policy = fairness?.policy;
  const baseScore = policy?.base_score ?? 100;
  const minFloor = policy?.min_priority_floor ?? 10;
  const normalRate = policy?.deduction_per_hour ?? 5;
  const peakRate = policy?.high_demand_deduction_per_hour ?? 10;

  const score = fairness?.currentScore ?? profile?.fairness?.current_score ?? baseScore;
  const totalHours = fairness?.totalHoursUsed ?? 0;
  const highDemandHours = fairness?.highDemandHours ?? 0;
  const completedCount = fairness?.completedBookings ?? 0;

  const nextBooking = bookings.find(b => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN');
  const latestReq = pendingRequests[0] || null;

  // Unified recent booking activity table
  const combinedActivity = [
    ...pendingRequests.map(r => ({
      id: r.request_id,
      date: r.booking_date,
      interval: `${r.start_time}–${r.end_time}`,
      prefs: r.preferred_label || r.preferred_machine_id || 'Any available PC',
      status: r.status || 'QUEUED'
    })),
    ...bookings.map(b => ({
      id: b.booking_id,
      date: b.booking_date,
      interval: `${b.start_time}–${b.end_time}`,
      prefs: b.display_label || b.machine_id,
      status: b.status
    }))
  ].slice(0, 6);

  const fallbackNotifs = [
    nextBooking && {
      notification_id: 'syn-1',
      title: 'Booking confirmed',
      message: `${nextBooking.display_label || nextBooking.machine_id} · ${formatShortDate(nextBooking.booking_date)}, ${nextBooking.start_time}`,
      time: 'Active'
    },
    latestReq && {
      notification_id: 'syn-2',
      title: 'Request in allocation queue',
      message: `${formatShortDate(latestReq.booking_date)}, ${latestReq.start_time}–${latestReq.end_time} · awaiting next round`,
      time: 'Pending'
    },
    {
      notification_id: 'syn-3',
      title: 'Priority score synced',
      message: `Current standing is ${score} / ${baseScore} pts (${totalHours}h total usage)`,
      time: 'Live'
    }
  ].filter(Boolean);

  const displayNotifs = notifications.length > 0 ? notifications.slice(0, 4) : fallbackNotifs;

  return (
    <div className="flex flex-col w-full gap-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">{todayFull}</p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('student-book')}
          className="h-10 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors inline-flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[17px]">add</span>
          <span>New booking request</span>
        </button>
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

      {/* Top 3-Card Row (Exact 02_student_dashboard.png layout) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Card 1: Fairness priority (4 cols) */}
        <div className="lg:col-span-4 fl-card p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-[13.5px] font-semibold text-[#0F172A]">Fairness priority</h2>
            <p className="text-[11.5px] text-[#64748B] mt-0.5">Higher score wins contested slots</p>

            {loading ? (
              <div className="h-12 w-28 rounded-xl bg-[#F1F5F9] animate-pulse mt-5" />
            ) : (
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-[40px] font-bold tracking-tight text-[#4F46E5] tabular-nums leading-none">
                  {score}
                </span>
                <span className="text-sm font-medium text-[#64748B] tabular-nums">/ {baseScore}</span>
              </div>
            )}

            <div className="mt-4 w-full h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
              <div
                className="h-full bg-[#4F46E5] rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(4, (score / Math.max(1, baseScore)) * 100))}%` }}
              />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#F1F5F9] space-y-1">
            <div className="text-[12px] text-[#475569] tabular-nums">
              {completedCount} completed sessions · {highDemandHours}h high-demand
            </div>
            <div className="text-[11px] font-mono text-[#94A3B8] tabular-nums">
              P = max({minFloor}, {baseScore} − {normalRate}×{totalHours} − {peakRate}×{highDemandHours})
            </div>
          </div>
        </div>

        {/* Card 2: Next booking (5 cols) */}
        <div className="lg:col-span-5 fl-card p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-4 h-full">
            <div className="flex flex-col justify-between flex-1 min-w-0">
              <div>
                <h2 className="text-[13.5px] font-semibold text-[#0F172A]">Next booking</h2>
                {nextBooking ? (
                  <>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#15803D] mt-2.5">
                      {nextBooking.status === 'CHECKED_IN' ? 'Checked in' : 'Confirmed'}
                    </span>
                    <div className="text-[22px] font-bold tracking-tight text-[#0F172A] mt-2 font-mono">
                      {nextBooking.display_label || nextBooking.machine_id}
                    </div>
                    <p className="text-xs text-[#64748B] mt-1 tabular-nums">
                      {formatNiceDate(nextBooking.booking_date)} · {nextBooking.start_time} – {nextBooking.end_time}
                    </p>
                  </>
                ) : (
                  <div className="mt-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F1F5F9] text-[#64748B]">
                      No upcoming pass
                    </span>
                    <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
                      Reserve any custom interval on Lab L-106 to generate your signed QR entry pass.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center gap-2">
                {nextBooking ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onNavigate('student-bookings')}
                      className="h-9 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs transition-colors"
                    >
                      View QR pass
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelNext(nextBooking.booking_id)}
                      className="h-9 px-4 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#334155] font-semibold text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate('student-book')}
                    className="h-9 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs transition-colors"
                  >
                    Book workstation
                  </button>
                )}
              </div>
            </div>

            {nextBooking && (
              <div className="w-24 h-24 rounded-xl border border-[#E5E7EB] bg-white p-1.5 flex items-center justify-center shrink-0 self-center">
                {activePass?.qrDataUrl ? (
                  <img src={activePass.qrDataUrl} alt="Access Pass QR" className="w-full h-full object-contain" />
                ) : (
                  <span className="material-symbols-outlined text-[42px] text-[#0F172A]">qr_code_2</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Latest request timeline (3 cols) */}
        <div className="lg:col-span-3 fl-card p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-[13.5px] font-semibold text-[#0F172A]">Latest request</h2>
            <p className="text-[11.5px] text-[#64748B] mt-0.5 tabular-nums">
              {latestReq
                ? `${formatShortDate(latestReq.booking_date)} · ${latestReq.start_time}–${latestReq.end_time}`
                : nextBooking
                ? `${formatShortDate(nextBooking.booking_date)} · ${nextBooking.start_time}–${nextBooking.end_time}`
                : 'No active request'}
            </p>

            <ol className="mt-4 space-y-3 text-xs">
              {[
                {
                  title: 'Submitted',
                  sub: latestReq ? 'Recorded with priority snapshot' : nextBooking ? 'Confirmed request' : 'Awaiting request',
                  done: Boolean(latestReq || nextBooking)
                },
                {
                  title: 'In allocation queue',
                  sub: latestReq ? 'Eligible for next round' : nextBooking ? 'Evaluated by fairness' : 'Not queued yet',
                  done: Boolean(latestReq || nextBooking)
                },
                {
                  title: 'Allocation round',
                  sub: nextBooking && !latestReq ? 'Seat assigned' : 'Daily scheduled round',
                  done: Boolean(nextBooking && !latestReq)
                },
                {
                  title: 'Result notification',
                  sub: 'Email + in-app',
                  done: Boolean(nextBooking && !latestReq)
                }
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                      step.done
                        ? 'bg-[#4F46E5]'
                        : 'bg-white border-2 border-[#CBD5E1]'
                    }`}
                  />
                  <div className="leading-tight">
                    <div className={`font-semibold ${step.done ? 'text-[#0F172A]' : 'text-[#64748B]'}`}>
                      {step.title}
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-0.5">{step.sub}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Bottom Split: My booking requests (8 cols) + Notifications (4 cols) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* My booking requests table */}
        <div className="lg:col-span-8 fl-card overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-[#F1F5F9]">
            <div>
              <h2 className="text-[14px] font-semibold text-[#0F172A]">My booking requests</h2>
              <p className="text-[11.5px] text-[#64748B] mt-0.5">Recent activity</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('student-bookings')}
              className="text-xs font-semibold text-[#4F46E5] hover:text-[#4338CA]"
            >
              View all
            </button>
          </div>

          {combinedActivity.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              No booking requests yet. Click &ldquo;New booking request&rdquo; to reserve a seat.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                  <tr>
                    <th className="py-3 px-6 font-medium">Interval</th>
                    <th className="py-3 px-4 font-medium">Preferences</th>
                    <th className="py-3 px-6 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {combinedActivity.map(row => {
                    const pill = statusPill(row.status);
                    return (
                      <tr key={row.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="py-4 px-6 font-semibold text-[#0F172A] tabular-nums whitespace-nowrap">
                          {formatShortDate(row.date)} · {row.interval}
                        </td>
                        <td className="py-4 px-4 text-[#475569] font-mono text-[11.5px]">{row.prefs}</td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Notifications card */}
        <div className="lg:col-span-4 fl-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#0F172A]">Notifications</h2>
              <p className="text-[11.5px] text-[#64748B] mt-0.5">Latest updates</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('student-notifications')}
              className="text-xs font-semibold text-[#4F46E5] hover:text-[#4338CA]"
            >
              All
            </button>
          </div>

          <div className="space-y-4">
            {displayNotifs.map(n => (
              <div key={n.notification_id} className="flex items-start gap-2.5">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${n.is_read ? 'bg-[#CBD5E1]' : 'bg-[#4F46E5]'}`} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#0F172A] leading-snug">{n.title}</div>
                  <div className="text-[11.5px] text-[#64748B] mt-0.5 leading-snug">{n.message}</div>
                  <div className="text-[10.5px] text-[#94A3B8] mt-1">
                    {n.created_at ? new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (n.time || 'Just now')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

