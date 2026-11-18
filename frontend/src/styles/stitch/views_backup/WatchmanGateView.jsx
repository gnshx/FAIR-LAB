import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';

export default function WatchmanGateView() {
  const { subscribe } = useSocket();

  const [tokenInput, setTokenInput] = useState('L106-2026-00125');
  const [verdict, setVerdict] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [lastActionMsg, setLastActionMsg] = useState('');
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
    return () => unsub();
  }, []);

  const handleVerifyToken = async (overrideToken) => {
    const tokenToUse = overrideToken || tokenInput;
    if (!tokenToUse) return;

    setLoading(true);
    setVerdict(null);
    setLastActionMsg('');

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

  // Check In action
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
        setLastActionMsg(`Gate Unlatched: Student checked in to ${data.machineId}.`);
        await handleVerifyToken(tokenInput);
        await fetchShiftLogs();
      } else {
        alert(data.error || 'Check-in failed');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  // Check Out action
  const handleCheckOut = async (bookingId) => {
    try {
      const res = await fetch('/api/access/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, notes: 'Session concluded cleanly at gate terminal' })
      });
      const data = await res.json();
      if (res.ok) {
        setLastActionMsg(`Session Closed: ${data.machineId} returned to pool (${data.durationHours}h ${data.demandLevel}). -${data.deduction} pts applied (Score: ${data.scoreAfter} pts).`);
        await handleVerifyToken(tokenInput);
        await fetchShiftLogs();
      } else {
        alert(data.error || 'Check-out failed');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="flex flex-col w-full gap-6 text-zinc-100">
      {/* Turnstile Terminal Ribbon */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-zinc-900/60 px-6 py-4 rounded-2xl border border-zinc-800 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-800 text-emerald-400 border border-zinc-700">
            <span className="material-symbols-outlined text-[20px]">shield_person</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">
                L-106 Turnstile Terminal · Edge Gate Controller
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Online
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Cryptographic HMAC-SHA256 signature verification with anti-replay state enforcement.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${gateRelayPulse ? 'bg-amber-400 animate-ping' : 'bg-emerald-500'}`} />
            <span className="text-zinc-400">
              Relay: <strong className={gateRelayPulse ? 'text-amber-400' : 'text-zinc-200'}>{gateRelayPulse ? 'UNLATCHED (500ms)' : 'LOCKED (FAIL-SECURE)'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Main Scanner & Verification Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Optical Scanner & Manual Input (5 cols) */}
        <div className="xl:col-span-5 flex flex-col gap-5">
          <div className="bg-zinc-900/60 rounded-2xl p-6 border border-zinc-800 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-[20px]">qr_code_scanner</span>
                <span className="text-xs font-mono text-zinc-200 uppercase font-bold tracking-wider">
                  Optical Barcode Sensor Feed
                </span>
              </div>
              <span className="text-xs font-mono text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                Sensor Ready
              </span>
            </div>

            {/* Target Alignment Window */}
            <div className="relative w-full aspect-video bg-zinc-950 rounded-xl overflow-hidden flex flex-col items-center justify-center border border-zinc-800">
              <div className="w-36 h-36 border border-zinc-700/80 rounded-xl flex items-center justify-center bg-zinc-900/40 relative">
                <span className="material-symbols-outlined text-zinc-600 text-[48px]">qr_code_2</span>
                <span className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-emerald-400"></span>
                <span className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-emerald-400"></span>
                <span className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-emerald-400"></span>
                <span className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-emerald-400"></span>
              </div>
              <span className="text-xs font-mono text-zinc-500 mt-3">
                Align student digital pass QR within scanner bounds
              </span>
            </div>

            {/* Test Simulation Triggers */}
            <div>
              <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider block mb-2">
                Preset Test Passes
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <button
                  onClick={() => {
                    setTokenInput('L106-2026-00125');
                    handleVerifyToken('L106-2026-00125');
                  }}
                  className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left text-emerald-400 transition-colors"
                >
                  Valid Pass: Ganesh
                </button>
                <button
                  onClick={() => {
                    setTokenInput('FAIRPASS:EXPIRED-OR-REVOKED');
                    handleVerifyToken('FAIRPASS:EXPIRED-OR-REVOKED');
                  }}
                  className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left text-rose-400 transition-colors"
                >
                  Invalid / Forged Pass
                </button>
              </div>
            </div>

            {/* Manual Token Lookup */}
            <div className="flex flex-col gap-2 pt-3 border-t border-zinc-800">
              <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
                Manual Token / Roll Lookup
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste QR token, Roll No, or Booking ID"
                  className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-xs focus:border-emerald-500 outline-none placeholder:text-zinc-600"
                />
                <button
                  onClick={() => handleVerifyToken(tokenInput)}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-zinc-950 font-bold hover:bg-emerald-400 text-xs font-mono transition-colors"
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Instant Verification Verdict & Turnstile Actions (7 cols) */}
        <div className="xl:col-span-7 flex flex-col gap-5">
          {verdict ? (
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 shadow-sm flex flex-col justify-between">
              <div>
                {/* Status Header */}
                <div className={`p-4 rounded-xl flex items-center justify-between mb-5 border font-mono ${
                  verdict.authorized
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : verdict.code === 'ALREADY_CHECKED_IN'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[24px]">
                      {verdict.authorized ? 'verified' : verdict.code === 'ALREADY_CHECKED_IN' ? 'lock' : 'block'}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold tracking-tight">
                        {verdict.message}
                      </h3>
                      <p className="text-xs opacity-80 mt-0.5">
                        {verdict.authorized ? 'Ready for turnstile release' : `Code: ${verdict.code}`}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs uppercase px-2.5 py-1 rounded bg-zinc-950/80 font-bold border border-current">
                    {verdict.code}
                  </span>
                </div>

                {lastActionMsg && (
                  <div className="mb-5 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono">
                    {lastActionMsg}
                  </div>
                )}

                {/* Student & System Dossier Card */}
                {verdict.student && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs">
                    {/* Student Info */}
                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-300">
                        <span className="material-symbols-outlined text-[24px]">person</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 uppercase block text-xs">Authorized Candidate</span>
                        <h4 className="font-bold text-zinc-100 text-sm font-sans">{verdict.student.name}</h4>
                        <div className="text-emerald-400 font-semibold">{verdict.student.roll_no}</div>
                        <div className="text-zinc-400 font-sans mt-0.5">{verdict.student.department}</div>
                      </div>
                    </div>

                    {/* Assigned Hardware */}
                    <div className="space-y-1.5 border-t md:border-t-0 md:border-l border-zinc-800 pt-3 md:pt-0 md:pl-4">
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-500">Assigned Seat:</span>
                        <strong className="text-emerald-400 font-bold">
                          {verdict.workstation?.display_label || verdict.workstation?.machine_id}
                        </strong>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-500">Physical Location:</span>
                        <span className="text-zinc-300">
                          Block {verdict.workstation?.block_code || 'A'} · Row {verdict.workstation?.row_num || 1} · Seat {verdict.workstation?.seat_num || 1}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-zinc-800/60">
                        <span className="text-zinc-500">Time Window:</span>
                        <span className="text-zinc-300">{verdict.slot?.time} ({verdict.slot?.demandLevel || 'NORMAL'})</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-zinc-500">Purpose:</span>
                        <span className="text-zinc-300 truncate max-w-[170px] font-sans">{verdict.purpose}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Physical Gate Controls */}
              <div className="mt-6 pt-5 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-mono text-zinc-400">
                  Physical Turnstile Alpha · Relays Armed
                </span>

                <div className="flex items-center gap-3">
                  {verdict.authorized && verdict.pass?.status !== 'CHECKED_IN' && (
                    <button
                      onClick={() => handleCheckIn(verdict.pass?.pass_id)}
                      className="px-5 py-2.5 rounded-xl bg-emerald-500 text-zinc-950 font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2 text-xs font-mono shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[18px]">lock_open</span>
                      <span>Check In & Unlatch Gate</span>
                    </button>
                  )}

                  {(verdict.pass?.status === 'CHECKED_IN' || verdict.code === 'ALREADY_CHECKED_IN') && (
                    <button
                      onClick={() => handleCheckOut(verdict.pass?.booking_id)}
                      className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold transition-colors flex items-center gap-2 text-xs font-mono"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      <span>Check Out Student (Apply Duration Deduction)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-center flex flex-col items-center justify-center h-full">
              <span className="material-symbols-outlined text-[40px] text-zinc-500 mb-3">qr_code_scanner</span>
              <h3 className="text-base font-bold text-zinc-200">Awaiting Pass Scan</h3>
              <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
                Position student QR pass near the optical reader or search by Roll Number to trigger verification.
              </p>
            </div>
          )}

          {/* Today's Gate Log */}
          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-[18px]">history</span>
                <h4 className="text-xs font-mono uppercase font-bold text-zinc-200 tracking-wider">
                  Today's L-106 Turnstile Activity Stream
                </h4>
              </div>
              <span className="text-xs font-mono text-zinc-500">{shiftLogs.length} events logged</span>
            </div>

            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {shiftLogs.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-500 font-mono">No entry events yet today.</div>
              ) : (
                shiftLogs.map((log) => (
                  <div
                    key={log.entry_id}
                    className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${log.status === 'AUTHORIZED' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      <div>
                        <div className="font-semibold text-zinc-200 font-sans">
                          {log.student_name} <span className="font-mono text-emerald-400 font-normal">({log.roll_no})</span>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {log.machine_id ? `Assigned: ${log.machine_id} · ` : ''}{log.notes}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-zinc-500">
                      {new Date(log.check_in_time).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
