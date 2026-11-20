import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function Header({ currentView, setCurrentView }) {
  const { profile, availableUsers, switchUser } = useAuth();
  const { connected } = useSocket();
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const user = profile?.user;
  const fairness = profile?.fairness;
  const score = fairness ? fairness.current_score : 100;

  const navItems = [
    { id: 'lab-seat-map', label: 'Lab Seat Map', icon: 'event_seat' },
    { id: 'student-booking-passes', label: 'My Pass & Score', icon: 'confirmation_number' },
    { id: 'lab-allocation-realtime-queue', label: 'Fairness Queue', icon: 'table_chart' },
    { id: 'watchman-guard-gate-verify', label: 'Gate Turnstile', icon: 'sensor_door' },
    { id: 'admin-fairness-analytics', label: 'Policy & Schedule', icon: 'tune' }
  ];

  return (
    <header className="fixed top-0 left-0 right-0 h-16 z-50 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800 flex items-center justify-between px-6">
      {/* Brand & Institution */}
      <div className="flex items-center gap-6">
        <div
          className="flex items-center gap-3 cursor-pointer select-none group"
          onClick={() => setCurrentView('lab-seat-map')}
        >
          <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-emerald-400 group-hover:border-emerald-500/50 transition-colors">
            <span className="material-symbols-outlined text-[18px]">balance</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-sans font-bold text-zinc-100 tracking-tight text-base leading-none">FairLab</span>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">IIT Bhilai</span>
            </div>
            <div className="text-[11px] font-mono text-zinc-400 leading-none mt-1">
              Lab L-106 · 84 Systems
            </div>
          </div>
        </div>

        <div className="hidden 2xl:flex items-center gap-2 pl-6 border-l border-zinc-800 text-xs font-mono">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          <span className="text-zinc-300">Block A (60) + Block B (24)</span>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="hidden xl:flex items-center gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
        {navItems.map(item => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentView(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <span className={`material-symbols-outlined text-[16px] ${isActive ? 'text-emerald-400' : ''}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User Actions & Priority Score */}
      <div className="flex items-center gap-3">
        {user?.role === 'student' && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-xs tabular-nums">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-semibold text-emerald-400">{score} pts</span>
            <span className="text-zinc-500">({fairness?.total_hours_used ?? 0}h)</span>
          </div>
        )}

        {/* User Persona Switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:border-zinc-700 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300">
              <span className="material-symbols-outlined text-[16px]">person</span>
            </div>
            <div className="hidden md:flex flex-col">
              <span className="text-xs font-medium text-zinc-200 leading-tight">{user?.name || 'NDS Ganesh'}</span>
              <span className="text-[10px] font-mono text-zinc-400 capitalize">{user?.role || 'student'} · {user?.roll_no || ''}</span>
            </div>
            <span className="material-symbols-outlined text-zinc-400 text-[16px]">expand_more</span>
          </button>

          {showUserDropdown && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl p-1.5 z-50 text-left">
              <div className="px-3 py-2 border-b border-zinc-800 mb-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">Switch Account Persona</p>
                <p className="text-xs text-zinc-500 mt-0.5">Test student, watchman, and admin views</p>
              </div>

              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {availableUsers.map(u => {
                  const isCurrent = u.user_id === user?.user_id;
                  return (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => {
                        switchUser(u.user_id);
                        setShowUserDropdown(false);
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between text-xs transition-colors ${
                        isCurrent ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="truncate">
                        <div className="truncate font-medium text-zinc-200">{u.name}</div>
                        <div className="text-[10px] font-mono text-zinc-400 capitalize">{u.role} · {u.roll_no}</div>
                      </div>
                      {u.role === 'student' && (
                        <span className="font-mono text-emerald-400 font-semibold text-[11px] tabular-nums shrink-0 ml-2">
                          {u.current_score != null ? u.current_score : 100} pts
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
