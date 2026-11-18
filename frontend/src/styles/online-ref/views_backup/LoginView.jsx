import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginView({ onSignedIn }) {
  const { availableUsers, switchUser } = useAuth();
  const [email, setEmail] = useState('ganesh.k@iitbhilai.ac.in');
  const [password, setPassword] = useState('••••••••••••');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const matched = availableUsers.find(
      u => u.email?.toLowerCase() === email.trim().toLowerCase()
    );
    if (matched) {
      switchUser(matched.user_id);
      onSignedIn();
    } else if (availableUsers.length > 0) {
      switchUser(availableUsers[0].user_id);
      onSignedIn();
    } else {
      setError('Account not found. Use one of the quick portal accounts below.');
    }
  };

  const quickLogin = (userId) => {
    switchUser(userId);
    onSignedIn();
  };

  const demoPersonas = [
    { id: 'usr-student-ganesh', label: 'Student Portal', name: 'Ganesh Kumar', tag: '90 pts' },
    { id: 'usr-admin-sharma', label: 'Admin Portal', name: 'Dr. A. K. Sharma', tag: 'Admin' },
    { id: 'usr-watchman-ram', label: 'Gate Turnstile', name: 'Guard Ram Singh', tag: 'Gate' }
  ];

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-[#F8F9FC]">
      {/* Left Panel — Oxford Academic Navy Hero (inspired by design/loginpage-colors and uiux.png) */}
      <div className="login-hero-bg relative overflow-hidden flex flex-col justify-center px-10 py-14 lg:px-20 text-white">
        {/* Subtle decorative architectural arcs */}
        <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full border border-white/[0.06]" />
        <div className="pointer-events-none absolute -bottom-32 right-8 w-[420px] h-[420px] rounded-full border border-white/[0.05]" />

        <div className="relative z-10 max-w-md">
          <div className="flex items-center gap-3 mb-9">
            <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px] text-white">school</span>
            </div>
            <div>
              <span className="font-display font-semibold text-base tracking-tight block leading-none">
                FairLab
              </span>
              <span className="text-xs text-[#9FB2D9] font-normal">IIT Bhilai · Lab L-106</span>
            </div>
          </div>

          <h1 className="font-serif text-4xl lg:text-[42px] font-semibold leading-[1.15] tracking-tight text-white">
            Your campus lab, fair for everyone.
          </h1>

          <p className="mt-5 text-[15px] leading-relaxed text-[#B6C4E2]">
            Explore 84 workstations across Block A and Block B, request custom time intervals, and receive equitable priority allocations — all within one portal.
          </p>

          <ul className="mt-9 space-y-3.5 text-sm text-[#D2DCF0]">
            <li className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[18px] text-[#7DA4F2]">event_seat</span>
              <span>84 physical workstations mapped across Block A &amp; B</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[18px] text-[#7DA4F2]">balance</span>
              <span>Duration &amp; high-demand fairness priority engine</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[18px] text-[#7DA4F2]">verified_user</span>
              <span>Cryptographically signed single-use QR gate passes</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Right Panel — Clean Academic Sign-In Form */}
      <div className="flex flex-col items-center justify-center px-6 py-12 sm:px-12 bg-[#F8F9FC]">
        <div className="w-full max-w-[380px]">
          <h2 className="font-serif text-3xl font-bold text-[#101828] tracking-tight">
            Welcome back
          </h2>
          <p className="text-sm text-[#667085] mt-1.5">
            Sign in to your IIT Bhilai Lab L-106 portal
          </p>

          {error && (
            <div className="mt-5 p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#344054] mb-1.5">
                Institute Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@iitbhilai.ac.in"
                required
                className="w-full h-11 px-3.5 rounded-xl bg-white border border-[#D0D5DD] text-sm text-[#1D2939] placeholder:text-[#98A2B3] focus:border-[#244696] focus:ring-2 focus:ring-[#244696]/15 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#344054] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full h-11 px-3.5 pr-10 rounded-xl bg-white border border-[#D0D5DD] text-sm text-[#1D2939] focus:border-[#244696] focus:ring-2 focus:ring-[#244696]/15 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#667085] hover:text-[#344054]"
                  aria-label="Toggle password visibility"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-11 rounded-full bg-[#244696] hover:bg-[#1B377A] text-white font-medium text-sm transition-colors shadow-sm mt-2"
            >
              Sign in
            </button>
          </form>

          {/* Instant Demo Role Access */}
          <div className="mt-8 pt-6 border-t border-[#EAECF0]">
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#667085] mb-3">
              Quick Portal Access (Demo Accounts)
            </p>
            <div className="space-y-2">
              {demoPersonas.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => quickLogin(p.id)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white hover:bg-[#F4F2FF] border border-[#EAECF0] hover:border-[#D4C5FF] flex items-center justify-between text-left transition-all"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#1D2939]">{p.name}</div>
                    <div className="text-[11px] text-[#667085]">{p.label}</div>
                  </div>
                  <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F4F2FF] text-[#5B4CF5]">
                    {p.tag}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

