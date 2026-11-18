const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');
const { getDb } = require('../db/database');

/**
 * Creates a cryptographically signed pass for an approved booking
 */
async function generateAccessPass(bookingIdOrOpts, userId, rollNo, machineId, slotName, timeSlotStr) {
  const db = getDb();
  const passId = `pass-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  let bId, uId, rNo, mId, sName, tSlot;
  if (typeof bookingIdOrOpts === 'object' && bookingIdOrOpts !== null) {
    bId = bookingIdOrOpts.bookingId;
    uId = bookingIdOrOpts.userId;
    rNo = bookingIdOrOpts.rollNo;
    mId = bookingIdOrOpts.machineId;
    sName = bookingIdOrOpts.slotName || bookingIdOrOpts.slotId || 'Standard Slot';
    tSlot = bookingIdOrOpts.timeSlotStr || `${bookingIdOrOpts.startTime || '14:00'} – ${bookingIdOrOpts.endTime || '16:00'}`;
  } else {
    bId = bookingIdOrOpts;
    uId = userId;
    rNo = rollNo;
    mId = machineId;
    sName = slotName;
    tSlot = timeSlotStr;
  }

  const payload = {
    bookingId: bId,
    userId: uId,
    rollNo: rNo,
    machineId: mId,
    lab: 'L-106',
    timeSlot: tSlot,
    issuedAt: new Date().toISOString()
  };

  const payloadString = JSON.stringify(payload);
  const tokenHash = crypto.createHmac('sha256', config.HMAC_SECRET).update(payloadString).digest('hex');
  const signedToken = `FAIRPASS:${bId}:${tokenHash.substring(0, 16)}`;

  // Default expiry: 4 hours from now
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

  // Opaque QR Code payload (zero personal data / PII per HLD Section 12)
  const qrData = {
    token: signedToken,
    bookingId: bId,
    hash: tokenHash.substring(0, 16)
  };

  const qrPayload = JSON.stringify(qrData);

  // Generate QR code Data URI
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'H',
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    },
    width: 256
  });

  // Save to DB
  db.prepare(`
    INSERT INTO access_passes (pass_id, booking_id, user_id, token_hash, signed_token, qr_payload, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'VALID')
  `).run(passId, bId, uId, tokenHash, signedToken, qrPayload, expiresAt);

  return {
    passId,
    signedToken,
    tokenHash,
    qrPayload,
    qrDataUrl,
    expiresAt,
    status: 'VALID'
  };
}

/**
 * Retrieves access pass by booking ID with rendered QR code
 */
async function getPassByBookingId(bookingId) {
  const db = getDb();
  const pass = db.prepare(`
    SELECT p.*, b.machine_id, b.slot_id, b.booking_date, b.duration_minutes, b.demand_level, b.status as booking_status,
           u.name as student_name, u.roll_no, u.department, u.avatar_url,
           COALESCE(s.slot_name, 'Custom Window') as slot_name,
           COALESCE(b.start_time, s.start_time) as start_time,
           COALESCE(b.end_time, s.end_time) as end_time,
           w.display_label, w.block_code, w.row_num, w.seat_num, w.gpu_model, w.vram_gb,
           br.compute_purpose
    FROM access_passes p
    JOIN bookings b ON p.booking_id = b.booking_id
    JOIN users u ON p.user_id = u.user_id
    LEFT JOIN lab_slots s ON b.slot_id = s.slot_id
    JOIN workstations w ON b.machine_id = w.machine_id
    LEFT JOIN booking_requests br ON b.request_id = br.request_id
    WHERE p.booking_id = ?
  `).get(bookingId);

  if (!pass) return null;

  const qrDataUrl = await QRCode.toDataURL(pass.qr_payload, {
    errorCorrectionLevel: 'H',
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    },
    width: 256
  });

  return {
    ...pass,
    qrDataUrl
  };
}

module.exports = {
  generateAccessPass,
  getPassByBookingId
};

