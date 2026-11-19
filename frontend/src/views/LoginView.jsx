import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const IIT_BHILAI_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@iitbhilai\.ac\.in$/i;

export default function LoginView({ onSignedIn }) {
  const { setSession } = useAuth();
  const [email, setEmail] = useState('ganesh.k@iitbhilai.ac.in');
  const [password, setPassword] = useState('••••••••');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const completeLoginRequest = async (loginEmail, loginPassword) => {
    setError('');
    const normalized = String(loginEmail || '').trim().toLowerCase();

    if (!IIT_BHILAI_EMAIL_REGEX.test(normalized)) {
      setError('Only official IIT Bhilai email accounts ending with @iitbhilai.ac.in are allowed to sign in.');
      return;
    }

    if (!loginPassword) {
      setError('Password is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized, password: loginPassword })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Sign-in failed. Please verify your @iitbhilai.ac.in credentials.');
        return;
      }

      const userObj = data.user;
      setSession(data.token, userObj);

      const perms = Array.isArray(userObj.permissions) ? userObj.permissions : [];
      const onlyAccessOp = userObj.email === 'accessdesk.l106@iitbhilai.ac.in' ||
        (perms.includes('ACCESS_OPERATOR') && !perms.includes('POLICY_ADMIN'));

      if (onlyAccessOp) {
        onSignedIn('gate', 'admin-access');
      } else if (userObj.role === 'admin') {
        onSignedIn('admin', 'admin-overview');
      } else {
        onSignedIn('student', 'student-dashboard');
      }
    } catch {
      setError('Unable to reach authentication server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    completeLoginRequest(email, password);
  };

  const emailTrimmed = email.trim();
  const showDomainHint = emailTrimmed.length > 0 && !IIT_BHILAI_EMAIL_REGEX.test(emailTrimmed);

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* Left Hero Panel — Exact Obsidian Navy (#0B1120) from 01_login.png */}
      <div className="bg-[#0B1120] text-white flex flex-col justify-center px-10 py-16 lg:px-20">
        <div className="max-w-md">
          <div className="flex items-center gap-3 mb-7">
            <div className="w-9 h-9 rounded-lg bg-[#4F46E5] text-white font-bold text-base flex items-center justify-center">
              F
            </div>
            <span className="font-bold text-xl tracking-tight text-white">FairLab</span>
          </div>

          <h1 className="text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-[1.12]">
            Fair access to every GPU.
          </h1>

          <p className="mt-4 text-sm text-[#94A3B8] leading-relaxed">
            Book Lab L-106 workstations for any time interval. Allocation rewards fairness, not who clicks first.
          </p>

          <ul className="mt-7 space-y-3 text-sm text-[#CBD5E1]">
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] shrink-0" />
              <span>Custom time-interval reservations</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] shrink-0" />
              <span>Priority based on past usage and waiting time</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] shrink-0" />
              <span>QR pass for secure lab entry</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Right Sign-in Panel — Crisp #F6F7FB canvas + Pure White card */}
      <div className="bg-[#F6F7FB] flex flex-col items-center justify-center px-6 py-14">
        <div className="w-full max-w-[390px] bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-card">
          <h2 className="text-xl font-bold text-[#0F172A] tracking-tight">Sign in</h2>
          <p className="text-xs text-[#64748B] mt-1">
            Use your official <span className="font-mono font-semibold text-[#334155]">@iitbhilai.ac.in</span> email
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#DC2626] leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="fl-email" className="block text-[11px] font-medium text-[#64748B] mb-1.5">
                Institute Email
              </label>
              <input
                id="fl-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                placeholder="name@iitbhilai.ac.in"
                autoComplete="email"
                required
                className={`w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border text-xs text-[#0F172A] font-medium outline-none focus:bg-white focus:ring-2 transition-all ${
                  showDomainHint
                    ? 'border-[#FCA5A5] focus:border-[#DC2626] focus:ring-[#DC2626]/15'
                    : 'border-[#E2E8F0] focus:border-[#4F46E5] focus:ring-[#4F46E5]/15'
                }`}
              />
              {showDomainHint && (
                <p className="text-[11px] text-[#DC2626] mt-1">
                  Email must end with @iitbhilai.ac.in
                </p>
              )}
            </div>

            <div>
              <label htmlFor="fl-password" className="block text-[11px] font-medium text-[#64748B] mb-1.5">
                Password
              </label>
              <input
                id="fl-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5] focus:ring-2 focus:ring-[#4F46E5]/15 transition-all"
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="inline-flex items-center gap-2 text-[#475569] cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="rounded border-[#CBD5E1] text-[#4F46E5] focus:ring-[#4F46E5]"
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => setError('Contact Lab L-106 administrator (aksharma@iitbhilai.ac.in) for IIT Bhilai SSO reset.')}
                className="text-[#4F46E5] hover:text-[#4338CA] font-medium"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors"
            >
              {submitting ? 'Verifying @iitbhilai.ac.in...' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-[11px] text-[#94A3B8] leading-relaxed">
            Restricted strictly to verified @iitbhilai.ac.in accounts. Roles are enforced on the server.
          </p>

          {/* Verified @iitbhilai.ac.in Quick Access */}
          <div className="mt-5 pt-4 border-t border-[#F1F5F9] space-y-2">
            <div className="text-[11px] font-semibold text-[#64748B] flex items-center justify-between">
              <span>Demo Quick Sign-in</span>
              <span className="text-[10px] text-[#94A3B8] font-normal">One-click role access</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEmail('ganesh.k@iitbhilai.ac.in');
                  setPassword('demo');
                  completeLoginRequest('ganesh.k@iitbhilai.ac.in', 'demo');
                }}
                className="h-10 px-2 rounded-xl bg-[#F8FAFC] hover:bg-[#EEF2FF] border border-[#E2E8F0] text-[11px] font-semibold text-[#334155] hover:text-[#4F46E5] flex flex-col items-center justify-center text-center transition-colors"
                title="Student: Ganesh Kumar (M.Tech CSE)"
              >
                <span>Student</span>
                <span className="text-[9px] font-normal text-[#94A3B8]">@iitbhilai</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('aksharma@iitbhilai.ac.in');
                  setPassword('demo');
                  completeLoginRequest('aksharma@iitbhilai.ac.in', 'demo');
                }}
                className="h-10 px-2 rounded-xl bg-[#F8FAFC] hover:bg-[#EEF2FF] border border-[#E2E8F0] text-[11px] font-semibold text-[#334155] hover:text-[#4F46E5] flex flex-col items-center justify-center text-center transition-colors"
                title="Admin: Dr. A.K. Sharma (Coordinator)"
              >
                <span>Admin</span>
                <span className="text-[9px] font-normal text-[#94A3B8]">Coordinator</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('accessdesk.l106@iitbhilai.ac.in');
                  setPassword('demo');
                  completeLoginRequest('accessdesk.l106@iitbhilai.ac.in', 'demo');
                }}
                className="h-10 px-2 rounded-xl bg-[#F8FAFC] hover:bg-[#EEF2FF] border border-[#E2E8F0] text-[11px] font-semibold text-[#334155] hover:text-[#4F46E5] flex flex-col items-center justify-center text-center transition-colors"
                title="Gate Desk: Access Pass Verifier (Turnstile Scanner)"
              >
                <span>Gate Desk</span>
                <span className="text-[9px] font-normal text-[#94A3B8]">Pass Verifier</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
