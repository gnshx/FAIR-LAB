import React, { useState } from 'react';
import { useAuth, CANONICAL_DEMO_USERS, isGateDeskUser } from '../context/AuthContext';

export const STUDENT_NAV = [
  { id: 'student-dashboard', label: 'Dashboard' },
  { id: 'student-book', label: 'Book workstation' },
  { id: 'student-bookings', label: 'My bookings' },
  { id: 'student-fairness', label: 'Fairness score' },
  { id: 'student-notifications', label: 'Notifications' }
];

export const GATE_NAV = [
  { id: 'admin-access', label: 'Access control (Scanner)' }
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
  const isGateOp = isGateDeskUser(user);

  const isGateWorkspace = workspace === 'gate' || isGateOp;
  const isAdminWorkspace = workspace === 'admin' && !isGateWorkspace;

  let navItems = STUDENT_NAV;
  let workspaceLabel = 'Student Workspace';
  let displaySub = `Student · ${(user?.department || 'CSE').split(' ')[0] === 'Computer' ? 'CSE' : (user?.department || 'CSE')}`;
  let badgeColor = 'bg-[#4F46E5]';

  if (isGateWorkspace || isGateOp) {
    navItems = GATE_NAV;
    workspaceLabel = 'Gate Desk (Pass Verifier)';
    displaySub = 'Gate Operator · Lab L-106';
    badgeColor = 'bg-[#10B981]';
  } else if (isAdminWorkspace) {
    navItems = ADMIN_NAV;
    workspaceLabel = 'Admin Workspace';
    displaySub = 'L-106 · Faculty Coordinator';
    badgeColor = 'bg-[#4F46E5]';
  }

  const displayName = user?.name || (isGateWorkspace || isGateOp ? 'Ram Singh (Gate Desk)' : (isAdminWorkspace ? 'Dr. A. K. Sharma' : 'NDS Ganesh'));
  const initial = (isGateWorkspace || isGateOp ? 'R' : (displayName.charAt(0) || 'U')).toUpperCase();

  const userList = (availableUsers && availableUsers.length > 0) ? availableUsers : CANONICAL_DEMO_USERS;

  const handleSelectPersona = async (u) => {
    setMenuOpen(false);
    await switchUser(u.user_id);
    const uIsGate = isGateDeskUser(u);

    if (uIsGate) {
      onSwitchWorkspace('gate', 'admin-access');
    } else if (u.role === 'admin') {
      onSwitchWorkspace('admin', 'admin-overview');
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
          onClick={() => setCurrentView(isGateWorkspace ? 'admin-access' : (isAdminWorkspace ? 'admin-overview' : 'student-dashboard'))}
          className="flex items-center gap-2.5 px-1.5 mb-7 w-full text-left"
        >
          <div className={`w-8 h-8 rounded-lg ${badgeColor} text-white font-bold text-sm flex items-center justify-center shrink-0`}>
            {isGateWorkspace ? 'G' : 'F'}
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-[17px] tracking-tight text-white leading-tight">FairLab</span>
            {isGateWorkspace && (
              <span className="text-[10px] text-[#34D399] font-medium tracking-tight">Turnstile Access</span>
            )}
          </div>
        </button>

        {/* Workspace Section Header */}
        <div className="px-2 mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
          {workspaceLabel}
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
                    active ? (isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#6366F1]') : 'bg-[#475569]'
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
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl bg-[#131B2E] border border-[#1E293B] shadow-2xl p-2.5 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
              Switch Workspace / Account
            </div>

            <div className="space-y-1 my-1 max-h-56 overflow-y-auto">              {userList.map(u => {
                const selected = u.user_id === user?.user_id || u.email === user?.email;
                const uIsGate = isGateDeskUser(u);

                let roleBadge = 'Student';
                let roleColor = 'text-[#94A3B8]';
                if (uIsGate) {
                  roleBadge = 'Gate Desk (Pass Verifier)';
                  roleColor = 'text-[#34D399] font-medium';
                } else if (u.role === 'admin') {
                  roleBadge = 'Admin (Coordinator)';
                  roleColor = 'text-[#A5B4FC] font-medium';
                }

                return (
                  <button
                    key={u.user_id || u.email}
                    type="button"
                    onClick={() => handleSelectPersona(u)}
                    className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between text-left text-xs transition-colors ${
                      selected
                        ? 'bg-[#1E2A47] text-white font-semibold'
                        : 'text-[#CBD5E1] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-white font-medium">{u.name}</div>
                      <div className={`text-[10px] ${roleColor}`}>{roleBadge}</div>
                    </div>
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-[#1E293B] space-y-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  const student = userList.find(u => u.role === 'student') || CANONICAL_DEMO_USERS[0];
                  handleSelectPersona(student);
                }}
                className={`w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium flex items-center justify-between transition-colors ${
                  !isAdminWorkspace && !isGateWorkspace
                    ? 'bg-[#1E2A47] text-white'
                    : 'text-[#CBD5E1] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[15px] text-[#818CF8]">school</span>
                  <span>Student View</span>
                </div>
                {!isAdminWorkspace && !isGateWorkspace && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  const admin = userList.find(u => u.role === 'admin' && !isGateDeskUser(u)) || CANONICAL_DEMO_USERS[1];
                  handleSelectPersona(admin);
                }}
                className={`w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium flex items-center justify-between transition-colors ${
                  isAdminWorkspace
                    ? 'bg-[#1E2A47] text-white'
                    : 'text-[#CBD5E1] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[15px] text-[#A5B4FC]">shield_person</span>
                  <span>Admin View</span>
                </div>
                {isAdminWorkspace && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  const gate = userList.find(isGateDeskUser) || CANONICAL_DEMO_USERS[2];
                  handleSelectPersona(gate);
                }}
                className={`w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium flex items-center justify-between transition-colors ${
                  isGateWorkspace
                    ? 'bg-[#1E2A47] text-white'
                    : 'text-[#34D399] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[15px] text-[#34D399]">qr_code_scanner</span>
                  <span>Gate Verifier (Scanner)</span>
                </div>
                {isGateWorkspace && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                className="w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium text-[#FCA5A5] hover:bg-white/[0.05] flex items-center justify-between transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[15px]">logout</span>
                  <span>Sign out</span>
                </div>
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          className="w-full p-2.5 rounded-xl bg-[#131B2E] hover:bg-[#19243D] border border-[#1E293B] flex items-center gap-3 text-left transition-colors"
        >
          <div className={`w-8 h-8 rounded-full ${isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#818CF8]'} text-white font-semibold text-xs flex items-center justify-center shrink-0`}>
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-white truncate leading-tight">
              {displayName}
            </div>
            <div className="text-[11px] text-[#94A3B8] truncate leading-tight mt-0.5">
              {displaySub}
            </div>
          </div>
          <span className="material-symbols-outlined text-[16px] text-[#64748B]">unfold_more</span>
        </button>
      </div>
    </aside>
  );
}
