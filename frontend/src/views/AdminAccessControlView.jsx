import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { useAuth, isGateDeskUser } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function AdminAccessControlView() {
  const { currentUser, profile } = useAuth();
  const { subscribe } = useSocket();
  const isGateUser = isGateDeskUser(profile?.user);

  const [sampleToken, setSampleToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [verdict, setVerdict] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [banner, setBanner] = useState(null);
  const [gateRelayPulse, setGateRelayPulse] = useState(false);

  // Camera scanner state & refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const lastScannedTokenRef = useRef('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height);
          if (code && code.data) {
            const detectedToken = code.data.trim();
            setTokenInput(detectedToken);
            handleVerify(detectedToken);
          } else {
            setCameraError('No QR barcode detected in the selected image. Please hold closer or take a clearer photo.');
          }
        } catch (err) {
          setCameraError(`Image scan error: ${err.message}`);
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

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

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Webcam access is not supported in this browser environment. You can enter token manually or click the sample pass buttons.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err) {
      console.warn('Camera request error:', err);
      setCameraActive(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera permissions in your browser address bar.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No webcam hardware found. You can test pass scanning with the 1-click test buttons below.');
      } else {
        setCameraError(`Camera unavailable: ${err.message || err.name}`);
      }
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // Auto-request camera on mount; release on unmount
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  // Real-time canvas frame scanning loop with jsQR
  useEffect(() => {
    let animId;
    let lastScanTime = 0;

    const scanFrame = () => {
      if (cameraActive && videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          const now = Date.now();
          if (now - lastScanTime > 160) {
            lastScanTime = now;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            try {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert'
              });

              if (code && code.data && code.data.trim().startsWith('FAIRPASS:')) {
                const detectedToken = code.data.trim();
                if (detectedToken !== lastScannedTokenRef.current) {
                  lastScannedTokenRef.current = detectedToken;
                  setTokenInput(detectedToken);
                  handleVerify(detectedToken);
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try { navigator.vibrate(100); } catch {}
                  }
                }
              }
            } catch {
              // Frame decoding error ignored
            }
          }
        }
      }
      animId = requestAnimationFrame(scanFrame);
    };

    animId = requestAnimationFrame(scanFrame);
    return () => cancelAnimationFrame(animId);
  }, [cameraActive]);

  useEffect(() => {
    fetchShiftLogs();

    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const urlToken = searchParams ? searchParams.get('token') : null;

    if (urlToken) {
      setTokenInput(urlToken);
      handleVerify(urlToken);
    } else {
      // Fetch active sample pass for immediate 1-click testing
      fetch('/api/access/sample-pass')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.signed_token) {
            setSampleToken(data.signed_token);
            setTokenInput(data.signed_token);
            handleVerify(data.signed_token);
          }
        })
        .catch(() => {});
    }
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
      body: JSON.stringify({ passId: verdict.pass.pass_id, notes: 'Physical turnstile relay momentary pulse (500ms)' })
    });
    const data = await res.json();
    if (res.ok) {
      setGateRelayPulse(true);
      setTimeout(() => setGateRelayPulse(false), 2500);
      setBanner({
        type: 'success',
        text: `Gate Turnstile Unlatched: Check-in recorded for student on ${data.machineId}. Workstation status is now OCCUPIED.`
      });
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
        text: `Checked out from ${data.machineId} (${data.durationHours}h ${data.demandLevel}). −${data.deduction} pts applied (Score: ${data.scoreAfter} pts). Workstation returned to AVAILABLE pool.`
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
      {/* Header (Exact 12_admin_access_control.png with quick demo navigation) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
              Access control
            </h1>
            <span className="px-2 py-0.5 rounded-md bg-[#EEF2FF] text-[#4F46E5] text-[11px] font-semibold border border-[#E0E7FF]">
              Gate Operator Console
            </span>
          </div>
          <p className="text-[13px] text-[#64748B] mt-1">
            Optical QR pass scanner & turnstile gate solenoid relay controller · Lab L-106
          </p>
        </div>

        {!isGateUser && (
          <div className="flex items-center gap-2">
            <a
              href="/bookings"
              className="h-8 px-3 rounded-lg bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[11.5px] font-medium text-[#475569] flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">arrow_back</span>
              <span>Student Bookings</span>
            </a>
            <a
              href="/overview"
              className="h-8 px-3 rounded-lg bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[11.5px] font-medium text-[#475569] flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">dashboard</span>
              <span>Admin Overview</span>
            </a>
          </div>
        )}
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

            {/* Dark Navy Optical Frame with Live Camera Stream & Turnstile Relay */}
            <div
              className={`mt-4 w-full aspect-[16/9] rounded-2xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 ${
                gateRelayPulse
                  ? 'bg-[#064E3B] border-2 border-[#10B981] shadow-[0_0_30px_rgba(16,185,129,0.35)]'
                  : 'bg-[#0B1120]'
              }`}
            >
              {/* Live Optical Webcam Video Feed */}
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                  cameraActive && !gateRelayPulse ? 'opacity-90' : 'opacity-0 pointer-events-none'
                }`}
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Overlay: Turnstile Relay Pulse Animation */}
              {gateRelayPulse ? (
                <div className="relative z-10 flex flex-col items-center justify-center animate-bounce text-center px-4 bg-[#064E3B]/80 backdrop-blur-sm w-full h-full">
                  <div className="w-14 h-14 rounded-full bg-[#10B981] text-white flex items-center justify-center mb-2 shadow-lg">
                    <span className="material-symbols-outlined text-[32px]">lock_open</span>
                  </div>
                  <span className="text-white font-bold text-sm tracking-wide">
                    TURNSTILE UNLATCHED
                  </span>
                  <span className="text-[#A7F3D0] text-xs mt-0.5 font-mono">
                    500ms Momentary Relay Pulse
                  </span>
                </div>
              ) : (
                <div className="relative z-10 flex flex-col items-center justify-center">
                  {/* Optical Scanning Target Reticle */}
                  <div
                    className={`relative w-40 h-40 sm:w-44 sm:h-44 rounded-2xl border-2 transition-colors flex flex-col items-center justify-center p-2 text-center ${
                      verdict?.authorized
                        ? 'border-[#10B981] bg-[#10B981]/15 shadow-[0_0_25px_rgba(16,185,129,0.3)]'
                        : 'border-[#6366F1] bg-white/[0.04] shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                    }`}
                  >
                    {/* Animated Scanning Laser Line */}
                    {cameraActive && (
                      <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-[#38BDF8] to-transparent animate-pulse shadow-[0_0_8px_#38BDF8]" />
                    )}

                    {/* Corner Reticle Accents */}
                    <div className="absolute top-1.5 left-1.5 w-3.5 h-3.5 border-t-2 border-l-2 border-white/70 rounded-tl-sm pointer-events-none" />
                    <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 border-t-2 border-r-2 border-white/70 rounded-tr-sm pointer-events-none" />
                    <div className="absolute bottom-1.5 left-1.5 w-3.5 h-3.5 border-b-2 border-l-2 border-white/70 rounded-bl-sm pointer-events-none" />
                    <div className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 border-b-2 border-r-2 border-white/70 rounded-br-sm pointer-events-none" />

                    {!cameraActive && (
                      <div className="flex flex-col items-center gap-1.5 pointer-events-auto">
                        <button
                          type="button"
                          onClick={startCamera}
                          className="px-3 py-1.5 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white text-[11px] font-semibold flex items-center gap-1 shadow-sm transition-all"
                        >
                          <span className="material-symbols-outlined text-[15px]">videocam</span>
                          <span>Start camera</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[#E2E8F0] text-[10px] font-medium flex items-center gap-1 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">photo_camera</span>
                          <span>Snap QR photo</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <span className="text-xs text-[#E2E8F0] mt-3 font-mono bg-black/60 px-3 py-1 rounded-full backdrop-blur-sm shadow-sm pointer-events-none">
                    {verdict?.authorized
                      ? 'Pass verified · Ready for turnstile check-in'
                      : cameraActive
                      ? 'Camera active · Hold student QR pass inside target'
                      : 'Click above or choose photo to scan QR'}
                  </span>
                </div>
              )}
            </div>

            {/* Hidden Photo / Camera Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Camera Control & Permission Toolbar */}
            <div className="flex items-center justify-between text-xs pt-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${cameraActive ? 'bg-[#10B981] animate-ping' : 'bg-[#94A3B8]'}`} />
                <span className="text-[#64748B] font-medium text-[11px]">
                  {cameraActive ? 'Live webcam optical feed active' : 'Webcam standby'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-1 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#475569] font-medium text-[11px] flex items-center gap-1 transition-colors"
                  title="Snap photo with camera or choose screenshot"
                >
                  <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                  <span>Snap photo</span>
                </button>
                <button
                  type="button"
                  onClick={cameraActive ? stopCamera : startCamera}
                  className="px-2.5 py-1 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#475569] font-medium text-[11px] flex items-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {cameraActive ? 'videocam_off' : 'videocam'}
                  </span>
                  <span>{cameraActive ? 'Turn off' : 'Start camera'}</span>
                </button>
              </div>
            </div>

            {cameraError && (
              <div className="mt-1.5 p-2.5 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] text-[#B45309] text-[11px] flex items-center justify-between">
                <span>{cameraError}</span>
                <button
                  type="button"
                  onClick={startCamera}
                  className="font-bold underline ml-2 hover:text-[#78350F] shrink-0"
                >
                  Retry camera
                </button>
              </div>
            )}
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
                placeholder="FAIRPASS:... signed QR token"
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
                onClick={async () => {
                  let token = sampleToken;
                  if (!token) {
                    try {
                      const res = await fetch('/api/access/sample-pass');
                      if (res.ok) {
                        const data = await res.json();
                        token = data.signed_token;
                        setSampleToken(token);
                      }
                    } catch {
                      // ignore
                    }
                  }
                  if (token) {
                    setTokenInput(token);
                    handleVerify(token);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-[#DCFCE7] text-[#15803D] hover:bg-[#BBF7D0] text-[11px] font-semibold transition-colors"
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

