import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const STUDENT_NAV = [
  { id: 'student-dashboard', label: 'Dashboard' },
  { id: 'student-book', label: 'Book workstation' },
  { id: 'student-bookings', label: 'My bookings' },
  { id: 'student-fairness', label: 'Fairness score' },
  { id: 'student-notifications', label: 'Notifications' }
];

export const ADMIN_NAV = [
  { id: 'admin-overview', label: 'Overview' },
  { id: 'admin-allocation', label: 'Allocation' },
  { id: 'admin-schedule', label: 'Schedule & tickets' },
  { id: 'admin-workstations', label: 'Workstations' },
  { id: 'admin-students', label: 'Students' },
  { id: 'admin-analytics', label: 'Analytics' },
  { id: 'admin-access', label: 'Access control' },
  { id: 'admin-settings', label: 'Settings' },
  { id: 'admin-audit', label: 'Audit log' }
];

export default function Sidebar({ workspace, currentView, setCurrentView, onSwitchWorkspace, onSignOut }) {
  const { profile, availableUsers, switchUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const user = profile?.user;
  const isAdminWorkspace = workspace === 'admin';
  const navItems = isAdminWorkspace ? ADMIN_NAV : STUDENT_NAV;

  const displayName = isAdminWorkspace
    ? (user?.role === 'admin' ? user.name : 'Lab Admin')
    : (user?.name || 'Ganesh Kumar');

  const displaySub = isAdminWorkspace
    ? 'L-106 · Admin'
    : `Student · ${(user?.department || 'CSE').split(' ')[0] === 'Computer' ? 'CSE' : (user?.department || 'CSE')}`;

  const initial = (isAdminWorkspace ? 'A' : (displayName || 'S').charAt(0)).toUpperCase();

  const handleSelectPersona = async (u) => {
    await switchUser(u.user_id);
    setMenuOpen(false);
    if (u.role === 'admin') {
      const perms = Array.isArray(u.permissions) ? u.permissions : [];
      const onlyAccessOp = perms.includes('ACCESS_OPERATOR') && !perms.includes('POLICY_ADMIN');
      onSwitchWorkspace('admin', onlyAccessOp ? 'admin-access' : 'admin-overview');
    } else {
      onSwitchWorkspace('student', 'student-dashboard');
    }
  };

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-60 bg-[#0B1120] text-white z-50 flex-col justify-between px-4 py-5 select-none">
      <div>
        {/* Brand Lockup (Exact Figma Match) */}
        <button
          type="button"
          onClick={() => setCurrentView(isAdminWorkspace ? 'admin-overview' : 'student-dashboard')}
          className="flex items-center gap-2.5 px-1.5 mb-7 w-full text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-[#4F46E5] text-white font-bold text-sm flex items-center justify-center shrink-0">
            F
          </div>
          <span className="font-bold text-[17px] tracking-tight text-white">FairLab</span>
        </button>

        {/* Workspace Section Header */}
        <div className="px-2 mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
          {isAdminWorkspace ? 'Admin Workspace' : 'Student Workspace'}
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          {navItems.map(item => {
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentView(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] transition-colors text-left ${
                  active
                    ? 'bg-[#172036] text-white font-semibold'
                    : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04] font-medium'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    active ? 'bg-[#6366F1]' : 'bg-[#475569]'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile Card + Persona/Workspace Switcher Popover */}
      <div className="relative">
        {menuOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl bg-[#131B2E] border border-[#1E293B] shadow-xl p-2 z-50">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
              Switch Workspace / Account
            </div>

            <div className="space-y-0.5 max-h-52 overflow-y-auto">
              {availableUsers.map(u => {
                const selected = u.user_id === user?.user_id;
                return (
                  <button
                    key={u.user_id}
                    type="button"
                    onClick={() => handleSelectPersona(u)}
                    className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between text-left text-xs transition-colors ${
                      selected
                        ? 'bg-[#1E2A47] text-white font-semibold'
                        : 'text-[#CBD5E1] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{u.name}</div>
                      <div className="text-[10px] text-[#64748B] capitalize">{u.role}</div>
                    </div>
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-[#1E293B] space-y-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (isAdminWorkspace) {
                    const student = availableUsers.find(u => u.role === 'student');
                    if (student) switchUser(student.user_id);
                    onSwitchWorkspace('student', 'student-dashboard');
                  } else {
                    const admin = availableUsers.find(u => u.role === 'admin');
                    if (admin) switchUser(admin.user_id);
                    onSwitchWorkspace('admin', 'admin-overview');
                  }
                }}
                className="w-full px-2.5 py-2 rounded-xl text-left text-xs font-medium text-[#A5B4FC] hover:bg-white/[0.05] flex items-center justify-between"
              >
                <span>{isAdminWorkspace ? 'Switch to Student View' : 'Switch to Admin View'}</span>
                <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                className="w-full px-2.5 py-2 rounded-xl text-left text-xs font-medium text-[#FCA5A5] hover:bg-white/[0.05] flex items-center justify-between"
              >
                <span>Sign out</span>
                <span className="material-symbols-outlined text-[15px]">logout</span>
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          className="w-full p-2.5 rounded-xl bg-[#131B2E] hover:bg-[#19243D] border border-[#1E293B] flex items-center gap-3 text-left transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-[#818CF8] text-white font-semibold text-xs flex items-center justify-center shrink-0">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-white truncate leading-tight">
              {displayName}
            </div>
            <div className="text-[11px] text-[#64748B] truncate leading-tight mt-0.5">
              {displaySub}
            </div>
          </div>
          <span className="material-symbols-outlined text-[16px] text-[#64748B]">unfold_more</span>
        </button>
      </div>
    </aside>
  );
}
