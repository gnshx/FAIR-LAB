const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');

// Ensure consistent JWT/HMAC secret across test runner and child processes
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fairlab-jwt-secret-stable-for-all-test-suites-32chars';
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'fairlab-hmac-secret-stable-for-all-test-suites-32chars';

console.log('================================================================');
console.log('🏛️  FAIRLAB (FAIRGPU) — IIT BHILAI L-106 MASTER TEST RUNNER');
console.log('================================================================');

function checkHealth(port = 5000, timeout = 800) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, { timeout }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  let spawnedServer = null;
  const isHealthy = await checkHealth(5000);
  if (isHealthy) {
    console.log('📡 Connected to live FairLab server on port 5000.\n');
  } else {
    console.log('🚀 Spawning FairLab backend on port 5000 for test harness...');
    spawnedServer = spawn(process.execPath, [path.resolve(__dirname, '../backend/server.js')], {
      env: { ...process.env, PORT: '5000', NODE_ENV: 'development' },
      stdio: 'ignore'
    });

    const deadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      if (await checkHealth(5000)) {
        ready = true;
        break;
      }
    }
    if (ready) {
      console.log('✅ FairLab test server ready on port 5000.\n');
    }
  }

  const testSuites = [
    { name: 'Full System End-to-End Integration Test', file: 'test-system.js' },
    { name: 'High-Priority Test 1: Concurrency (100 Requests vs 5 Slots)', file: 'tests/test-concurrency.js' },
    { name: 'High-Priority Test 2: Semester Reset & Score Independence', file: 'tests/test-semester-reset.js' },
    { name: 'High-Priority Test 3: Cryptographic QR Security & RBAC', file: 'tests/test-qr-security.js' },
    { name: 'High-Priority Test 4: Time Overlap Detection & Worker Concurrency', file: 'tests/test-overlap-concurrency.js' },
    { name: 'Production Database Test: PostgreSQL 16 Live Operations', file: 'tests/test-postgres.js' },
    { name: 'Production Invariant & Application Test on PostgreSQL 16', file: 'tests/test-app-on-postgres.js' },
    { name: 'Backend Audit & Mathematical Edge-Case Invariants', file: 'tests/test-backend-audit-edge-cases.js' },
    { name: 'Seat Map (84 Systems), Hours+Peak Fairness, No-Show & 1,000-Query Benchmark', file: 'tests/test-seatmap-fairness-v2.js' },
    { name: 'Custom [start, end) Intervals, Multi-Preference Matching & 3-Policy Comparison', file: 'tests/test-custom-interval-v3.js' },
    { name: 'Adversarial Red-Team: Anti-Cheat, RBAC, IDOR, Concurrency & Crash Fuzzing', file: 'tests/test-adversarial-redteam.js' },
    { name: 'Max 2h Limit, Mon–Fri Academic Timetable, Holidays/Extra Days & Ticket Releases', file: 'tests/test-schedule-timetable-tickets.js' },
    { name: 'Autonomous Allocation Engine & Overlap Conflict Resilience', file: 'tests/test-autonomous-overlap-fixes.js' },
    { name: 'Statistical 50-Seed Fairness Benchmark', file: 'tests/benchmark-fairness-50seeds.js' },
    { name: 'Phase 10: Final Validation (Clean DB, E2E Journey, Production JWT/Cookie & Outbox Recovery)', file: 'tests/test-phase10-validation.js' }
  ];

  let allPassed = true;

  try {
    for (const suite of testSuites) {
      console.log(`\n▶ Running [${suite.name}]...`);
      try {
        execSync(`node ${suite.file}`, { stdio: 'inherit' });
        console.log(`✅ [${suite.name}] PASSED`);
      } catch (err) {
        console.error(`❌ [${suite.name}] FAILED`);
        allPassed = false;
        break;
      }
    }
  } finally {
    if (spawnedServer && !spawnedServer.killed) {
      try { spawnedServer.kill('SIGTERM'); } catch {}
    }
  }

  console.log('\n================================================================');
  if (allPassed) {
    console.log(`🎉 ALL ${testSuites.length} TEST SUITES PASSED FLAWLESSLY WITH 100% SUCCESS RATE!`);
  } else {
    console.log('💥 SOME TESTS FAILED. CHECK LOGS ABOVE.');
    process.exit(1);
  }
  console.log('================================================================\n');
}

main();

