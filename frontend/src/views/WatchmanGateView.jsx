import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';

export default function WatchmanGateView() {
  const { subscribe } = useSocket();

  const [tokenInput, setTokenInput] = useState('L106-2026-00125');
  const [verdict, setVerdict] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [actionBanner, setActionBanner] = useState(null);
  const [gateRelayPulse, setGateRelayPulse] = useState(false);

  const fetchShiftLogs = async () => {
    try {
      const res = await fetch('/api/access/shift-log');
      if (res.ok) setShiftLogs(await res.json());
    } catch (e) {
      console.error('Failed to fetch shift logs', e);
    }
  };

  useEffect(() => {
    fetchShiftLogs();
    handleVerifyToken('L106-2026-00125');
  }, []);

  useEffect(() => {
    const unsub = subscribe('GATE_EVENT', () => {
      fetchShiftLogs();
    });
    return () => unsub && unsub();
  }, [subscribe]);

  const handleVerifyToken = async (overrideToken) => {
    const tokenToUse = overrideToken || tokenInput;
    if (!tokenToUse) return;

    setLoading(true);
    setVerdict(null);
    setActionBanner(null);

    try {
      const res = await fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToUse })
      });
      const data = await res.json();
      setVerdict(data);
    } catch (e) {
      setVerdict({ authorized: false, code: 'NETWORK_ERROR', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async (passId) => {
    try {
      const res = await fetch('/api/access/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passId, notes: 'Physical turnstile relay momentary pulse (500ms)' })
      });
      const data = await res.json();
      if (res.ok) {
        setGateRelayPulse(true);
        setTimeout(() => setGateRelayPulse(false), 2000);
        setActionBanner({ type: 'success', text: `Gate Unlatched: Student checked in to ${data.machineId}.` });
        await handleVerifyToken(tokenInput);
        await fetchShiftLogs();
      } else {
        setActionBanner({ type: 'error', text: data.error || 'Check-in failed.' });
      }
    } catch (e) {
      setActionBanner({ type: 'error', text: e.message });
    }
  };

  const handleCheckOut = async (bookingId) => {
    try {
      const res = await fetch('/api/access/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, notes: 'Session concluded cleanly at gate terminal' })
      });
      const data = await res.json();
      if (res.ok) {
        setActionBanner({
          type: 'success',
          text: `Session Closed: ${data.machineId} returned to pool (${data.durationHours}h ${data.demandLevel}). −${data.deduction} pts applied (Score: ${data.scoreAfter} pts).`
        });
        await handleVerifyToken(tokenInput);
        await fetchShiftLogs();
      } else {
        setActionBanner({ type: 'error', text: data.error || 'Check-out failed.' });
      }
    } catch (e) {
      setActionBanner({ type: 'error', text: e.message });
    }
  };

  return (
    <div className="flex flex-col w-full gap-6 text-[#1D2939]">
      {/* Page Header & Turnstile Status Bar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white px-6 py-4 rounded-2xl border border-[#EAECF0] shadow-card">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#F0EEFF] text-[#5B4CF5] border border-[#E4DDFF] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[21px]">shield_person</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-display font-bold text-[#1D2939] tracking-tight">
                L-106 Gate Scanner &amp; Turnstile Terminal
              </h1>
              <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#ECFDF3] text-[#15803D] border border-[#A6F4C5]">
                Online
              </span>
            </div>
            <p className="text-xs text-[#667085] mt-0.5">
              HMAC-SHA256 pass signature verification with single-entry anti-replay enforcement.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#F7F8FC] border border-[#EAECF0] text-xs font-mono self-start lg:self-auto">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              gateRelayPulse ? 'bg-[#D97706] animate-ping' : 'bg-[#16A34A]'
            }`}
          />
          <span className="text-[#667085]">
            Relay:{' '}
            <strong className={gateRelayPulse ? 'text-[#B45309]' : 'text-[#1D2939]'}>
              {gateRelayPulse ? 'UNLATCHED (500ms)' : 'LOCKED (FAIL-SECURE)'}
            </strong>
          </span>
        </div>
      </section>

      {/* Main Scanner & Verification Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Optical Reader & Manual Token Lookup (5 cols) */}
        <section className="xl:col-span-5 bg-white rounded-2xl p-6 border border-[#EAECF0] shadow-card flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3.5 border-b border-[#EAECF0]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#5B4CF5] text-[20px]">qr_code_scanner</span>
              <h2 className="text-sm font-bold text-[#1D2939]">Optical Barcode Sensor</h2>
            </div>
            <span className="text-[11px] font-mono font-medium text-[#15803D] bg-[#ECFDF3] px-2.5 py-0.5 rounded-full border border-[#A6F4C5]">
              Sensor Ready
            </span>
          </div>

          {/* Target Alignment Window (clean light dotted-grid frame) */}
          <div className="relative w-full aspect-video lab-dotted-grid rounded-2xl overflow-hidden flex flex-col items-center justify-center border border-[#D0D5DD]">
            <div className="w-36 h-36 bg-white/95 border border-[#D0D5DD] rounded-2xl flex items-center justify-center relative shadow-card">
              <span className="material-symbols-outlined text-[#98A2B3] text-[48px]">qr_code_2</span>
              <span className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#5B4CF5] rounded-tl-sm" />
              <span className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#5B4CF5] rounded-tr-sm" />
              <span className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#5B4CF5] rounded-bl-sm" />
              <span className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#5B4CF5] rounded-br-sm" />
            </div>
            <span className="text-xs text-[#667085] mt-3 font-medium">
              Align student digital pass QR within scanner bounds
            </span>
          </div>

          {/* Preset Test Passes */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] block mb-2">
              Quick Verification Presets
            </span>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setTokenInput('L106-2026-00125');
                  handleVerifyToken('L106-2026-00125');
                }}
                className="p-3 rounded-xl bg-[#ECFDF3] hover:bg-[#DCFCE7] border border-[#86EFAC] text-left transition-colors"
              >
                <div className="font-semibold text-[#15803D]">Valid Pass · Ganesh</div>
                <div className="font-mono text-[11px] text-[#15803D]/80 mt-0.5">L106-2026-00125</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTokenInput('FAIRPASS:EXPIRED-OR-REVOKED');
                  handleVerifyToken('FAIRPASS:EXPIRED-OR-REVOKED');
                }}
                className="p-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FCA5A5] text-left transition-colors"
              >
                <div className="font-semibold text-[#DC2626]">Invalid / Forged</div>
                <div className="font-mono text-[11px] text-[#DC2626]/80 mt-0.5">Test rejection flow</div>
              </button>
            </div>
          </div>

          {/* Manual Token Lookup */}
          <div className="flex flex-col gap-2 pt-4 border-t border-[#EAECF0]">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
              Manual Token / Booking ID Lookup
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste QR token, Roll No, or Booking ID"
                className="flex-1 h-10 px-3 rounded-xl bg-white border border-[#D0D5DD] text-[#1D2939] font-mono text-xs focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15 outline-none placeholder:text-[#98A2B3]"
              />
              <button
                type="button"
                onClick={() => handleVerifyToken(tokenInput)}
                disabled={loading}
                className="h-10 px-4 rounded-xl bg-[#5B4CF5] hover:bg-[#4F22F2] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors"
              >
                {loading ? 'Checking...' : 'Verify'}
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Instant Verdict & Activity Stream (7 cols) */}
        <div className="xl:col-span-7 flex flex-col gap-6">
          {verdict ? (
            <section className="p-6 rounded-2xl bg-white border border-[#EAECF0] shadow-card flex flex-col justify-between">
              <div>
                {/* Verdict Banner */}
                <div
                  className={`p-4 rounded-xl flex items-center justify-between gap-3 mb-5 border ${
                    verdict.authorized
                      ? 'bg-[#ECFDF3] border-[#86EFAC] text-[#15803D]'
                      : verdict.code === 'ALREADY_CHECKED_IN'
                      ? 'bg-[#FFFBEB] border-[#FCD34D] text-[#B45309]'
                      : 'bg-[#FEF2F2] border-[#FCA5A5] text-[#DC2626]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[24px]">
                      {verdict.authorized ? 'verified' : verdict.code === 'ALREADY_CHECKED_IN' ? 'lock' : 'block'}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold tracking-tight">{verdict.message}</h3>
                      <p className="text-xs opacity-85 mt-0.5">
                        {verdict.authorized ? 'Cryptographic signature verified · Ready for gate release' : `Verification code: ${verdict.code}`}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono uppercase px-2.5 py-1 rounded-full bg-white/80 font-bold border border-current shrink-0">
                    {verdict.code}
                  </span>
                </div>

                {actionBanner && (
                  <div
                    className={`mb-5 px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
                      actionBanner.type === 'success'
                        ? 'bg-[#EFF6FF] border-[#93C5FD] text-[#1D4ED8]'
                        : 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]'
                    }`}
                  >
                    <span>{actionBanner.text}</span>
                    <button type="button" onClick={() => setActionBanner(null)} className="opacity-70 hover:opacity-100">
                      <span className="material-symbols-outlined text-[15px]">close</span>
                    </button>
                  </div>
                )}

                {/* Student & Assigned Seat Card */}
                {verdict.student && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 rounded-2xl bg-[#F7F8FC] border border-[#EAECF0] text-xs">
                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-white border border-[#EAECF0] flex items-center justify-center shrink-0 text-[#5B4CF5] font-bold text-base">
                        {(verdict.student.name || 'S').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="text-[10px] font-mono uppercase text-[#667085] block">Authorized Student</span>
                        <h4 className="font-bold text-[#1D2939] text-sm mt-0.5">{verdict.student.name}</h4>
                        <div className="font-mono text-[#5B4CF5] font-semibold mt-0.5">{verdict.student.roll_no}</div>
                        <div className="text-[#667085] mt-0.5">{verdict.student.department}</div>
                      </div>
                    </div>

                    <div className="space-y-2 border-t md:border-t-0 md:border-l border-[#EAECF0] pt-3 md:pt-0 md:pl-5 font-mono">
                      <div className="flex justify-between py-1 border-b border-[#EAECF0]">
                        <span className="text-[#667085]">Assigned Seat</span>
                        <strong className="text-[#15803D] font-bold">
                          {verdict.workstation?.display_label || verdict.workstation?.machine_id}
                        </strong>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[#EAECF0]">
                        <span className="text-[#667085]">Location</span>
                        <span className="text-[#1D2939]">
                          Block {verdict.workstation?.block_code || 'A'} · R{verdict.workstation?.row_num || 1} · S{verdict.workstation?.seat_num || 1}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[#EAECF0]">
                        <span className="text-[#667085]">Window</span>
                        <span className="text-[#1D2939]">{verdict.slot?.time} ({verdict.slot?.demandLevel || 'NORMAL'})</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-[#667085]">Purpose</span>
                        <span className="text-[#344054] truncate max-w-[170px] font-sans">{verdict.purpose}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Physical Turnstile Controls */}
              <div className="mt-6 pt-5 border-t border-[#EAECF0] flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-mono text-[#667085]">
                  Turnstile Alpha · Relays Armed
                </span>

                <div className="flex items-center gap-2.5">
                  {verdict.authorized && verdict.pass?.status !== 'CHECKED_IN' && (
                    <button
                      type="button"
                      onClick={() => handleCheckIn(verdict.pass?.pass_id)}
                      className="h-10 px-5 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white font-semibold transition-colors flex items-center gap-2 text-xs shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[18px]">lock_open</span>
                      <span>Check In &amp; Unlatch Gate</span>
                    </button>
                  )}

                  {(verdict.pass?.status === 'CHECKED_IN' || verdict.code === 'ALREADY_CHECKED_IN') && (
                    <button
                      type="button"
                      onClick={() => handleCheckOut(verdict.pass?.booking_id)}
                      className="h-10 px-5 rounded-xl bg-[#13295B] hover:bg-[#1D3B7D] text-white font-semibold transition-colors flex items-center gap-2 text-xs shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      <span>Check Out Student (Apply Duration Deduction)</span>
                    </button>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <section className="p-10 rounded-2xl bg-white border border-[#EAECF0] shadow-card text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] text-[#5B4CF5] flex items-center justify-center mb-3">
                <span className="material-symbols-outlined text-[26px]">qr_code_scanner</span>
              </div>
              <h3 className="text-base font-bold text-[#1D2939]">Awaiting Pass Scan</h3>
              <p className="text-xs text-[#667085] max-w-sm mt-1 leading-relaxed">
                Position a student digital QR pass near the optical reader or enter a Booking ID on the left to verify access.
              </p>
            </section>
          )}

          {/* Turnstile Activity Stream */}
          <section className="bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-[#EAECF0]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#5B4CF5] text-[19px]">history</span>
                <h2 className="text-sm font-bold text-[#1D2939]">Today&apos;s Turnstile Activity Stream</h2>
              </div>
              <span className="text-xs font-mono text-[#667085] tabular-nums">{shiftLogs.length} events</span>
            </div>

            <div className="divide-y divide-[#F2F4F7] max-h-60 overflow-y-auto">
              {shiftLogs.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#667085]">
                  No entry or exit events logged yet today.
                </div>
              ) : (
                shiftLogs.map((log) => (
                  <div
                    key={log.entry_id}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-[#F9FAFB] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          log.status === 'AUTHORIZED' ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-[#1D2939] truncate">
                          {log.student_name}{' '}
                          <span className="font-mono text-[#5B4CF5] font-medium">({log.roll_no})</span>
                        </div>
                        <div className="text-[11px] text-[#667085] truncate mt-0.5">
                          {log.machine_id ? `${log.machine_id} · ` : ''}
                          {log.notes}
                        </div>
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-[#667085] shrink-0 tabular-nums">
                      {new Date(log.check_in_time).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
