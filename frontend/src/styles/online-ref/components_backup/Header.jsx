import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function Header({ currentView, setCurrentView, onSignOut }) {
  const { profile, availableUsers, switchUser } = useAuth();
  const { connected } = useSocket();
  const [showDropdown, setShowDropdown] = useState(false);

  const user = profile?.user;
  const fairness = profile?.fairness;
  const score = fairness ? fairness.current_score : 100;
  const initial = (user?.name || 'G').charAt(0).toUpperCase();

  return (
    <header className="fixed top-0 left-0 lg:left-60 right-0 h-16 z-40 bg-white/95 backdrop-blur-md border-b border-[#EAECF0] flex items-center justify-between px-5 lg:px-8">
      {/* Left: Lab Branch Selector Pill (inspired by EazyBook header) */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCurrentView('lab-seat-map')}
          className="h-9 px-3.5 rounded-xl bg-[#F7F8FC] hover:bg-[#F0EEFF] border border-[#EAECF0] flex items-center gap-2 text-xs font-medium text-[#1D2939] transition-colors"
        >
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#5B4CF5]' : 'bg-[#98A2B3]'}`} />
          <span>Lab L-106 · 84 Systems</span>
          <span className="text-[#98A2B3] font-mono hidden sm:inline">09:00–18:00</span>
        </button>
      </div>

      {/* Right: Fairness Pill + Persona Switcher */}
      <div className="flex items-center gap-3">
        {user?.role === 'student' && (
          <button
            type="button"
            onClick={() => setCurrentView('student-booking-passes')}
            className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl bg-[#F4F2FF] border border-[#E4DDFF] text-xs font-mono tabular-nums text-[#4F22F2] font-semibold hover:bg-[#EAE6FF] transition-colors"
          >
            <span>{score} pts</span>
            <span className="text-[#9E82FF] font-normal">· {fairness?.total_hours_used ?? 0}h used</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setCurrentView('lab-allocation-realtime-queue')}
          className="w-9 h-9 rounded-xl bg-[#F7F8FC] hover:bg-[#F0EEFF] border border-[#EAECF0] flex items-center justify-center text-[#475467] hover:text-[#5B4CF5] transition-colors"
          title="Allocation Queue"
          aria-label="Open Fairness Queue"
        >
          <span className="material-symbols-outlined text-[19px]">notifications</span>
        </button>

        {/* User Avatar Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDropdown(v => !v)}
            className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-[#F7F8FC] hover:bg-[#F0EEFF] border border-[#EAECF0] transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-[#5B4CF5] text-white font-semibold text-xs flex items-center justify-center">
              {initial}
            </div>
            <span className="hidden md:inline text-xs font-medium text-[#1D2939] max-w-[120px] truncate">
              {user?.name || 'NDS Ganesh'}
            </span>
            <span className="material-symbols-outlined text-[16px] text-[#667085]">expand_more</span>
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white border border-[#EAECF0] shadow-card-hover p-2 z-50 text-left">
              <div className="px-3 py-2 border-b border-[#EAECF0] mb-1.5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-[#667085] font-semibold">
                  Switch Account Persona
                </p>
                <p className="text-xs text-[#667085] mt-0.5">
                  Signed in as <strong className="text-[#1D2939]">{user?.role}</strong>
                </p>
              </div>

              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {availableUsers.map(u => {
                  const isCurrent = u.user_id === user?.user_id;
                  return (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => {
                        switchUser(u.user_id);
                        setShowDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-xl flex items-center justify-between text-xs transition-colors ${
                        isCurrent
                          ? 'bg-[#F4F2FF] text-[#4F22F2] font-semibold'
                          : 'text-[#344054] hover:bg-[#F7F8FC]'
                      }`}
                    >
                      <div className="truncate">
                        <div className="truncate font-medium">{u.name}</div>
                        <div className="text-[11px] font-mono text-[#667085] capitalize">
                          {u.role} · {u.roll_no}
                        </div>
                      </div>
                      {u.role === 'student' && (
                        <span className="font-mono text-[#5B4CF5] font-semibold text-[11px] tabular-nums shrink-0 ml-2">
                          {u.current_score != null ? u.current_score : 100} pts
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-1.5 pt-1.5 border-t border-[#EAECF0]">
                <button
                  type="button"
                  onClick={() => {
                    setShowDropdown(false);
                    onSignOut && onSignOut();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2] flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">logout</span>
                  <span>Sign Out to Login Screen</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
