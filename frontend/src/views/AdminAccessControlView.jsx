import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function AdminAccessControlView() {
  const { currentUser } = useAuth();
  const { subscribe } = useSocket();

  const [tokenInput, setTokenInput] = useState('L106-2026-00125');
  const [verdict, setVerdict] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [banner, setBanner] = useState(null);

  const fetchShiftLogs = async () => {
    try {
      const res = await fetch('/api/access/shift-log');
      if (res.ok) setShiftLogs(await res.json());
    } catch {
      // ignore
    }
  };

  const handleVerify = async (overrideToken) => {
    const code = (overrideToken ?? tokenInput).trim();
    if (!code) return;
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code })
      });
      setVerdict(await res.json());
    } catch (e) {
      setVerdict({ authorized: false, code: 'NETWORK_ERROR', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShiftLogs();
    handleVerify('L106-2026-00125');
  }, []);

  useEffect(() => {
    const unsub = subscribe('GATE_EVENT', fetchShiftLogs);
    return () => unsub && unsub();
  }, [subscribe]);

  const handleCheckIn = async () => {
    if (!verdict?.pass?.pass_id) return;
    const res = await fetch('/api/access/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
      body: JSON.stringify({ passId: verdict.pass.pass_id, notes: 'Verified at L-106 access desk' })
    });
    const data = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: `Check-in confirmed for ${data.machineId}.` });
      await handleVerify(tokenInput);
      await fetchShiftLogs();
    } else {
      setBanner({ type: 'error', text: data.error || 'Check-in failed.' });
    }
  };

  const handleCheckOut = async () => {
    if (!verdict?.pass?.booking_id) return;
    const res = await fetch('/api/access/check-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
      body: JSON.stringify({ bookingId: verdict.pass.booking_id, notes: 'Checked out at L-106 access desk' })
    });
    const data = await res.json();
    if (res.ok) {
      setBanner({
        type: 'success',
        text: `Checked out from ${data.machineId} (${data.durationHours}h ${data.demandLevel}). Score updated to ${data.scoreAfter} pts.`
      });
      await handleVerify(tokenInput);
      await fetchShiftLogs();
    } else {
      setBanner({ type: 'error', text: data.error || 'Check-out failed.' });
    }
  };

  const isCheckedIn = verdict?.pass?.status === 'CHECKED_IN' || verdict?.code === 'ALREADY_CHECKED_IN';

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header (Exact 12_admin_access_control.png) */}
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
          Access control
        </h1>
        <p className="text-[13px] text-[#64748B] mt-1">
          Scan QR passes, check students in and out
        </p>
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

      {/* Main Split: QR Scanner (7 cols) + Verification Result (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* Left: QR Scanner Card */}
        <section className="xl:col-span-7 fl-card p-6 flex flex-col justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">QR scanner</h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Hold the student&apos;s pass in front of the camera
            </p>

            {/* Dark Navy Optical Frame (Exact 12_admin_access_control.png) */}
            <div className="mt-4 w-full aspect-[16/9] rounded-2xl bg-[#0B1120] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="w-40 h-40 rounded-2xl border-2 border-[#6366F1] bg-white/[0.02]" />
              <span className="text-xs text-[#94A3B8] mt-4">
                Align QR code inside the frame
              </span>
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="block text-[11px] font-medium text-[#64748B]">
              Or enter pass code manually
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="L106-2026-00125 or signed QR token"
                className="flex-1 h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-mono text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5]"
              />
              <button
                type="button"
                onClick={() => handleVerify(tokenInput)}
                disabled={loading}
                className="h-10 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs transition-colors"
              >
                {loading ? 'Checking...' : 'Verify'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTokenInput('L106-2026-00125');
                  handleVerify('L106-2026-00125');
                }}
                className="px-2.5 py-1 rounded-lg bg-[#DCFCE7] text-[#15803D] text-[11px] font-semibold"
              >
                Test valid pass
              </button>
              <button
                type="button"
                onClick={() => {
                  setTokenInput('FAIRPASS:EXPIRED-OR-REVOKED');
                  handleVerify('FAIRPASS:EXPIRED-OR-REVOKED');
                }}
                className="px-2.5 py-1 rounded-lg bg-[#FEE2E2] text-[#DC2626] text-[11px] font-semibold"
              >
                Test invalid pass
              </button>
            </div>
          </div>
        </section>

        {/* Right: Verification Result Card */}
        <aside className="xl:col-span-5 fl-card p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Verification result</h2>
            <p className="text-xs text-[#64748B] mt-0.5">Last scan · just now</p>

            {verdict && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold mt-3 ${
                  verdict.authorized
                    ? 'bg-[#DCFCE7] text-[#15803D]'
                    : isCheckedIn
                    ? 'bg-[#FEF3C7] text-[#B45309]'
                    : 'bg-[#FEE2E2] text-[#DC2626]'
                }`}
              >
                {verdict.authorized
                  ? 'Valid · unused'
                  : isCheckedIn
                  ? 'Checked in · active'
                  : verdict.code || 'Rejected'}
              </span>
            )}

            {verdict?.student ? (
              <div className="mt-6 space-y-5 text-xs">
                <div className="flex items-center justify-between py-2 border-b border-[#F1F5F9]">
                  <span className="text-[#64748B]">Student</span>
                  <strong className="text-[#0F172A] font-semibold">{verdict.student.name}</strong>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#F1F5F9]">
                  <span className="text-[#64748B]">Workstation</span>
                  <strong className="text-[#0F172A] font-mono font-bold">
                    {verdict.workstation?.display_label || verdict.workstation?.machine_id}
                  </strong>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#F1F5F9]">
                  <span className="text-[#64748B]">Interval</span>
                  <strong className="text-[#0F172A] font-mono tabular-nums">{verdict.slot?.time || '—'}</strong>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[#64748B]">Roll number</span>
                  <strong className="text-[#0F172A] font-mono">{verdict.student.roll_no}</strong>
                </div>
              </div>
            ) : (
              <div className="mt-6 p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#DC2626]">
                {verdict?.message || 'Scan or enter a booking ID to inspect pass details.'}
              </div>
            )}
          </div>

          <div className="mt-6 space-y-3">
            <div className="px-3.5 py-2.5 rounded-xl bg-[#FEF3C7] text-[#92400E] text-[11px] font-medium">
              Authorization recorded. Physical door relay: planned hardware integration.
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {verdict?.authorized && !isCheckedIn ? (
                <button
                  type="button"
                  onClick={handleCheckIn}
                  className="h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
                >
                  Confirm check-in
                </button>
              ) : isCheckedIn ? (
                <button
                  type="button"
                  onClick={handleCheckOut}
                  className="h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
                >
                  Confirm check-out
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="h-10 rounded-xl bg-[#E2E8F0] text-[#94A3B8] font-semibold text-xs cursor-not-allowed"
                >
                  Confirm check-in
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setVerdict({ authorized: false, code: 'OPERATOR_REJECTED', message: 'Entry rejected by desk operator.' });
                }}
                className="h-10 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#E5E7EB] text-[#0F172A] font-semibold text-xs transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom: Today's Entry Log Table */}
      <section className="fl-card overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F1F5F9]">
          <h2 className="text-[14px] font-bold text-[#0F172A]">Today&apos;s entry log</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
              <tr>
                <th className="py-3 px-6 font-medium">Time</th>
                <th className="py-3 px-4 font-medium">Student</th>
                <th className="py-3 px-4 font-medium">Workstation</th>
                <th className="py-3 px-4 font-medium">Action</th>
                <th className="py-3 px-6 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
              {shiftLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#64748B]">
                    No entry events recorded yet today.
                  </td>
                </tr>
              ) : (
                shiftLogs.map(log => (
                  <tr key={log.entry_id} className="hover:bg-[#F8FAFC]">
                    <td className="py-3.5 px-6 font-mono text-[#475569] whitespace-nowrap">
                      {new Date(log.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-[#0F172A]">
                      {log.student_name} <span className="font-mono font-normal text-[#94A3B8]">({log.roll_no})</span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[#475569]">{log.machine_id || '—'}</td>
                    <td className="py-3.5 px-4 text-[#475569]">{log.notes || 'Gate scan'}</td>
                    <td className="py-3.5 px-6">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          log.status === 'AUTHORIZED'
                            ? 'bg-[#DCFCE7] text-[#15803D]'
                            : 'bg-[#FEE2E2] text-[#DC2626]'
                        }`}
                      >
                        {log.status === 'AUTHORIZED' ? 'Success' : 'Rejected'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

