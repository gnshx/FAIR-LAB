/**
 * FairLab Independent Fairness Benchmark & Simulation Validator
 * Evaluates FairLab vs FIFO across 4 distinct real-world campus workload models
 * and 5 distinct PRNG seeds using identical request traces.
 */

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function calculateGini(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let sumDiffs = 0;
  let totalSum = 0;
  for (let i = 0; i < n; i++) {
    totalSum += sorted[i];
    for (let j = 0; j < n; j++) {
      sumDiffs += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return totalSum === 0 ? 0 : parseFloat((sumDiffs / (2 * n * totalSum)).toFixed(4));
}

function calculateJainsIndex(values) {
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const sumSquares = values.reduce((a, b) => a + b * b, 0);
  if (sumSquares === 0) return 1.0;
  return parseFloat(((sum * sum) / (n * sumSquares)).toFixed(4));
}

/**
 * Executes a side-by-side simulation using an identical request trace in each cycle
 */
function runWorkloadBenchmark({
  workloadType = 'UNIFORM',
  iterations = 150,
  cohortSize = 60,
  slotsPerRound = 10,
  seed = 1337
}) {
  const rand = mulberry32(seed);

  // Initialize identical student cohort
  const fifoStudents = Array.from({ length: cohortSize }, (_, i) => ({
    id: i,
    isBotOrFast: i < Math.floor(cohortSize * 0.15),
    isPowerUser: i < Math.floor(cohortSize * 0.20),
    allocatedCount: 0,
    requestedCount: 0
  }));

  const fairlabStudents = Array.from({ length: cohortSize }, (_, i) => ({
    id: i,
    score: 100,
    completedBookings: 0,
    cumulativeWait: 0,
    isBotOrFast: i < Math.floor(cohortSize * 0.15),
    isPowerUser: i < Math.floor(cohortSize * 0.20),
    allocatedCount: 0,
    requestedCount: 0
  }));

  for (let round = 0; round < iterations; round++) {
    // 1. Generate an IDENTICAL candidate request list for this round
    const candidatesThisRound = [];

    for (let i = 0; i < cohortSize; i++) {
      let willRequest = false;

      if (workloadType === 'UNIFORM') {
        // Equal request probability for all students (60%)
        willRequest = rand() < 0.60;
      } else if (workloadType === 'BURSTY_PARETO') {
        // 20% power users request 90% of the time, 80% casual users request 25% of the time
        const isPower = fifoStudents[i].isPowerUser;
        willRequest = isPower ? (rand() < 0.90) : (rand() < 0.25);
      } else if (workloadType === 'BOT_LATENCY_SKEW') {
        // High contention: Everyone wants a slot (85%), but network latencies vary widely
        willRequest = rand() < 0.85;
      } else if (workloadType === 'HIGH_CONTENTION') {
        // Extreme contention: 100% of students request in every single round
        willRequest = true;
      }

      if (willRequest) {
        // Compute arrival latency / timestamp:
        let latencyMs;
        if (workloadType === 'BOT_LATENCY_SKEW') {
          // Bots have 5-15ms, human students have 50-300ms
          latencyMs = fifoStudents[i].isBotOrFast ? (5 + rand() * 10) : (50 + rand() * 250);
        } else {
          // Standard latency with human reaction time jitter (10ms - 500ms)
          latencyMs = 10 + rand() * 490;
        }

        candidatesThisRound.push({
          studentId: i,
          arrivalLatencyMs: latencyMs
        });
      }
    }

    if (candidatesThisRound.length === 0) continue;

    // Record request count
    candidatesThisRound.forEach(c => {
      fifoStudents[c.studentId].requestedCount++;
      fairlabStudents[c.studentId].requestedCount++;
    });

    // 2. FIFO Allocation (Ranked purely by arrivalLatencyMs)
    const fifoSorted = [...candidatesThisRound].sort((a, b) => a.arrivalLatencyMs - b.arrivalLatencyMs);
    const fifoWinners = fifoSorted.slice(0, slotsPerRound);
    fifoWinners.forEach(w => {
      fifoStudents[w.studentId].allocatedCount++;
    });

    // 3. FairLab Allocation (Priority Score -> Wait Delta -> Arrival Latency)
    // First, increment wait time for all students who requested but weren't in previous allocations
    candidatesThisRound.forEach(c => {
      fairlabStudents[c.studentId].cumulativeWait += 1;
    });

    const fairlabSorted = [...candidatesThisRound].sort((a, b) => {
      const studentA = fairlabStudents[a.studentId];
      const studentB = fairlabStudents[b.studentId];

      // Tier 1: Priority Score (Higher wins)
      if (studentB.score !== studentA.score) {
        return studentB.score - studentA.score;
      }
      // Tier 2: Cumulative Wait (Higher wait wins)
      if (studentB.cumulativeWait !== studentA.cumulativeWait) {
        return studentB.cumulativeWait - studentA.cumulativeWait;
      }
      // Tier 3: Arrival timestamp
      return a.arrivalLatencyMs - b.arrivalLatencyMs;
    });

    const fairlabWinners = fairlabSorted.slice(0, slotsPerRound);
    fairlabWinners.forEach(w => {
      const student = fairlabStudents[w.studentId];
      student.allocatedCount++;
      student.completedBookings++;
      student.cumulativeWait = 0; // reset wait
      // Linear deduction with floor protection (P_u = max(5, 100 - 10 * B_u))
      student.score = Math.max(5, 100 - 10 * student.completedBookings);
    });
  }

  // Metrics computation
  const fifoAllocations = fifoStudents.map(s => s.allocatedCount);
  const fairlabAllocations = fairlabStudents.map(s => s.allocatedCount);

  // Starvation: Requested at least once, but received 0 allocations
  const fifoStarved = fifoStudents.filter(s => s.requestedCount > 0 && s.allocatedCount === 0).length;
  const fairlabStarved = fairlabStudents.filter(s => s.requestedCount > 0 && s.allocatedCount === 0).length;

  const fifoRequestedTotal = fifoStudents.filter(s => s.requestedCount > 0).length || 1;
  const fairlabRequestedTotal = fairlabStudents.filter(s => s.requestedCount > 0).length || 1;

  return {
    workloadType,
    seed,
    iterations,
    cohortSize,
    slotsPerRound,
    fifo: {
      gini: calculateGini(fifoAllocations),
      jainsIndex: calculateJainsIndex(fifoAllocations),
      starvationRatePct: parseFloat(((fifoStarved / fifoRequestedTotal) * 100).toFixed(1)),
      maxAllocated: Math.max(...fifoAllocations),
      minAllocated: Math.min(...fifoAllocations),
      zeroAllocationCount: fifoStarved
    },
    fairlab: {
      gini: calculateGini(fairlabAllocations),
      jainsIndex: calculateJainsIndex(fairlabAllocations),
      starvationRatePct: parseFloat(((fairlabStarved / fairlabRequestedTotal) * 100).toFixed(1)),
      maxAllocated: Math.max(...fairlabAllocations),
      minAllocated: Math.min(...fairlabAllocations),
      zeroAllocationCount: fairlabStarved
    }
  };
}

// Run multi-workload suite
console.log('========================================================================================');
console.log('📊 FAIRLAB SCIENTIFIC BENCHMARK SUITE — MULTI-WORKLOAD & MULTI-SEED VALIDATION');
console.log('========================================================================================\n');

const workloads = ['UNIFORM', 'BOT_LATENCY_SKEW', 'BURSTY_PARETO', 'HIGH_CONTENTION'];
const seeds = [1337, 42, 2026, 99999, 7142857];

const summaryResults = [];

for (const wl of workloads) {
  console.log(`\n▶ Workload: [${wl}] (Tested across 5 seeds: ${seeds.join(', ')})`);
  console.log('-'.repeat(88));
  console.log('SEED    FIFO GINI   FAIRLAB GINI   FIFO JAIN   FAIRLAB JAIN   FIFO STARVED   FAIRLAB STARVED');
  console.log('-'.repeat(88));

  let fifoGiniSum = 0, fairlabGiniSum = 0;
  let fifoJainSum = 0, fairlabJainSum = 0;
  let fifoStarveSum = 0, fairlabStarveSum = 0;

  for (const s of seeds) {
    const res = runWorkloadBenchmark({ workloadType: wl, seed: s, iterations: 150, cohortSize: 60, slotsPerRound: 10 });
    fifoGiniSum += res.fifo.gini;
    fairlabGiniSum += res.fairlab.gini;
    fifoJainSum += res.fifo.jainsIndex;
    fairlabJainSum += res.fairlab.jainsIndex;
    fifoStarveSum += res.fifo.starvationRatePct;
    fairlabStarveSum += res.fairlab.starvationRatePct;

    console.log(
      `${String(s).padEnd(7)} ` +
      `${res.fifo.gini.toFixed(3).padEnd(11)} ` +
      `${res.fairlab.gini.toFixed(3).padEnd(14)} ` +
      `${res.fifo.jainsIndex.toFixed(3).padEnd(11)} ` +
      `${res.fairlab.jainsIndex.toFixed(3).padEnd(14)} ` +
      `${(res.fifo.starvationRatePct + '%').padEnd(14)} ` +
      `${res.fairlab.starvationRatePct + '%'}`
    );
  }

  const n = seeds.length;
  const avgFifoGini = (fifoGiniSum / n).toFixed(3);
  const avgFairlabGini = (fairlabGiniSum / n).toFixed(3);
  const avgFifoJain = (fifoJainSum / n).toFixed(3);
  const avgFairlabJain = (fairlabJainSum / n).toFixed(3);
  const avgFifoStarve = (fifoStarveSum / n).toFixed(1);
  const avgFairlabStarve = (fairlabStarveSum / n).toFixed(1);

  console.log('-'.repeat(88));
  console.log(
    `MEAN    ${avgFifoGini.padEnd(11)} ${avgFairlabGini.padEnd(14)} ${avgFifoJain.padEnd(11)} ${avgFairlabJain.padEnd(14)} ${(avgFifoStarve + '%').padEnd(14)} ${avgFairlabStarve + '%'}`
  );

  summaryResults.push({
    workload: wl,
    avgFifoGini,
    avgFairlabGini,
    avgFifoJain,
    avgFairlabJain,
    avgFifoStarve,
    avgFairlabStarve
  });
}

console.log('\n========================================================================================');
console.log('📋 SUMMARY TABLE — FAIRLAB VS FIFO ACROSS WORKLOAD ENVIRONMENTS');
console.log('========================================================================================');
console.table(summaryResults);

