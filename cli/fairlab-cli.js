#!/usr/bin/env node

/**
 * FairLab CLI — Command-Line Management Tool for IIT Bhilai L-106 Cluster
 * Provides immediate terminal access for lab admins, security guards, and operators.
 */

const http = require('http');

const API_BASE = 'http://localhost:5000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resData) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resData });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function printHelp() {
  console.log(`
\x1b[1m\x1b[34m🏛️  FAIRLAB CLI — IIT BHILAI COMPUTER LAB L-106\x1b[0m
Usage: node cli/fairlab-cli.js <command> [args]

Commands:
  \x1b[32mstatus\x1b[0m                 Display real-time telemetry grid of all 24 workstations in L-106
  \x1b[32mscan <token>\x1b[0m           Simulate optical gate scan for a student's digital pass
  \x1b[32mqueue [slotId]\x1b[0m         View live ranked waitlist queue with tie-breaking diagnostics
  \x1b[32mcheck-in <passId>\x1b[0m      Authorize student entry and unlock turnstile
  \x1b[32mcheck-out <bookingId>\x1b[0m  Log student session completion and deduct 10 fairness points
  \x1b[32msimulate [n]\x1b[0m           Run deterministic Monte Carlo fairness simulation
  \x1b[32mhelp\x1b[0m                   Show this command reference
`);
}

async function showStatus() {
  try {
    const res = await request('GET', '/api/labs/L106/workstations');
    if (res.status !== 200) {
      console.error('\x1b[31mError fetching workstations:\x1b[0m', res.data);
      return;
    }

    const rigs = res.data;
    console.log(`\n\x1b[1m\x1b[36m========================================================================================\x1b[0m`);
    console.log(`\x1b[1m\x1b[36m🏛️  IIT BHILAI · LAB L-106 WORKSTATION TELEMETRY (${rigs.length} NODES)\x1b[0m`);
    console.log(`\x1b[1m\x1b[36m========================================================================================\x1b[0m`);
    console.log(`\x1b[1m%-12s %-12s %-10s %-8s %-20s %-24s\x1b[0m`
      .replace('%-12s', 'RIG ID      ')
      .replace('%-12s', 'STATUS      ')
      .replace('%-10s', 'VRAM (GB) ')
      .replace('%-8s', 'TEMP    ')
      .replace('%-20s', 'ACTIVE USER         ')
      .replace('%-24s', 'JOB DESCRIPTION         ')
    );
    console.log('-'.repeat(88));

    for (const r of rigs) {
      let statusColor = '\x1b[32m'; // green for available
      if (r.status === 'OCCUPIED') statusColor = '\x1b[34m'; // blue
      else if (r.status === 'BOOKED') statusColor = '\x1b[33m'; // yellow
      else if (r.status === 'MAINTENANCE') statusColor = '\x1b[31m'; // red

      const user = r.current_user_name ? `${r.current_user_name}`.padEnd(20) : '—'.padEnd(20);
      const job = r.active_job ? `${r.active_job.substring(0, 22)}...`.padEnd(24) : 'Idle'.padEnd(24);
      const vram = `${r.current_vram_used || 0}/${r.vram_gb}G`.padEnd(10);
      const temp = `${r.temperature_c || 35}°C`.padEnd(8);

      console.log(
        `${r.machine_id.padEnd(12)} ${statusColor}${r.status.padEnd(12)}\x1b[0m ${vram} ${temp} ${user} ${job}`
      );
    }
    console.log('-'.repeat(88));
  } catch (e) {
    console.error('\x1b[31mFailed to connect to FairLab server at http://localhost:5000\x1b[0m', e.message);
  }
}

async function scanToken(token) {
  if (!token) {
    console.error('\x1b[31mError: Please provide a signed pass token to scan.\x1b[0m');
    console.log('Example: node cli/fairlab-cli.js scan FAIRPASS:L106-2026-00125:dcef651cb7cbf9a9');
    return;
  }

  console.log(`\n\x1b[36m[Optical Laser Scanner] Reading token: ${token}...\x1b[0m`);
  try {
    const res = await request('POST', '/api/access/verify', { token });
    if (res.data.authorized) {
      console.log('\x1b[1m\x1b[32m========================================================\x1b[0m');
      console.log('\x1b[1m\x1b[32m✅ ACCESS GRANTED · DIGITAL TURNSTILE AUTHORIZED\x1b[0m');
      console.log('\x1b[1m\x1b[32m========================================================\x1b[0m');
      console.log(`Student:       \x1b[1m${res.data.student.name} (${res.data.student.roll_no})\x1b[0m`);
      console.log(`Department:    ${res.data.student.department}`);
      console.log(`Workstation:   \x1b[1m\x1b[34m${res.data.workstation.machine_id}\x1b[0m (${res.data.workstation.gpu_model})`);
      console.log(`Slot Window:   ${res.data.slot.name} (${res.data.slot.time_window})`);
      console.log(`Pass ID:       ${res.data.passId}`);
      console.log(`Token Hash:    ${res.data.tokenHash}`);
      console.log(`Relay Trigger: ACTIVE (Pulse 500ms)`);
      console.log('\x1b[32m--------------------------------------------------------\x1b[0m\n');
    } else {
      console.log('\x1b[1m\x1b[31m========================================================\x1b[0m');
      console.log('\x1b[1m\x1b[31m❌ ACCESS DENIED · ENTRY FORBIDDEN\x1b[0m');
      console.log('\x1b[1m\x1b[31m========================================================\x1b[0m');
      console.log(`Reason Code:   \x1b[1m${res.data.code}\x1b[0m`);
      console.log(`Message:       ${res.data.message}`);
      console.log('\x1b[31m--------------------------------------------------------\x1b[0m\n');
    }
  } catch (e) {
    console.error('\x1b[31mGate verification error:\x1b[0m', e.message);
  }
}

async function showQueue(slotId = 'slot-3') {
  try {
    const res = await request('GET', `/api/bookings/queue/${slotId}`);
    if (res.status !== 200) {
      console.error('\x1b[31mError fetching queue:\x1b[0m', res.data);
      return;
    }

    const { slot, queue } = res.data;
    console.log(`\n\x1b[1m\x1b[34m🏛️  FAIR-SHARE QUEUE FOR ${slot.slot_name.toUpperCase()} (${slot.start_time} - ${slot.end_time})\x1b[0m`);
    console.log(`Slot Capacity: ${slot.capacity} rigs · Total Queued Candidates: ${queue.length}`);
    console.log('-'.repeat(80));
    console.log(`\x1b[1mRANK  STUDENT NAME           ROLL NO      SCORE    WAIT TIME  STATUS\x1b[0m`);
    console.log('-'.repeat(80));

    queue.forEach((cand, idx) => {
      const rank = String(idx + 1).padStart(2);
      const name = cand.student_name.padEnd(22);
      const roll = cand.roll_no.padEnd(12);
      const score = `${cand.priority_score_snapshot} pts`.padEnd(8);
      const wait = `${Math.floor(cand.wait_time_seconds / 60)}m`.padEnd(10);
      const status = cand.status;
      console.log(`${rank}    ${name} ${roll} ${score} ${wait} ${status}`);
    });
    console.log('-'.repeat(80) + '\n');
  } catch (e) {
    console.error('\x1b[31mFailed to fetch queue:\x1b[0m', e.message);
  }
}

async function runSimulation(iterations = 200) {
  try {
    console.log(`\n\x1b[36mRunning Deterministic Mulberry32 Monte Carlo Simulation (${iterations} iterations)...\x1b[0m`);
    const res = await request('GET', `/api/fairness/simulation?iterations=${iterations}`);
    if (res.status !== 200) {
      console.error('\x1b[31mSimulation failed:\x1b[0m', res.data);
      return;
    }

    const sim = res.data;
    console.log('\n\x1b[1m\x1b[32m====================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m📊 DETERMINISTIC MONTE CARLO FAIRNESS AUDIT REPORT\x1b[0m');
    console.log('\x1b[1m\x1b[32m====================================================================\x1b[0m');
    console.log(`Methodology:      ${sim.methodology.description}`);
    console.log(`PRNG Algorithm:   ${sim.methodology.prngAlgorithm} (Seed: ${sim.methodology.seed})`);
    console.log(`Total Cohort:     ${sim.cohortSize} students · ${sim.iterations} allocation cycles`);
    console.log('-'.repeat(68));
    console.log(`\x1b[1mMETRIC                    FAIRLAB ALGORITHM       STANDARD FIFO\x1b[0m`);
    console.log('-'.repeat(68));
    console.log(`Gini Coefficient:         \x1b[32m${sim.fairLab.giniCoefficient}\x1b[0m                  \x1b[31m${sim.fifo.giniCoefficient}\x1b[0m`);
    console.log(`Starvation Rate:          \x1b[32m${sim.fairLab.starvationRate}\x1b[0m                   \x1b[31m${sim.fifo.starvationRate}\x1b[0m`);
    console.log(`Total GPU Allocations:    ${sim.fairLab.totalAllocations}                     ${sim.fifo.totalAllocations}`);
    console.log(`Allocation Variance:      \x1b[32m${sim.fairLab.variance}\x1b[0m                  \x1b[31m${sim.fifo.variance}\x1b[0m`);
    console.log(`Standard Deviation:       \x1b[32m${sim.fairLab.stdDev}\x1b[0m                    \x1b[31m${sim.fifo.stdDev}\x1b[0m`);
    console.log('-'.repeat(68));
    console.log(`\x1b[33mTheoretical Insight:\x1b[0m ${sim.methodology.theoreticalInsight}`);
    console.log('\x1b[32m====================================================================\x1b[0m\n');
  } catch (e) {
    console.error('\x1b[31mSimulation execution error:\x1b[0m', e.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command.toLowerCase()) {
    case 'status':
      await showStatus();
      break;
    case 'scan':
      await scanToken(args[1]);
      break;
    case 'queue':
      await showQueue(args[1]);
      break;
    case 'simulate':
      await runSimulation(parseInt(args[1], 10) || 200);
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

main();

