import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ currentView, setCurrentView, onSignOut }) {
  const { profile } = useAuth();
  const user = profile?.user;

  const overviewNav = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home' },
    { id: 'lab-seat-map', label: 'Lab Seat Map', icon: 'event_seat' },
    { id: 'student-booking-passes', label: 'Fairness & Pass', icon: 'donut_large' }
  ];

  const operationsNav = [
    { id: 'lab-allocation-realtime-queue', label: 'Allocation Queue', icon: 'format_list_numbered' },
    { id: 'watchman-guard-gate-verify', label: 'Gate Scanner', icon: 'qr_code_scanner' }
  ];

  const configNav = [
    { id: 'admin-fairness-analytics', label: 'Admin & Policy', icon: 'tune' }
  ];

  const renderSection = (title, items) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#98A2B3] px-3 mb-2">
        {title}
      </div>
      <nav className="space-y-1">
        {items.map(item => {
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left ${
                active
                  ? 'bg-[#F0EEFF] text-[#5B4CF5] font-semibold'
                  : 'text-[#344054] hover:bg-[#F7F8FC] hover:text-[#1D2939]'
              }`}
            >
              <span className={`material-symbols-outlined text-[19px] ${active ? 'text-[#5B4CF5]' : 'text-[#667085]'}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-60 bg-white border-r border-[#EAECF0] z-50 flex-col justify-between p-4 select-none">
      <div>
        {/* Brand Header (inspired by EazyBook sidebar brand block) */}
        <button
          type="button"
          onClick={() => setCurrentView('dashboard')}
          className="flex items-center gap-2.5 px-2 pt-1 pb-6 w-full text-left"
        >
          <div className="w-9 h-9 rounded-xl bg-[#5B4CF5] text-white flex items-center justify-center shadow-brand shrink-0">
            <span className="material-symbols-outlined text-[20px]">balance</span>
          </div>
          <div>
            <span className="font-display font-bold text-[15px] text-[#1D2939] block leading-tight">
              FairLab
            </span>
            <span className="text-[11px] text-[#667085] block leading-tight mt-0.5">
              IIT Bhilai · L-106
            </span>
          </div>
        </button>

        <div className="space-y-6">
          {renderSection('Overview', overviewNav)}
          {renderSection('Lab Operations', operationsNav)}
          {renderSection('Configuration', configNav)}
        </div>
      </div>

      {/* Bottom Account + Sign Out */}
      <div className="pt-4 border-t border-[#EAECF0] space-y-2">
        <div className="px-3 py-2 rounded-xl bg-[#F7F8FC] border border-[#EAECF0]">
          <div className="text-xs font-semibold text-[#1D2939] truncate">{user?.name || 'NDS Ganesh'}</div>
          <div className="text-[11px] font-mono text-[#667085] capitalize mt-0.5">
            {user?.role || 'student'} · {user?.roll_no || 'BT23CSE001'}
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium text-[#475467] hover:bg-[#F7F8FC] hover:text-[#1D2939] transition-colors"
        >
          <span className="material-symbols-outlined text-[18px] text-[#667085]">logout</span>
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  );
}
