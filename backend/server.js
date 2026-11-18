const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { getDb } = require('./db/database');
const { seedDatabase, getTodayDateString } = require('./db/seed');
const {
  getLabAvailability,
  getWorkstationAvailability,
  getStateVersion
} = require('./services/availabilityService');
const {
  submitHybridBookingRequest,
  cancelBookingRequest
} = require('./services/bookingService');
const { validateBody, z } = require('./middleware/validation');
const { requireUser, createRateLimiter } = require('./middleware/auth');

// Route imports
const authRoutes = require('./routes/auth');
const labRoutes = require('./routes/labs');
const bookingRoutes = require('./routes/bookings');
const accessRoutes = require('./routes/access');
const fairnessRoutes = require('./routes/fairness');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'idempotency-key']
}));

// Cap JSON body size to prevent DoS / oversized payload crashes
app.use(express.json({ limit: '64kb' }));

// Clean 400 response for malformed JSON syntax instead of crashing to 500
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Malformed JSON request body' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload exceeds 64KB limit' });
  }
  next(err);
});

// Initialize Database & Seed
const db = getDb();
seedDatabase();

// WebSocket Setup with monotonic state version to prevent stale UI updates
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    version: getStateVersion(),
    message: 'FairLab Real-Time Allocation Socket Active'
  }));

  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(type, payload) {
  const data = JSON.stringify({
    type,
    payload,
    version: getStateVersion(),
    timestamp: new Date().toISOString()
  });
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

app.set('wssBroadcast', broadcast);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lab: 'IIT Bhilai L-106',
    system: 'FairLab Workstation Booking & Fairness System',
    workstations: 84,
    version: getStateVersion(),
    clientsConnected: clients.size,
    time: new Date().toISOString()
  });
});

// Per-user rate limiter for booking request submission (45 requests / 60s per user)
const bookingRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 45 });

const hybridRequestSchema = z.object({
  labId: z.string().optional(),
  slotId: z.string().optional().nullable(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'bookingDate must be YYYY-MM-DD').optional(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  preferredMachineId: z.string().optional().nullable(),
  preferredWorkstations: z.array(z.string()).max(3, 'At most 3 preferred workstations allowed').optional().nullable(),
  computePurpose: z.string().min(3, 'Purpose must be at least 3 characters').max(300).default('Academic Lab Work'),
  researchField: z.string().min(2).max(100).default('Computer Science'),
  allocationMode: z.enum(['AUTO', 'SCHEDULED']).default('AUTO'),
  idempotencyKey: z.string().max(128).optional().nullable()
});

// Unified API Router mounted at both /api and /api/v1 (HLD Section 9)
const apiRouter = express.Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/labs', labRoutes);
apiRouter.use('/bookings', bookingRoutes);
apiRouter.use('/access', accessRoutes);
apiRouter.use('/fairness', fairnessRoutes);
apiRouter.use('/admin', adminRoutes);

// Notifications endpoints (HLD Section 8 & 9)
apiRouter.get('/notifications', requireUser, (req, res) => {
  try {
    const items = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
    `).all(req.user.user_id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/notifications/mark-read', requireUser, (req, res) => {
  try {
    const { notificationId } = req.body || {};
    if (notificationId) {
      db.prepare(`UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`).run(
        String(notificationId),
        req.user.user_id
      );
    } else {
      db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user.user_id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top-level Custom Interval Availability API: GET /api/availability?labId=L106&date=&start=&end=
apiRouter.get('/availability', (req, res) => {
  try {
    const rawLab = String(req.query.labId || 'L106').toUpperCase();
    const labId = (rawLab === 'L106' || rawLab === 'L-106' || rawLab === 'LAB-L106') ? 'lab-l106' : req.query.labId;
    const availability = getLabAvailability(
      labId,
      req.query.date || null,
      req.query.slotId || null,
      req.query.start || null,
      req.query.end || null
    );
    res.json(availability);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Single workstation detail & interval availability (accepts L106-PC-05 OR A-R1-PC05)
apiRouter.get('/workstations/:id', (req, res) => {
  try {
    const date = req.query.date || getTodayDateString();
    const detail = getWorkstationAvailability(req.params.id, date);
    if (!detail) return res.status(404).json({ error: `Workstation ${req.params.id} not found` });
    res.json(detail);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/workstations/:id/availability', (req, res) => {
  try {
    const date = req.query.date || getTodayDateString();
    const detail = getWorkstationAvailability(req.params.id, date);
    if (!detail) return res.status(404).json({ error: `Workstation ${req.params.id} not found` });
    res.json(detail);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Hybrid Booking Request API with strict auth, Zod validation & rate limiting
apiRouter.post('/booking-requests', requireUser, bookingRateLimiter, validateBody(hybridRequestSchema), async (req, res) => {
  const userId = req.user.user_id;
  const idempKey = req.body.idempotencyKey || req.headers['idempotency-key'] || null;
  try {
    const result = await submitHybridBookingRequest({
      userId,
      slotId: req.body.slotId || null,
      bookingDate: req.body.bookingDate || null,
      startTime: req.body.startTime || null,
      endTime: req.body.endTime || null,
      preferredMachineId: req.body.preferredMachineId || null,
      preferredWorkstations: req.body.preferredWorkstations || null,
      computePurpose: req.body.computePurpose,
      researchField: req.body.researchField,
      allocationMode: req.body.allocationMode || 'AUTO',
      idempotencyKey: idempKey
    });

    if (result.status === 'CONFIRMED') {
      broadcast('booking.confirmed', {
        bookingId: result.booking?.bookingId,
        workstationId: result.booking?.displayLabel || result.booking?.machineId,
        startTime: result.startTime,
        endTime: result.endTime
      });
      broadcast('SLOT_UPDATED', { requestId: result.requestId });
    } else {
      broadcast('booking.requested', {
        requestId: result.requestId,
        startTime: result.startTime,
        endTime: result.endTime
      });
      broadcast('QUEUE_CHANGED', { requestId: result.requestId });
    }

    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

apiRouter.delete('/booking-requests/:id', requireUser, (req, res) => {
  try {
    const result = cancelBookingRequest(req.params.id, req.user.user_id);
    broadcast('booking.cancelled', { requestId: req.params.id });
    broadcast('QUEUE_CHANGED', { requestId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// Mount under both /api and /api/v1
app.use('/api/v1', apiRouter);
app.use('/api', apiRouter);

// Serve Frontend Static build
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/health')) {
      return res.sendFile(path.join(frontendDist, 'index.html'));
    }
    next();
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[FairLab Error]', err.stack);
  res.status(err.statusCode || 500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

const PORT = config.PORT;
server.listen(PORT, config.HOST, () => {
  console.log(`====================================================`);
  console.log(`FairLab API running on http://${config.HOST}:${PORT}`);
  console.log(`WebSocket server active for real-time seat map & queue`);
  console.log(`IIT Bhilai · Computer Lab L-106 (84 Workstations: Block A 6x10 + Block B 4x6)`);
  if (fs.existsSync(frontendDist)) {
    console.log(`Serving Frontend at http://${config.HOST}:${PORT}/`);
  }
  console.log(`====================================================`);
});

function shutdown() {
  console.log('\n[FairLab] Shutting down gracefully...');
  server.close(() => {
    try {
      if (db) db.close();
      console.log('[FairLab] SQLite database connection closed.');
    } catch (e) {
      // ignore
    }
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
