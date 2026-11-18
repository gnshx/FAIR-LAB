import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function DashboardView({ onNavigate }) {
  const { profile, currentUser } = useAuth();
  const { subscribe } = useSocket();

  const [availability, setAvailability] = useState(null);
  const [fairness, setFairness] = useState(null);
  const [myBookings, setMyBookings] = useState({ bookings: [], pendingRequests: [] });
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const [resAvail, resFair, resMy, resLead] = await Promise.all([
        fetch('/api/v1/availability?labId=L106'),
        fetch('/api/v1/fairness/me', { headers: { 'x-user-id': currentUser } }),
        fetch('/api/v1/bookings/my-bookings', { headers: { 'x-user-id': currentUser } }),
        fetch('/api/v1/fairness/leaderboard?limit=50')
      ]);

      if (resAvail.ok) setAvailability(await resAvail.json());
      if (resFair.ok) setFairness(await resFair.json());
      if (resMy.ok) setMyBookings(await resMy.json());
      if (resLead.ok) setLeaderboard(await resLead.json());
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    setLoading(true);
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const unsubs = [
      subscribe('SLOT_UPDATED', fetchDashboard),
      subscribe('booking.confirmed', fetchDashboard),
      subscribe('booking.cancelled', fetchDashboard),
      subscribe('QUEUE_CHANGED', fetchDashboard)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchDashboard]);

  const user = profile?.user;
  const firstName = (user?.name || 'Ganesh').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const score = fairness?.currentScore ?? profile?.fairness?.current_score ?? 100;
  const dailyQuota = fairness?.dailyQuota;
  const activeBookings = (myBookings.bookings || []).filter(b => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN');
  const pendingReqs = myBookings.pendingRequests || [];

  const summary = availability?.summary;
  const freeNow = summary?.slotAvailableCount ?? 0;
  const onlineTotal = summary?.onlineCount ?? 82;

  // Cohort fairness tier breakdown for segmented bar
  const cohort = leaderboard?.students || [];
  const tierHigh = cohort.filter(s => s.current_score >= 90).length;
  const tierMid = cohort.filter(s => s.current_score >= 70 && s.current_score < 90).length;
  const tierLow = cohort.filter(s => s.current_score < 70).length;
  const cohortTotal = Math.max(1, cohort.length);
  const pctHigh = Math.round((tierHigh / cohortTotal) * 100);
  const pctMid = Math.round((tierMid / cohortTotal) * 100);
  const pctLow = Math.max(0, 100 - pctHigh - pctMid);

  return (
    <div className="flex flex-col w-full gap-6 text-[#1D2939]">
      {/* Greeting Hero Header (exact EazyBook layout from design/dashborad -css and uiux.png) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#101828]">
            {greeting},{' '}
            <span className="italic text-[#5B4CF5] font-semibold">{firstName}</span>
          </h1>
          <p className="text-sm text-[#475467] mt-1">
            Lab L-106 has <strong className="font-semibold text-[#1D2939]">{onlineTotal} online workstations</strong> ({freeNow} open in current interval) and{' '}
            <strong className="font-semibold text-[#1D2939]">{activeBookings.length} active reservation{activeBookings.length !== 1 ? 's' : ''}</strong> for you today.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('lab-seat-map')}
          className="h-11 px-5 rounded-xl bg-[#5B4CF5] hover:bg-[#4B3CE0] text-white font-semibold text-sm shadow-brand transition-all flex items-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[19px]">add</span>
          <span>New booking</span>
        </button>
      </div>

      {/* 3 KPI Stat Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Priority Score */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card hover:shadow-card-hover transition-shadow flex flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F0EEFF] text-[#5B4CF5] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">balance</span>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
              Priority Score
            </span>
          </div>

          <div className="my-5 flex items-baseline gap-2">
            {loading ? (
              <div className="h-9 w-24 rounded-lg bg-[#F2F4F7] animate-pulse" />
            ) : (
              <>
                <span className="text-3xl font-display font-bold tabular-nums text-[#101828]">{score}</span>
                <span className="text-sm font-medium text-[#667085]">/ 100 pts</span>
              </>
            )}
          </div>

          <div className="pt-3 border-t border-[#F2F4F7] flex items-center justify-between text-xs">
            <span className="text-[#667085]">{fairness?.totalHoursUsed ?? 0}h total · {fairness?.highDemandHours ?? 0}h peak</span>
            <button
              type="button"
              onClick={() => onNavigate('student-booking-passes')}
              className="text-[#5B4CF5] font-semibold hover:text-[#4318D8] flex items-center gap-0.5"
            >
              <span>View</span>
              <span className="material-symbols-outlined text-[15px]">chevron_right</span>
            </button>
          </div>
        </div>

        {/* Card 2: Open Workstations */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card hover:shadow-card-hover transition-shadow flex flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ECFDF3] text-[#15803D] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">event_seat</span>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
              Open Workstations
            </span>
          </div>

          <div className="my-5 flex items-baseline gap-2">
            {loading ? (
              <div className="h-9 w-24 rounded-lg bg-[#F2F4F7] animate-pulse" />
            ) : (
              <>
                <span className="text-3xl font-display font-bold tabular-nums text-[#101828]">{freeNow}</span>
                <span className="text-sm font-medium text-[#667085]">of {summary?.totalWorkstations ?? 84}</span>
              </>
            )}
          </div>

          <div className="pt-3 border-t border-[#F2F4F7] flex items-center justify-between text-xs">
            <span className="text-[#667085]">Block A (60) · Block B (24)</span>
            <button
              type="button"
              onClick={() => onNavigate('lab-seat-map')}
              className="text-[#5B4CF5] font-semibold hover:text-[#4318D8] flex items-center gap-0.5"
            >
              <span>Seat map</span>
              <span className="material-symbols-outlined text-[15px]">chevron_right</span>
            </button>
          </div>
        </div>

        {/* Card 3: Daily Quota */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card hover:shadow-card-hover transition-shadow flex flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FEF3C7] text-[#B45309] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">schedule</span>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
              Daily Quota Used
            </span>
          </div>

          <div className="my-5 flex items-baseline justify-between gap-2">
            {loading ? (
              <div className="h-9 w-24 rounded-lg bg-[#F2F4F7] animate-pulse" />
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-display font-bold tabular-nums text-[#101828]">
                    {dailyQuota?.usedHours ?? 0}h
                  </span>
                  <span className="text-sm font-medium text-[#667085]">/ {dailyQuota?.maxDailyHours ?? 2}h</span>
                </div>
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#15803D]">
                  {dailyQuota?.remainingHours ?? 2}h left
                </span>
              </>
            )}
          </div>

          <div className="pt-3 border-t border-[#F2F4F7] flex items-center justify-between text-xs">
            <span className="text-[#667085]">Hours {availability?.schedule?.openTime || '09:00'}–{availability?.schedule?.closeTime || '18:00'}</span>
            <button
              type="button"
              onClick={() => onNavigate('lab-allocation-realtime-queue')}
              className="text-[#5B4CF5] font-semibold hover:text-[#4318D8] flex items-center gap-0.5"
            >
              <span>Queue</span>
              <span className="material-symbols-outlined text-[15px]">chevron_right</span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Split: Today's Schedule Timeline (8 cols) + Cohort Balance & Quick Status (4 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Today's Schedule Timeline Card (matching EazyBook timeline with red NOW bar) */}
        <div className="xl:col-span-8 p-6 rounded-2xl bg-white border border-[#EAECF0] shadow-card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display text-base font-bold text-[#101828]">Today&apos;s schedule</h2>
              <p className="text-xs text-[#667085] mt-0.5">
                {todayLabel} · {activeBookings.length} confirmed, {pendingReqs.length} pending
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('lab-seat-map')}
              className="text-xs font-semibold text-[#5B4CF5] hover:text-[#4318D8] flex items-center gap-0.5"
            >
              <span>Open seat map</span>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>

          {/* Red Live NOW Line */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-16 text-right shrink-0">
              <span className="text-[10px] font-mono font-bold uppercase text-[#DC2626] block leading-tight">NOW</span>
              <span className="text-xs font-mono font-semibold text-[#DC2626] tabular-nums">{nowStr}</span>
            </div>
            <div className="flex items-center flex-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] shrink-0" />
              <div className="h-[2px] flex-1 bg-[#DC2626]/70" />
            </div>
          </div>

          {/* Bookings & Queued Timeline Rows */}
          {activeBookings.length === 0 && pendingReqs.length === 0 ? (
            <div className="py-10 px-6 rounded-2xl bg-[#F8FAFC] border border-dashed border-[#D0D5DD] text-center">
              <span className="material-symbols-outlined text-[30px] text-[#98A2B3] mb-2">calendar_clock</span>
              <p className="text-sm font-semibold text-[#1D2939]">No reservations scheduled for you today</p>
              <p className="text-xs text-[#667085] mt-1 mb-4">
                Browse the 84-seat Lab L-106 map to reserve a workstation for any custom time window.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('lab-seat-map')}
                className="h-9 px-4 rounded-xl bg-[#5B4CF5] hover:bg-[#4B3CE0] text-white text-xs font-semibold"
              >
                Explore Seat Map
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {activeBookings.map(b => (
                <div key={b.booking_id} className="flex items-center gap-3">
                  <span className="w-16 text-right text-xs font-mono text-[#667085] tabular-nums shrink-0">
                    {b.start_time}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('student-booking-passes')}
                    className="flex-1 px-4 py-3 rounded-xl bg-[#F0EEFF] hover:bg-[#EAE6FF] border-l-4 border-[#5B4CF5] flex flex-wrap items-center justify-between gap-2 text-left transition-colors"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#312E81]">
                        {b.display_label || b.machine_id} · {b.compute_purpose || 'Lab Session'}
                      </div>
                      <div className="text-[11px] font-mono text-[#5B4CF5] mt-0.5 tabular-nums">
                        {b.booking_date} · {b.start_time} – {b.end_time} · {b.demand_level || 'NORMAL'}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-white text-[#5B4CF5] text-[11px] font-semibold border border-[#E4DDFF]">
                      QR Pass Ready
                    </span>
                  </button>
                </div>
              ))}

              {pendingReqs.map(req => (
                <div key={req.request_id} className="flex items-center gap-3">
                  <span className="w-16 text-right text-xs font-mono text-[#667085] tabular-nums shrink-0">
                    {req.start_time}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('lab-allocation-realtime-queue')}
                    className="flex-1 px-4 py-3 rounded-xl bg-[#FEF3C7]/70 hover:bg-[#FEF3C7] border-l-4 border-[#D97706] flex flex-wrap items-center justify-between gap-2 text-left transition-colors"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#78350F]">
                        Queued Request · {req.preferred_label || 'Any Available Seat'}
                      </div>
                      <div className="text-[11px] font-mono text-[#B45309] mt-0.5 tabular-nums">
                        {req.booking_date} · {req.start_time} – {req.end_time} · Score {req.priority_score_snapshot} pts
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-white text-[#B45309] text-[11px] font-semibold border border-[#FDE68A]">
                      In Fairness Queue
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Stack: Lab Block Summary + Cohort Fairness Distribution */}
        <div className="xl:col-span-4 flex flex-col gap-5">
          {/* Block Availability Card */}
          <div className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-sm font-bold text-[#101828]">Lab L-106 Blocks</h3>
                <p className="text-xs text-[#667085] mt-0.5">Live inventory status</p>
              </div>
              <span className="text-xs font-mono font-semibold text-[#5B4CF5] bg-[#F4F2FF] px-2.5 py-1 rounded-full">
                84 total
              </span>
            </div>

            <div className="space-y-3">
              {(availability?.blocks || []).map(blk => {
                const pct = Math.round((blk.availableInSlot / Math.max(1, blk.total)) * 100);
                return (
                  <div key={blk.code} className="p-3 rounded-xl bg-[#F8FAFC] border border-[#EAECF0]">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-semibold text-[#1D2939]">{blk.name} ({blk.dimensions})</span>
                      <span className="font-mono font-semibold text-[#15803D] tabular-nums">
                        {blk.availableInSlot}/{blk.total} free
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
                      <div className="h-full bg-[#22C55E] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cohort Fairness Distribution (EazyBook-style segmented bar card) */}
          <div className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card">
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <h3 className="font-display text-sm font-bold text-[#101828]">Cohort fairness index</h3>
                <p className="text-xs text-[#667085]">Jain&apos;s allocation equity</p>
              </div>
              <span className="font-display text-2xl font-bold text-[#101828] tabular-nums">
                {leaderboard?.metrics ? `${Math.round(leaderboard.metrics.jainsFairnessIndex * 100)}%` : '99%'}
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full overflow-hidden flex my-4 bg-[#F2F4F7]">
              <div className="bg-[#5B4CF5] h-full" style={{ width: `${pctHigh}%` }} />
              <div className="bg-[#10B981] h-full" style={{ width: `${pctMid}%` }} />
              <div className="bg-[#F59E0B] h-full" style={{ width: `${pctLow}%` }} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#475467] tabular-nums">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#5B4CF5]" />
                90–100 pts ({pctHigh}%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                70–89 ({pctMid}%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                &lt;70 ({pctLow}%)
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

