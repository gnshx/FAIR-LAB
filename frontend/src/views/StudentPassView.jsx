import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function SemiCircleGauge({ score = 100, maxScore = 100, floor = 10 }) {
  const clamped = Math.max(0, Math.min(maxScore, Number(score) || 0));
  const pct = maxScore > 0 ? clamped / maxScore : 0;

  // Semi-circle from (-90, 0) to (90, 0) centered at (110, 110), r = 82
  const r = 82;
  const cx = 110;
  const cy = 108;
  const circumference = Math.PI * r;
  const dashOffset = circumference * (1 - pct);

  // Knob coordinates along top arc: angle goes from Math.PI (left) to 0 (right)
  const theta = Math.PI * (1 - pct);
  const knobX = cx + r * Math.cos(theta);
  const knobY = cy - r * Math.sin(theta);

  return (
    <div className="relative flex flex-col items-center justify-center pt-1">
      <svg viewBox="0 0 220 132" className="w-full max-w-[230px] overflow-visible">
        <defs>
          <linearGradient id="fairnessArcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#D4C5FF" />
            <stop offset="55%" stopColor="#9E82FF" />
            <stop offset="100%" stopColor="#4F22F2" />
          </linearGradient>
        </defs>
        {/* Background track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#EFEBFD"
          strokeWidth="15"
          strokeLinecap="round"
        />
        {/* Active gradient progress arc */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="url(#fairnessArcGrad)"
          strokeWidth="15"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 450ms ease' }}
        />
        {/* Indicator knob */}
        <circle
          cx={knobX}
          cy={knobY}
          r="9"
          fill="#FFFFFF"
          stroke="#4F22F2"
          strokeWidth="3.5"
        />
        {/* Scale ticks */}
        <text x={cx - r - 4} y={cy + 20} fontSize="10" fill="#98A2B3" textAnchor="middle" className="font-mono">
          {floor}
        </text>
        <text x={cx + r + 2} y={cy + 20} fontSize="10" fill="#98A2B3" textAnchor="middle" className="font-mono">
          {maxScore}
        </text>
      </svg>

      <div className="-mt-14 text-center">
        <div className="text-3xl font-bold font-display text-[#4F22F2] tabular-nums leading-none">
          {clamped}
          <span className="text-sm font-mono font-semibold text-[#667085] ml-1">pts</span>
        </div>
        <div className="text-[11px] font-medium text-[#667085] mt-1">
          Priority Index ({Math.round(pct * 100)}%)
        </div>
      </div>
    </div>
  );
}

function MiniBarSparkline({ values = [28, 42, 34, 62, 48, 76, 54], accentLast = true }) {
  const maxVal = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-1.5 h-12" aria-hidden="true">
      {values.map((v, idx) => {
        const hPct = Math.max(18, Math.round((v / maxVal) * 100));
        const isPeak = accentLast && idx === values.length - 1;
        return (
          <div
            key={idx}
            className={`w-2 rounded-full transition-all duration-300 ${
              isPeak ? 'bg-[#4F22F2]' : 'bg-[#C4B5FD]'
            }`}
            style={{ height: `${hPct}%` }}
          />
        );
      })}
    </div>
  );
}

function UsageDonutRing({ baseScore = 100, normalDeduction = 0, peakDeduction = 0, penalties = 0, currentScore = 100 }) {
  const rOuter = 54;
  const rInner = 37;
  const cOuter = 2 * Math.PI * rOuter;
  const cInner = 2 * Math.PI * rInner;

  const remainingRatio = Math.max(0, Math.min(1, currentScore / Math.max(1, baseScore)));
  const totalDeducted = Math.max(0, normalDeduction + peakDeduction + penalties);
  const peakShare = totalDeducted > 0 ? Math.min(1, (peakDeduction + penalties) / Math.max(1, baseScore)) : 0.08;

  return (
    <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
        {/* Outer track (retained fairness score) */}
        <circle cx="70" cy="70" r={rOuter} fill="none" stroke="#EFEBFD" strokeWidth="11" />
        <circle
          cx="70"
          cy="70"
          r={rOuter}
          fill="none"
          stroke="#4F22F2"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={cOuter}
          strokeDashoffset={cOuter * (1 - remainingRatio)}
        />
        {/* Inner blush ring (peak/penalty load, matching design/fairnessscore page -uiux.png) */}
        <circle cx="70" cy="70" r={rInner} fill="none" stroke="#FDE8E8" strokeWidth="9" />
        <circle
          cx="70"
          cy="70"
          r={rInner}
          fill="none"
          stroke="#F5A8A8"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={cInner}
          strokeDashoffset={cInner * (1 - peakShare)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-bold font-display text-[#1D2939] tabular-nums leading-none">
          {currentScore}
        </span>
        <span className="text-[10px] font-mono uppercase text-[#667085] mt-1">
          of {baseScore} pts
        </span>
      </div>
    </div>
  );
}

export default function StudentPassView({ onNavigateToMap, onNavigateToQueue }) {
  const { profile, currentUser, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [fairnessData, setFairnessData] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activePass, setActivePass] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const [resFair, resMy] = await Promise.all([
        fetch('/api/fairness/me', { headers: { 'x-user-id': currentUser } }),
        fetch('/api/bookings/my-bookings', { headers: { 'x-user-id': currentUser } })
      ]);

      if (resFair.ok) setFairnessData(await resFair.json());

      if (resMy.ok) {
        const myData = await resMy.json();
        setBookings(myData.bookings || []);
        setPendingRequests(myData.pendingRequests || []);

        const confirmed = (myData.bookings || []).find(
          b => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN'
        );
        if (confirmed) {
          const passRes = await fetch(`/api/bookings/${confirmed.booking_id}/pass`);
          if (passRes.ok) {
            setActivePass(await passRes.json());
          } else {
            setActivePass(null);
          }
        } else {
          setActivePass(null);
        }
      }
    } catch (e) {
      setError('Unable to load your fairness score and digital access passes.');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const refresh = () => {
      fetchData();
      refreshProfile();
    };
    const unsubs = [
      subscribe('SLOT_UPDATED', refresh),
      subscribe('SCORE_CHANGED', refresh),
      subscribe('fairness.score_updated', refresh),
      subscribe('booking.confirmed', refresh),
      subscribe('booking.cancelled', refresh)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchData, refreshProfile]);

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Cancel this booking? Voluntary cancellation carries zero point penalty.')) return;
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({ reason: 'Student cancelled from passes view' })
      });
      if (res.ok) {
        setActionMsg({ type: 'success', text: 'Booking cancelled with 0 penalty points. Seat returned to L-106 pool.' });
        setActivePass(null);
        await fetchData();
        await refreshProfile();
      } else {
        const d = await res.json();
        setActionMsg({ type: 'error', text: d.error || 'Could not cancel booking.' });
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message });
    }
  };

  const handleWithdrawRequest = async (requestId) => {
    try {
      const res = await fetch(`/api/booking-requests/${requestId}`, {
        method: 'DELETE',
        headers: { 'x-user-id': currentUser }
      });
      if (res.ok) {
        setActionMsg({ type: 'success', text: 'Request withdrawn from fairness queue with 0 penalty points.' });
        await fetchData();
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message });
    }
  };

  const user = profile?.user;
  const policy = fairnessData?.policy;
  const baseScore = policy?.base_score ?? 100;
  const minFloor = policy?.min_priority_floor ?? 10;
  const normalRate = policy?.deduction_per_hour ?? 5;
  const peakRate = policy?.high_demand_deduction_per_hour ?? 10;

  const score = fairnessData?.currentScore ?? profile?.fairness?.current_score ?? baseScore;
  const totalHours = Number(fairnessData?.totalHoursUsed ?? 0);
  const highDemandHours = Number(fairnessData?.highDemandHours ?? 0);
  const completedCount = fairnessData?.completedBookings ?? 0;
  const penalties = fairnessData?.penaltyPoints ?? 0;
  const dailyQuota = fairnessData?.dailyQuota;
  const history = fairnessData?.history || [];

  const normalDeduction = Math.round(totalHours * normalRate * 10) / 10;
  const peakDeduction = Math.round(highDemandHours * peakRate * 10) / 10;

  // Build subtle deterministic sparklines from history (or clean baseline bars)
  const durationSeries = history.length >= 3
    ? history.slice(0, 7).reverse().map(h => Math.max(1, Number(h.duration_hours || 1) * 20))
    : [22, 34, 28, 46, 38, 52, Math.max(24, totalHours * 18)];

  const peakSeries = history.length >= 3
    ? history.slice(0, 7).reverse().map(h => (h.demand_level === 'HIGH_DEMAND' ? 80 : 25))
    : [18, 22, 18, 30, 22, 26, Math.max(20, highDemandHours * 35)];

  return (
    <div className="flex flex-col w-full gap-6 text-[#1D2939]">
      {/* Page Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-display font-bold tracking-tight text-[#1D2939]">
              Fairness Score &amp; Access Pass
            </h1>
            <span className="text-xs font-mono font-medium px-2.5 py-0.5 rounded-full bg-[#F0EEFF] text-[#4F22F2] border border-[#E4DDFF]">
              {fairnessData?.semester?.name || 'Active Semester'}
            </span>
          </div>
          <p className="text-sm text-[#667085] mt-1">
            {user?.name || 'Ganesh Kumar'} · <span className="font-mono text-xs">{user?.roll_no || 'BT23CSE001'}</span> · {user?.department || 'Computer Science & Engineering'}
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateToMap}
          className="h-10 px-4 rounded-xl bg-[#5B4CF5] hover:bg-[#4F22F2] text-white text-xs font-semibold shadow-brand transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[17px]">add</span>
          <span>Reserve Workstation</span>
        </button>
      </section>

      {actionMsg && (
        <div
          className={`px-4 py-3 rounded-xl border flex items-center justify-between text-xs font-medium ${
            actionMsg.type === 'success'
              ? 'bg-[#ECFDF3] border-[#A6F4C5] text-[#15803D]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {actionMsg.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{actionMsg.text}</span>
          </div>
          <button type="button" onClick={() => setActionMsg(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-between text-xs text-[#B91C1C]">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchData}
            className="px-3 py-1 rounded-lg bg-white border border-[#FECACA] text-[#B91C1C] font-semibold hover:bg-[#FFF5F5]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Row: 3 KPI Analytics Cards (inspired by design/fairnessscore page -uiux.png) */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-44 rounded-2xl bg-white border border-[#EAECF0] p-6 animate-pulse" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Card 1: Semi-Circular Fairness Arc Gauge */}
          <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-card p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#475467]">Fairness Priority Score</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#15803D] border border-[#A6F4C5]">
                Floor {minFloor}
              </span>
            </div>
            <SemiCircleGauge score={score} maxScore={baseScore} floor={minFloor} />
            <div className="pt-2 border-t border-[#F2F4F7] flex items-center justify-between text-[11px] font-mono text-[#667085] tabular-nums">
              <span>Daily quota: {dailyQuota?.usedHours ?? 0}h / {dailyQuota?.maxDailyHours ?? 2}h</span>
              <span className="text-[#4F22F2] font-semibold">{activePass ? '1 Active Pass' : 'Ready to Book'}</span>
            </div>
          </div>

          {/* Card 2: Total Usage Hours + Sparkline */}
          <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-card p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#475467]">Cumulative Lab Hours (T<sub>u</sub>)</span>
              <div className="w-8 h-8 rounded-xl bg-[#F0EEFF] text-[#5B4CF5] flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">schedule</span>
              </div>
            </div>

            <div className="my-4 flex items-end justify-between gap-4">
              <div>
                <div className="text-4xl font-bold font-display text-[#4F22F2] tabular-nums leading-none">
                  {totalHours}
                  <span className="text-lg font-medium text-[#98A2B3] ml-1">hrs</span>
                </div>
                <p className="text-xs text-[#667085] mt-2">
                  Across <strong className="text-[#1D2939]">{completedCount}</strong> verified session(s)
                </p>
              </div>
              <MiniBarSparkline values={durationSeries} />
            </div>

            <div className="pt-2.5 border-t border-[#F2F4F7] flex items-center justify-between text-[11px] text-[#667085]">
              <span>Base rate deduction</span>
              <span className="font-mono font-semibold text-[#1D2939] tabular-nums">−{normalRate} pts / hr</span>
            </div>
          </div>

          {/* Card 3: High-Demand Peak Hours + Sparkline */}
          <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-card p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#475467]">High-Demand Peak Hours (T<sub>H</sub>)</span>
              <div className="w-8 h-8 rounded-xl bg-[#FFFBEB] text-[#B45309] flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">bolt</span>
              </div>
            </div>

            <div className="my-4 flex items-end justify-between gap-4">
              <div>
                <div className="text-4xl font-bold font-display text-[#4F22F2] tabular-nums leading-none">
                  {highDemandHours}
                  <span className="text-lg font-medium text-[#98A2B3] ml-1">hrs</span>
                </div>
                <p className="text-xs text-[#667085] mt-2">
                  No-show penalties: <strong className="text-[#1D2939] font-mono">{penalties} pts</strong>
                </p>
              </div>
              <MiniBarSparkline values={peakSeries} />
            </div>

            <div className="pt-2.5 border-t border-[#F2F4F7] flex items-center justify-between text-[11px] text-[#667085]">
              <span>Voluntary cancellation</span>
              <span className="font-mono font-semibold text-[#15803D]">0 penalty pts</span>
            </div>
          </div>
        </section>
      )}

      {/* Middle Row: Donut Score Breakdown (7 cols) + Active Digital Access Pass (5 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Donut & Formula Breakdown */}
        <div className="xl:col-span-7 bg-white rounded-2xl border border-[#EAECF0] shadow-card p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#EAECF0]">
              <div>
                <h2 className="text-sm font-bold text-[#1D2939]">Priority Score Breakdown</h2>
                <p className="text-xs text-[#667085] mt-0.5">
                  Points are deducted strictly upon verified check-out or confirmed no-show.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-[#F7F8FC] border border-[#EAECF0] text-[#344054]">
                P<sub>u</sub> = max({minFloor}, {baseScore} − {normalRate}T<sub>u</sub> − {peakRate}T<sub>H</sub>)
              </span>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row items-center gap-6">
              <UsageDonutRing
                baseScore={baseScore}
                normalDeduction={normalDeduction}
                peakDeduction={peakDeduction}
                penalties={penalties}
                currentScore={score}
              />

              <div className="flex-1 w-full divide-y divide-[#F2F4F7] text-xs">
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#4F22F2]" />
                    <span className="text-[#475467]">Semester Base Allocation</span>
                  </div>
                  <span className="font-mono font-semibold text-[#1D2939] tabular-nums">+{baseScore} pts</span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#C4B5FD]" />
                    <span className="text-[#475467]">Normal Usage Deduction ({totalHours}h × {normalRate})</span>
                  </div>
                  <span className="font-mono font-semibold text-[#344054] tabular-nums">−{normalDeduction} pts</span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#F5A8A8]" />
                    <span className="text-[#475467]">High-Demand Surcharge ({highDemandHours}h × {peakRate})</span>
                  </div>
                  <span className="font-mono font-semibold text-[#B45309] tabular-nums">−{peakDeduction} pts</span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                    <span className="text-[#475467]">No-Show Penalties</span>
                  </div>
                  <span className="font-mono font-semibold text-[#DC2626] tabular-nums">−{penalties} pts</span>
                </div>
                <div className="pt-3 flex items-center justify-between">
                  <span className="font-semibold text-[#1D2939]">Current Active Score</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#F0EEFF] text-[#4F22F2] font-mono font-bold tabular-nums">
                    {score} pts
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#F2F4F7] flex flex-wrap items-center justify-between gap-2 text-xs text-[#667085]">
            <span>
              Ties at the same score resolve by cumulative eligible wait cycles (W<sub>u</sub>), then earliest timestamp.
            </span>
            <button
              type="button"
              onClick={onNavigateToQueue}
              className="text-[#5B4CF5] hover:text-[#4F22F2] font-semibold inline-flex items-center gap-1"
            >
              <span>Inspect Live Queue</span>
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Active Digital Access Pass Card */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden flex flex-col">
          {activePass ? (
            <div id="printable-pass-card" className="flex flex-col h-full">
              <div className="bg-[#13295B] px-5 py-3.5 flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#A5B4FC]">badge</span>
                  <span className="text-xs font-mono font-semibold uppercase tracking-wider">
                    L-106 Digital Access Pass
                  </span>
                </div>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-white/15 text-white border border-white/20">
                  {activePass.status || 'CONFIRMED'}
                </span>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between bg-white">
                <div className="grid grid-cols-2 gap-3 pb-4 border-b border-[#EAECF0] text-xs">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-[#667085] block">Student</span>
                    <strong className="text-sm font-bold text-[#1D2939] block truncate mt-0.5">
                      {activePass.student_name}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-[#667085] block">Roll Number</span>
                    <strong className="text-sm font-mono font-bold text-[#1D2939] block mt-0.5">
                      {activePass.roll_no}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-[#667085] block">Assigned Seat</span>
                    <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md bg-[#ECFDF3] text-[#15803D] border border-[#86EFAC] font-mono font-bold text-xs">
                      {activePass.machine_id}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-[#667085] block">Time Window</span>
                    <strong className="text-xs font-mono font-semibold text-[#1D2939] tabular-nums block mt-1">
                      {activePass.start_time} – {activePass.end_time}
                    </strong>
                  </div>
                </div>

                <div className="my-4 flex flex-col items-center">
                  <div className="p-3 bg-white rounded-2xl border-2 border-[#1D2939] shadow-sm">
                    {activePass.qrDataUrl ? (
                      <img src={activePass.qrDataUrl} alt="Signed Access Pass QR" className="w-32 h-32 object-contain" />
                    ) : (
                      <div className="w-32 h-32 bg-[#F7F8FC] flex items-center justify-center text-[#98A2B3] text-xs font-mono">
                        Generating...
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-xs font-bold text-[#1D2939] mt-2.5">{activePass.booking_id}</span>
                  <span className="text-[11px] text-[#667085] mt-0.5">HMAC-SHA256 Signed · Single Entry</span>
                </div>

                <div className="pt-3.5 border-t border-[#EAECF0] flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="h-9 px-3.5 rounded-xl bg-[#13295B] hover:bg-[#1D3B7D] text-white font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">print</span>
                    <span>Print Pass</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelBooking(activePass.booking_id)}
                    className="h-9 px-3.5 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA] font-semibold transition-colors"
                  >
                    Cancel Booking
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] border border-[#E4DDFF] flex items-center justify-center text-[#5B4CF5] mb-3.5">
                <span className="material-symbols-outlined text-[24px]">qr_code_2</span>
              </div>
              <h3 className="text-sm font-bold text-[#1D2939]">No Active Access Pass</h3>
              <p className="text-xs text-[#667085] max-w-xs mt-1 mb-5 leading-relaxed">
                Select a date, custom interval, and preferred workstation on the Lab L-106 map to receive a signed QR gate pass.
              </p>
              <button
                type="button"
                onClick={onNavigateToMap}
                className="h-9 px-4 rounded-xl bg-[#5B4CF5] hover:bg-[#4F22F2] text-white font-semibold text-xs shadow-brand flex items-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">event_seat</span>
                <span>Open Lab Seat Map</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Bottom Row: Pending Waitlist (5 cols) + Allocation History Table (7 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Pending Waitlist / Queued Requests */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-[#EAECF0] shadow-card p-5">
          <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[#EAECF0]">
            <div>
              <h2 className="text-sm font-bold text-[#1D2939]">Queued Requests &amp; Waitlist</h2>
              <p className="text-xs text-[#667085] mt-0.5">Awaiting batch allocation round</p>
            </div>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] tabular-nums">
              {pendingRequests.length} pending
            </span>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="py-8 text-center">
              <span className="material-symbols-outlined text-[28px] text-[#D0D5DD] mb-1.5">hourglass_empty</span>
              <p className="text-xs text-[#667085]">No pending queued requests right now.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingRequests.map(req => (
                <div
                  key={req.request_id}
                  className="p-3.5 rounded-xl bg-[#F7F8FC] border border-[#EAECF0] flex items-center justify-between gap-3"
                >
                  <div className="text-xs">
                    <div className="font-mono font-semibold text-[#1D2939] tabular-nums">
                      {req.booking_date} · {req.start_time}–{req.end_time}
                    </div>
                    <div className="text-[#667085] mt-0.5">
                      {req.preferred_label ? `Preferred: ${req.preferred_label}` : 'Any available seat'} · Snapshot:{' '}
                      <strong className="text-[#4F22F2] font-mono">{req.priority_score_snapshot} pts</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleWithdrawRequest(req.request_id)}
                    className="h-8 px-3 rounded-lg bg-white hover:bg-[#FEF2F2] border border-[#D0D5DD] hover:border-[#FECACA] text-xs font-medium text-[#344054] hover:text-[#DC2626] transition-colors shrink-0"
                  >
                    Withdraw
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fairness Score & Allocation History Table */}
        <div className="xl:col-span-7 bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-[#EAECF0]">
            <div>
              <h2 className="text-sm font-bold text-[#1D2939]">Fairness Score &amp; Allocation History</h2>
              <p className="text-xs text-[#667085] mt-0.5">
                Immutable ledger of completed sessions, demand tiers, and score adjustments
              </p>
            </div>
            <span className="text-xs font-mono text-[#667085] tabular-nums">{history.length} events</span>
          </div>

          {history.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#667085]">
              No completed sessions recorded yet this semester.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#EAECF0] text-[#667085] font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Workstation</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Demand Tier</th>
                    <th className="py-3 px-4 text-right">Score Adjustment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAECF0] font-mono tabular-nums">
                  {history.map(h => (
                    <tr key={h.allocation_id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#1D2939]">{h.machine_id || 'L-106'}</td>
                      <td className="py-3 px-4 text-[#475467]">{h.duration_hours ?? 1}h</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            h.demand_level === 'HIGH_DEMAND'
                              ? 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]'
                              : 'bg-[#ECFDF3] text-[#15803D] border-[#A6F4C5]'
                          }`}
                        >
                          {h.demand_level || 'NORMAL'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="text-[#98A2B3]">{h.score_before} → </span>
                        <strong className="text-[#4F22F2]">{h.score_after} pts</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
