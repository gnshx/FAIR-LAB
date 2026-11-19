// FairLab URL Route Definitions & Bidirectional History Synchronizer
// Supports clean URLs: /overview, /settings, /book, /dashboard, etc.

export const VIEW_TO_PATH = {
  // Student Workspace
  'student-dashboard': '/dashboard',
  'student-book': '/book',
  'student-bookings': '/bookings',
  'student-fairness': '/fairness',
  'student-notifications': '/notifications',

  // Admin Workspace
  'admin-overview': '/overview',
  'admin-allocation': '/allocation',
  'admin-schedule': '/schedule',
  'admin-workstations': '/workstations',
  'admin-students': '/students',
  'admin-analytics': '/analytics',
  'admin-access': '/access',
  'admin-settings': '/settings',
  'admin-audit': '/audit'
};

export const PATH_TO_ROUTE = {
  // Student Routes
  '/': { workspace: 'student', view: 'student-dashboard', path: '/dashboard' },
  '/dashboard': { workspace: 'student', view: 'student-dashboard', path: '/dashboard' },
  '/student': { workspace: 'student', view: 'student-dashboard', path: '/dashboard' },
  '/student/dashboard': { workspace: 'student', view: 'student-dashboard', path: '/dashboard' },
  '/book': { workspace: 'student', view: 'student-book', path: '/book' },
  '/booking': { workspace: 'student', view: 'student-book', path: '/book' },
  '/workstation': { workspace: 'student', view: 'student-book', path: '/book' },
  '/workstations-map': { workspace: 'student', view: 'student-book', path: '/book' },
  '/student/book': { workspace: 'student', view: 'student-book', path: '/book' },
  '/bookings': { workspace: 'student', view: 'student-bookings', path: '/bookings' },
  '/my-bookings': { workspace: 'student', view: 'student-bookings', path: '/bookings' },
  '/passes': { workspace: 'student', view: 'student-bookings', path: '/bookings' },
  '/student/bookings': { workspace: 'student', view: 'student-bookings', path: '/bookings' },
  '/fairness': { workspace: 'student', view: 'student-fairness', path: '/fairness' },
  '/fairness-score': { workspace: 'student', view: 'student-fairness', path: '/fairness' },
  '/student/fairness': { workspace: 'student', view: 'student-fairness', path: '/fairness' },
  '/notifications': { workspace: 'student', view: 'student-notifications', path: '/notifications' },
  '/student/notifications': { workspace: 'student', view: 'student-notifications', path: '/notifications' },

  // Admin Routes
  '/overview': { workspace: 'admin', view: 'admin-overview', path: '/overview' },
  '/admin': { workspace: 'admin', view: 'admin-overview', path: '/overview' },
  '/admin/overview': { workspace: 'admin', view: 'admin-overview', path: '/overview' },
  '/allocation': { workspace: 'admin', view: 'admin-allocation', path: '/allocation' },
  '/admin/allocation': { workspace: 'admin', view: 'admin-allocation', path: '/allocation' },
  '/schedule': { workspace: 'admin', view: 'admin-schedule', path: '/schedule' },
  '/tickets': { workspace: 'admin', view: 'admin-schedule', path: '/schedule' },
  '/admin/schedule': { workspace: 'admin', view: 'admin-schedule', path: '/schedule' },
  '/workstations': { workspace: 'admin', view: 'admin-workstations', path: '/workstations' },
  '/admin/workstations': { workspace: 'admin', view: 'admin-workstations', path: '/workstations' },
  '/students': { workspace: 'admin', view: 'admin-students', path: '/students' },
  '/admin/students': { workspace: 'admin', view: 'admin-students', path: '/students' },
  '/analytics': { workspace: 'admin', view: 'admin-analytics', path: '/analytics' },
  '/admin/analytics': { workspace: 'admin', view: 'admin-analytics', path: '/analytics' },
  '/access': { workspace: 'admin', view: 'admin-access', path: '/access' },
  '/gate': { workspace: 'admin', view: 'admin-access', path: '/access' },
  '/admin/access': { workspace: 'admin', view: 'admin-access', path: '/access' },
  '/settings': { workspace: 'admin', view: 'admin-settings', path: '/settings' },
  '/admin/settings': { workspace: 'admin', view: 'admin-settings', path: '/settings' },
  '/audit': { workspace: 'admin', view: 'admin-audit', path: '/audit' },
  '/audit-log': { workspace: 'admin', view: 'admin-audit', path: '/audit' },
  '/admin/audit': { workspace: 'admin', view: 'admin-audit', path: '/audit' }
};

export function resolveRoute(pathname, defaultWorkspace = 'student') {
  if (!pathname || pathname === '/') {
    if (defaultWorkspace === 'admin') {
      return PATH_TO_ROUTE['/overview'];
    }
    return PATH_TO_ROUTE['/dashboard'];
  }
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (PATH_TO_ROUTE[clean]) {
    return PATH_TO_ROUTE[clean];
  }
  const lower = clean.toLowerCase();
  if (PATH_TO_ROUTE[lower]) {
    return PATH_TO_ROUTE[lower];
  }
  return defaultWorkspace === 'admin' ? PATH_TO_ROUTE['/overview'] : PATH_TO_ROUTE['/dashboard'];
}
