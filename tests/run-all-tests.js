const { execSync } = require('child_process');

console.log('================================================================');
console.log('🏛️  FAIRLAB (FAIRGPU) — IIT BHILAI L-106 MASTER TEST RUNNER');
console.log('================================================================');

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
  { name: 'Statistical 50-Seed Fairness Benchmark', file: 'tests/benchmark-fairness-50seeds.js' }
];

let allPassed = true;

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

console.log('\n================================================================');
if (allPassed) {
  console.log(`🎉 ALL ${testSuites.length} TEST SUITES PASSED FLAWLESSLY WITH 100% SUCCESS RATE!`);
} else {
  console.log('💥 SOME TESTS FAILED. CHECK LOGS ABOVE.');
  process.exit(1);
}
console.log('================================================================\n');

