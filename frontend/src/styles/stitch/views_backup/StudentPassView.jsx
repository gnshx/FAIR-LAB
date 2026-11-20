import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

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
      setError('Unable to load your passes and fairness history.');
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
        setActionMsg({ type: 'success', text: 'Booking cancelled with 0 penalty points. Seat returned to pool.' });
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
        setActionMsg({ type: 'success', text: 'Request withdrawn from queue with 0 penalty points.' });
        await fetchData();
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message });
    }
  };

  const user = profile?.user;
  const score = fairnessData?.currentScore ?? profile?.fairness?.current_score ?? 100;
  const totalHours = fairnessData?.totalHoursUsed ?? 0;
  const highDemandHours = fairnessData?.highDemandHours ?? 0;
  const completedCount = fairnessData?.completedBookings ?? 0;
  const penalties = fairnessData?.penaltyPoints ?? 0;
  const dailyQuota = fairnessData?.dailyQuota;
  const policy = fairnessData?.policy;

  return (
    <div className="flex flex-col w-full gap-6 text-zinc-100">
      {actionMsg && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
            actionMsg.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-200'
          }`}
        >
          <span>{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="text-zinc-400 hover:text-zinc-200">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-center justify-between text-xs text-rose-300">
          <span>{error}</span>
          <button onClick={fetchData} className="px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200">
            Retry
          </button>
        </div>
      )}

      {/* Top Row: Fairness Account (7 cols) + Active QR Pass (5 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Student Fairness Account */}
        <div className="xl:col-span-7 p-6 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-zinc-800">
              <div>
                <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
                  {user?.name || 'NDS Ganesh'}
                </h1>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  {user?.roll_no || 'BT23CSE001'} · {user?.department || 'Computer Science & Engineering'}
                </p>
              </div>
              <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-zinc-950 text-zinc-300 border border-zinc-800">
                {fairnessData?.semester?.name || 'Active Semester'}
              </span>
            </div>

            {loading ? (
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div className="h-36 rounded-xl bg-zinc-800/50 animate-pulse" />
                <div className="h-36 rounded-xl bg-zinc-800/50 animate-pulse" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                {/* Score Card */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                      Fairness Priority Score
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Floor {policy?.min_priority_floor ?? 10}
                    </span>
                  </div>

                  <div className="my-3 flex items-baseline gap-2">
                    <span className="text-4xl font-bold font-mono tabular-nums text-zinc-100">{score}</span>
                    <span className="text-sm font-mono text-zinc-500">/ {policy?.base_score ?? 100} pts</span>
                  </div>

                  <div>
                    <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-2 text-[11px] font-mono text-zinc-400 tabular-nums">
                      <span>Today: {dailyQuota?.usedHours ?? 0}h / {dailyQuota?.maxDailyHours ?? 2}h</span>
                      <span>No-show penalty: {penalties} pts</span>
                    </div>
                  </div>
                </div>

                {/* Hours & High-Demand Breakdown */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                      Duration & Peak Formula
                    </span>
                    <span className="material-symbols-outlined text-[16px] text-zinc-500">functions</span>
                  </div>

                  <div className="my-2.5 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-200 text-center">
                    P<sub>u</sub> = max({policy?.min_priority_floor ?? 10}, {policy?.base_score ?? 100} − {policy?.deduction_per_hour ?? 5}T<sub>u</sub> − {policy?.high_demand_deduction_per_hour ?? 10}T<sub>H</sub>)
                  </div>

                  <div className="space-y-1 text-xs font-mono text-zinc-400 tabular-nums">
                    <div className="flex justify-between">
                      <span>Total Hours Used (T<sub>u</sub>):</span>
                      <span className="text-zinc-200 font-semibold">{totalHours}h ({completedCount} sessions)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>High-Demand Hours (T<sub>H</sub>):</span>
                      <span className="text-amber-300 font-semibold">{highDemandHours}h</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Voluntary Cancellation:</span>
                      <span className="text-emerald-400">0 penalty pts</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-zinc-400">
              Points are deducted only after verified session check-out or confirmed no-show.
            </span>
            <button
              type="button"
              onClick={onNavigateToMap}
              className="h-9 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">grid_view</span>
              <span>Open Lab Seat Map</span>
            </button>
          </div>
        </div>

        {/* Active Digital Access Pass */}
        <div className="xl:col-span-5 rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden flex flex-col">
          {activePass ? (
            <div id="printable-pass-card" className="flex flex-col h-full">
              <div className="bg-zinc-950 px-5 py-3 flex items-center justify-between border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-400 text-[18px]">badge</span>
                  <span className="text-xs font-mono font-semibold text-zinc-200 uppercase tracking-wider">
                    L-106 Digital Access Pass
                  </span>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  {activePass.status || 'CONFIRMED'}
                </span>
              </div>

              <div className="p-5 bg-white text-zinc-800 flex-1 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-3 pb-4 border-b border-zinc-200 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Student</span>
                    <strong className="text-sm font-sans font-bold text-zinc-900 block truncate">
                      {activePass.student_name}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Roll Number</span>
                    <strong className="text-sm font-bold text-zinc-900">{activePass.roll_no}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Assigned Seat</span>
                    <strong className="text-xs font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 inline-block">
                      {activePass.machine_id}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Time Window</span>
                    <strong className="text-xs font-semibold text-zinc-900 tabular-nums">
                      {activePass.start_time} – {activePass.end_time}
                    </strong>
                  </div>
                </div>

                <div className="my-4 flex flex-col items-center">
                  <div className="p-2.5 bg-white rounded-xl border-2 border-zinc-900">
                    {activePass.qrDataUrl ? (
                      <img src={activePass.qrDataUrl} alt="Signed Access Pass QR" className="w-32 h-32 object-contain" />
                    ) : (
                      <div className="w-32 h-32 bg-zinc-100 flex items-center justify-center text-zinc-400 text-xs font-mono">
                        Generating...
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-xs font-bold text-zinc-800 mt-2.5">{activePass.booking_id}</span>
                  <span className="text-[11px] text-zinc-500 mt-0.5">HMAC-SHA256 Signed · Single Entry</span>
                </div>

                <div className="pt-3 border-t border-zinc-200 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="h-8 px-3 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 font-medium flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[15px]">print</span>
                    <span>Print Pass</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelBooking(activePass.booking_id)}
                    className="h-8 px-3 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 font-medium"
                  >
                    Cancel Booking
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-400 mb-3">
                <span className="material-symbols-outlined text-[24px]">qr_code_2</span>
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">No Active Access Pass</h3>
              <p className="text-xs text-zinc-400 max-w-xs mt-1 mb-5">
                Pick a date, interval, and preferred seat on the Lab L-106 map to receive a signed QR pass.
              </p>
              <button
                type="button"
                onClick={onNavigateToMap}
                className="h-9 px-4 rounded-lg bg-emerald-500 text-zinc-950 font-semibold hover:bg-emerald-400 text-xs flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">event_seat</span>
                <span>Select Workstation</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Pending Requests & Bookings History */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Pending Waitlist / Queued Requests */}
        <div className="xl:col-span-5 p-5 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Queued Requests & Waitlist</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Awaiting batch allocation round</p>
            </div>
            <button
              type="button"
              onClick={onNavigateToQueue}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
            >
              Inspect Queue
            </button>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No pending queued requests.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingRequests.map(req => (
                <div key={req.request_id} className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
                  <div className="text-xs">
                    <div className="font-mono font-semibold text-zinc-200 tabular-nums">
                      {req.booking_date} · {req.start_time}–{req.end_time}
                    </div>
                    <div className="text-zinc-400 mt-0.5">
                      {req.preferred_label ? `Preferred: ${req.preferred_label}` : 'Any available seat'} · Score snapshot: {req.priority_score_snapshot} pts
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleWithdrawRequest(req.request_id)}
                    className="h-8 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300"
                  >
                    Withdraw
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Allocation & Score History */}
        <div className="xl:col-span-7 p-5 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Fairness Score & Allocation History</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Immutable record of completed hours, demand tier, and point adjustments</p>
            </div>
            <span className="text-xs font-mono text-zinc-400">{(fairnessData?.history || []).length} events</span>
          </div>

          {(fairnessData?.history || []).length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No completed sessions recorded yet this semester.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 font-mono uppercase text-[11px]">
                    <th className="py-2 px-2">Seat</th>
                    <th className="py-2 px-2">Duration</th>
                    <th className="py-2 px-2">Demand</th>
                    <th className="py-2 px-2 text-right">Score Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono tabular-nums">
                  {(fairnessData?.history || []).map(h => (
                    <tr key={h.allocation_id}>
                      <td className="py-2.5 px-2 text-zinc-200">{h.machine_id || 'L-106'}</td>
                      <td className="py-2.5 px-2 text-zinc-300">{h.duration_hours ?? 1}h</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                          h.demand_level === 'HIGH_DEMAND'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        }`}>
                          {h.demand_level || 'NORMAL'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <span className="text-zinc-400">{h.score_before} → </span>
                        <strong className="text-zinc-100">{h.score_after} pts</strong>
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
