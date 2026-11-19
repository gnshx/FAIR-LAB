const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { validateBody, z } = require('../middleware/validation');
const {
  signAuthToken,
  setSessionCookie,
  clearSessionCookie,
  resolveAuthenticatedUser,
  parsePermissions,
  createRateLimiter,
  isAllowedLoginPassword
} = require('../middleware/auth');

const ALLOWED_EMAIL_DOMAIN = '@iitbhilai.ac.in';
const IIT_BHILAI_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@iitbhilai\.ac\.in$/i;

function isValidIITBhilaiEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (/[\r\n\s]/.test(trimmed)) return false;
  return IIT_BHILAI_EMAIL_REGEX.test(trimmed);
}

const loginRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 });

const loginSchema = z.object({
  email: z.string().trim().min(3, 'Institute email is required').max(254, 'Email is too long'),
  password: z.string().min(1, 'Password is required').max(128, 'Password is too long')
});

// Strict IIT Bhilai institute login (@iitbhilai.ac.in ONLY) -> issues verified HS256 JWT + HttpOnly session cookie
router.post('/login', loginRateLimiter, validateBody(loginSchema), (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const rawPassword = req.body.password;

  if (!isValidIITBhilaiEmail(email)) {
    return res.status(403).json({
      error: `Only official IIT Bhilai email accounts ending with ${ALLOWED_EMAIL_DOMAIN} are allowed to sign in.`,
      code: 'INVALID_EMAIL_DOMAIN'
    });
  }

  const db = getDb();
  const user = db.prepare(`
    SELECT user_id, name, roll_no, email, role, permissions, department, password_hash
    FROM users
    WHERE LOWER(email) = ?
    LIMIT 1
  `).get(email);

  if (!user) {
    return res.status(401).json({
      error: 'No registered FairLab account found for this @iitbhilai.ac.in email.',
      code: 'ACCOUNT_NOT_FOUND'
    });
  }

  if (!isValidIITBhilaiEmail(user.email)) {
    return res.status(403).json({
      error: `Account email does not belong to ${ALLOWED_EMAIL_DOMAIN}.`,
      code: 'INVALID_EMAIL_DOMAIN'
    });
  }

  // Constant-time cryptographic verification of student/faculty/admin password
  if (!isAllowedLoginPassword(rawPassword, user.password_hash)) {
    return res.status(401).json({
      error: 'Invalid password. Please verify your @iitbhilai.ac.in credentials.',
      code: 'INVALID_CREDENTIALS'
    });
  }

  const { password_hash, ...safeUserData } = user;
  const normalizedUser = {
    ...safeUserData,
    permissions: parsePermissions(user.permissions)
  };
  const token = signAuthToken(normalizedUser);
  setSessionCookie(res, token);

  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  let fairness = null;
  if (activeSem) {
    fairness = db
      .prepare('SELECT * FROM student_fairness WHERE user_id = ? AND semester_id = ?')
      .get(user.user_id, activeSem.semester_id);
  }

  return res.json({
    success: true,
    token,
    user: normalizedUser,
    fairness: fairness || { current_score: 100, booking_count: 0, penalty_points: 0 }
  });
});

// Clear HttpOnly session cookie on logout
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// List demo personas for dev/demo role switching (strictly @iitbhilai.ac.in, disabled in production)
router.get('/users', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Demo user directory is disabled in production.' });
  }
  const db = getDb();
  const users = db.prepare(`
    SELECT u.user_id, u.name, u.roll_no, u.email, u.role, u.permissions, u.department,
           sf.current_score, sf.booking_count, sf.total_hours_used, sf.high_demand_count, sf.high_demand_hours, sf.penalty_points
    FROM users u
    LEFT JOIN semesters s ON s.status = 'active'
    LEFT JOIN student_fairness sf ON (u.user_id = sf.user_id AND sf.semester_id = s.semester_id)
    WHERE LOWER(u.email) LIKE '%@iitbhilai.ac.in'
      AND u.user_id NOT LIKE 'usr-cohort-%'
      AND u.user_id NOT LIKE 'usr-e2e-%'
      AND u.user_id NOT LIKE 'usr-conc-%'
      AND u.user_id NOT LIKE 'usr-test-%'
      AND u.user_id NOT LIKE 'usr-audit-%'
    ORDER BY u.role, u.name
  `).all().map(u => ({ ...u, permissions: parsePermissions(u.permissions) }));
  res.json(users);
});

// Get authenticated user profile details (derives identity from verified JWT / session cookie)
router.get('/me', (req, res) => {
  const authed = resolveAuthenticatedUser(req, process.env.NODE_ENV !== 'production' ? 'usr-student-ganesh' : null);
  if (!authed) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const activeSem = db.prepare("SELECT * FROM semesters WHERE status = 'active' LIMIT 1").get();
  let fairness = null;
  if (activeSem) {
    fairness = db
      .prepare('SELECT * FROM student_fairness WHERE user_id = ? AND semester_id = ?')
      .get(authed.user_id, activeSem.semester_id);
  }

  const activeBooking = db.prepare(`
    SELECT b.*, p.pass_id, p.signed_token, p.token_hash,
           COALESCE(s.slot_name, 'Custom Window') as slot_name,
           COALESCE(b.start_time, s.start_time) as start_time,
           COALESCE(b.end_time, s.end_time) as end_time,
           w.display_label, w.gpu_model, w.vram_gb, br.compute_purpose
    FROM bookings b
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    JOIN workstations w ON b.machine_id = w.machine_id
    LEFT JOIN access_passes p ON b.booking_id = p.booking_id
    LEFT JOIN booking_requests br ON b.request_id = br.request_id
    WHERE b.user_id = ? AND b.status IN ('CONFIRMED', 'CHECKED_IN')
    ORDER BY b.booked_at DESC LIMIT 1
  `).get(authed.user_id);

  res.json({
    user: authed,
    activeSemester: activeSem,
    fairness: fairness || { current_score: 100, booking_count: 0, penalty_points: 0 },
    activeBooking: activeBooking || null
  });
});

const switchUserSchema = z.object({
  userId: z.string().min(1)
});

// Development/demo-only persona switcher (strictly disabled in NODE_ENV=production)
router.post('/switch-user', validateBody(switchUserSchema), (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Account switching is strictly disabled in production mode.'
    });
  }
  const db = getDb();
  const user = db.prepare(
    'SELECT user_id, name, roll_no, email, role, permissions, department FROM users WHERE user_id = ?'
  ).get(req.body.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!isValidIITBhilaiEmail(user.email)) {
    return res.status(403).json({
      error: `Only ${ALLOWED_EMAIL_DOMAIN} accounts are permitted.`
    });
  }
  const normalizedUser = { ...user, permissions: parsePermissions(user.permissions) };
  const token = signAuthToken(normalizedUser);
  setSessionCookie(res, token);
  res.json({ success: true, token, user: normalizedUser });
});

module.exports = router;
module.exports.isValidIITBhilaiEmail = isValidIITBhilaiEmail;
