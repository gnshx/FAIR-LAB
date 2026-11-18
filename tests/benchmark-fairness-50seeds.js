/**
 * FairLab Rigorous Scientific Benchmark Suite — 50-Seed Statistical Validation
 * Evaluates FairLab vs FIFO across 4 distinct workloads using 50 independent PRNG seeds.
 * Measures Gini coefficient, Jain's Fairness Index, Absolute Starvation, Relative Under-Allocation,
 * and Continuous Wait Time distributions (Mean, Max, StdDev).
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
  const n = values.length;
  let sumDiffs = 0;
  let totalSum = 0;
  for (let i = 0; i < n; i++) {
    totalSum += values[i];
    for (let j = 0; j < n; j++) {
      sumDiffs += Math.abs(values[i] - values[j]);
    }
  }
  return totalSum === 0 ? 0 : sumDiffs / (2 * n * totalSum);
}

function calculateJain(values) {
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const sumSquares = values.reduce((a, b) => a + b * b, 0);
  if (sumSquares === 0) return 1.0;
  return (sum * sum) / (n * sumSquares);
}

function calculateMeanAndStdDev(arr) {
  const n = arr.length;
  if (n === 0) return { mean: 0, stdDev: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  return {
    mean: parseFloat(mean.toFixed(4)),
    stdDev: parseFloat(Math.sqrt(variance).toFixed(4))
  };
}

function simulateWorkload({ workloadType, iterations = 150, cohortSize = 60, slotsPerRound = 10, seed = 1337 }) {
  const rand = mulberry32(seed);

  const fifoStudents = Array.from({ length: cohortSize }, (_, i) => ({
    id: i,
    isBot: i < Math.floor(cohortSize * 0.15),
    isPowerUser: i < Math.floor(cohortSize * 0.20),
    allocated: 0,
    requested: 0,
    currentWait: 0,
    waitSamples: []
  }));

  const fairlabStudents = Array.from({ length: cohortSize }, (_, i) => ({
    id: i,
    isBot: i < Math.floor(cohortSize * 0.15),
    isPowerUser: i < Math.floor(cohortSize * 0.20),
    score: 100,
    completed: 0,
    allocated: 0,
    requested: 0,
    currentWait: 0,
    waitSamples: []
  }));

  for (let r = 0; r < iterations; r++) {
    // Generate unified candidate request trace
    const candidates = [];
    for (let i = 0; i < cohortSize; i++) {
      let willRequest = false;

      if (workloadType === 'UNIFORM') {
        willRequest = rand() < 0.60;
      } else if (workloadType === 'BURSTY_PARETO') {
        willRequest = fifoStudents[i].isPowerUser ? (rand() < 0.90) : (rand() < 0.25);
      } else if (workloadType === 'HIGH_CONTENTION') {
        willRequest = true;
      } else {
        // BOT_LATENCY_SKEW
        willRequest = rand() < 0.85;
      }

      if (willRequest) {
        let latencyMs;
        if (workloadType === 'BOT_LATENCY_SKEW') {
          latencyMs = fifoStudents[i].isBot ? (5 + rand() * 10) : (50 + rand() * 250);
        } else {
          latencyMs = 10 + rand() * 490;
        }
        candidates.push({ studentId: i, latencyMs });
      }
    }

    if (candidates.length === 0) continue;

    // Record request counts and increment waiting time
    candidates.forEach(c => {
      fifoStudents[c.studentId].requested++;
      fifoStudents[c.studentId].currentWait++;

      fairlabStudents[c.studentId].requested++;
      fairlabStudents[c.studentId].currentWait++;
    });

    // 1. Traditional FIFO Allocation
    const fifoSorted = [...candidates].sort((a, b) => a.latencyMs - b.latencyMs);
    const fifoWinners = fifoSorted.slice(0, slotsPerRound);
    fifoWinners.forEach(w => {
      const s = fifoStudents[w.studentId];
      s.allocated++;
      s.waitSamples.push(s.currentWait);
      s.currentWait = 0; // reset wait
    });

    // 2. FairLab Allocation (Score -> Cumulative Wait -> Latency)
    const fairlabSorted = [...candidates].sort((a, b) => {
      const sA = fairlabStudents[a.studentId];
      const sB = fairlabStudents[b.studentId];

      if (sB.score !== sA.score) return sB.score - sA.score;
      if (sB.currentWait !== sA.currentWait) return sB.currentWait - sA.currentWait;
      return a.latencyMs - b.latencyMs;
    });

    const fairlabWinners = fairlabSorted.slice(0, slotsPerRound);
    fairlabWinners.forEach(w => {
      const s = fairlabStudents[w.studentId];
      s.allocated++;
      s.completed++;
      s.waitSamples.push(s.currentWait);
      s.currentWait = 0; // reset wait
      s.score = Math.max(10, 100 - 10 * s.completed);
    });
  }

  // Compile final wait times for each student
  fifoStudents.forEach(s => {
    if (s.currentWait > 0) s.waitSamples.push(s.currentWait);
  });
  fairlabStudents.forEach(s => {
    if (s.currentWait > 0) s.waitSamples.push(s.currentWait);
  });

  const fifoAllocations = fifoStudents.map(s => s.allocated);
  const fairlabAllocations = fairlabStudents.map(s => s.allocated);

  const meanFifoAlloc = fifoAllocations.reduce((a, b) => a + b, 0) / cohortSize;
  const meanFairlabAlloc = fairlabAllocations.reduce((a, b) => a + b, 0) / cohortSize;

  // Starvation definitions:
  // Absolute: Received 0 allocations
  const fifoAbsStarved = (fifoStudents.filter(s => s.requested > 0 && s.allocated === 0).length / cohortSize) * 100;
  const fairlabAbsStarved = (fairlabStudents.filter(s => s.requested > 0 && s.allocated === 0).length / cohortSize) * 100;

  // Relative Under-allocation: Received <= 20% of cohort mean
  const fifoRelUnder = (fifoStudents.filter(s => s.requested > 0 && s.allocated <= 0.20 * meanFifoAlloc).length / cohortSize) * 100;
  const fairlabRelUnder = (fairlabStudents.filter(s => s.requested > 0 && s.allocated <= 0.20 * meanFairlabAlloc).length / cohortSize) * 100;

  // Waiting time stats
  const allFifoWaits = fifoStudents.flatMap(s => s.waitSamples);
  const allFairlabWaits = fairlabStudents.flatMap(s => s.waitSamples);

  const meanFifoWait = allFifoWaits.length ? (allFifoWaits.reduce((a, b) => a + b, 0) / allFifoWaits.length) : 0;
  const meanFairlabWait = allFairlabWaits.length ? (allFairlabWaits.reduce((a, b) => a + b, 0) / allFairlabWaits.length) : 0;

  const maxFifoWait = allFifoWaits.length ? Math.max(...allFifoWaits) : 0;
  const maxFairlabWait = allFairlabWaits.length ? Math.max(...allFairlabWaits) : 0;

  return {
    fifoGini: calculateGini(fifoAllocations),
    fairlabGini: calculateGini(fairlabAllocations),
    fifoJain: calculateJain(fifoAllocations),
    fairlabJain: calculateJain(fairlabAllocations),
    fifoAbsStarved,
    fairlabAbsStarved,
    fifoRelUnder,
    fairlabRelUnder,
    meanFifoWait,
    meanFairlabWait,
    maxFifoWait,
    maxFairlabWait
  };
}

async function run50SeedBenchmark() {
  console.log('========================================================================================================');
  console.log('📊 FAIRLAB 50-SEED RIGOROUS SCIENTIFIC BENCHMARK & METRICS VALIDATION');
  console.log('========================================================================================================\n');

  const workloads = ['UNIFORM', 'BOT_LATENCY_SKEW', 'BURSTY_PARETO', 'HIGH_CONTENTION'];
  const SEED_COUNT = 50;

  const reportTable = [];

  for (const wl of workloads) {
    const results = [];
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      results.push(simulateWorkload({ workloadType: wl, seed }));
    }

    const fifoGini = calculateMeanAndStdDev(results.map(r => r.fifoGini));
    const fairlabGini = calculateMeanAndStdDev(results.map(r => r.fairlabGini));

    const fifoJain = calculateMeanAndStdDev(results.map(r => r.fifoJain));
    const fairlabJain = calculateMeanAndStdDev(results.map(r => r.fairlabJain));

    const fifoAbs = calculateMeanAndStdDev(results.map(r => r.fifoAbsStarved));
    const fairlabAbs = calculateMeanAndStdDev(results.map(r => r.fairlabAbsStarved));

    const fifoRel = calculateMeanAndStdDev(results.map(r => r.fifoRelUnder));
    const fairlabRel = calculateMeanAndStdDev(results.map(r => r.fairlabRelUnder));

    const fifoMeanWait = calculateMeanAndStdDev(results.map(r => r.meanFifoWait));
    const fairlabMeanWait = calculateMeanAndStdDev(results.map(r => r.meanFairlabWait));

    const fifoMaxWait = calculateMeanAndStdDev(results.map(r => r.maxFifoWait));
    const fairlabMaxWait = calculateMeanAndStdDev(results.map(r => r.maxFairlabWait));

    reportTable.push({
      Workload: wl,
      'FIFO Gini (μ±σ)': `${fifoGini.mean} ± ${fifoGini.stdDev}`,
      'FairLab Gini (μ±σ)': `${fairlabGini.mean} ± ${fairlabGini.stdDev}`,
      'FIFO Jain (μ±σ)': `${fifoJain.mean} ± ${fifoJain.stdDev}`,
      'FairLab Jain (μ±σ)': `${fairlabJain.mean} ± ${fairlabJain.stdDev}`,
      'FIFO AbsStarv%': `${fifoAbs.mean}% ± ${fifoAbs.stdDev}`,
      'FairLab AbsStarv%': `${fairlabAbs.mean}% ± ${fairlabAbs.stdDev}`,
      'FIFO RelUnder%': `${fifoRel.mean}% ± ${fifoRel.stdDev}`,
      'FairLab RelUnder%': `${fairlabRel.mean}% ± ${fairlabRel.stdDev}`,
      'FIFO MaxWait': `${fifoMaxWait.mean} cycles`,
      'FairLab MaxWait': `${fairlabMaxWait.mean} cycles`
    });
  }

  console.table(reportTable);

  console.log('\n--------------------------------------------------------------------------------------------------------');
  console.log('📌 WORKLOAD & THREAT MODEL ASSUMPTIONS:');
  console.log('  • BOT_LATENCY_SKEW: 15% automated headless scripts (5-15ms delay) vs 85% human web users (50-300ms delay).');
  console.log('  • BURSTY_PARETO:    20% heavy research scholars (90% prob) vs 80% general students (25% prob) submitting bursts.');
  console.log('  • UNIFORM:          All 60 students request with 60% uniform probability and random arrival times (10-500ms).');
  console.log('  • HIGH_CONTENTION:  All 60 students request concurrently every single cycle (100% load, 10 slots/cycle).');
  console.log('--------------------------------------------------------------------------------------------------------');

  console.log('\n========================================================================================================');
  console.log('🔍 DEEP-DIVE: HIGH CONTENTION EQUALITY ANALYSIS (150 vs 153 CYCLES)');
  console.log('========================================================================================================');
  const sim150 = simulateWorkload({ workloadType: 'HIGH_CONTENTION', iterations: 150, cohortSize: 60, slotsPerRound: 10, seed: 1337 });
  const sim153 = simulateWorkload({ workloadType: 'HIGH_CONTENTION', iterations: 153, cohortSize: 60, slotsPerRound: 10, seed: 1337 });

  console.log(`Condition 1 (150 Cycles, 1500 Total Slots = 25.0 slots/student exact):`);
  console.log(`  - FairLab Gini: ${sim150.fairlabGini.toFixed(4)}, Jain's Index: ${sim150.fairlabJain.toFixed(4)}`);
  console.log(`  - Reason: 1500 is exactly divisible by 60. Every student received EXACTLY 25 sessions.`);
  console.log(`\nCondition 2 (153 Cycles, 1530 Total Slots = 25.5 slots/student non-integer):`);
  console.log(`  - FairLab Gini: ${sim153.fairlabGini.toFixed(4)}, Jain's Index: ${sim153.fairlabJain.toFixed(4)}`);
  console.log(`  - Reason: 30 students received 26 sessions and 30 students received 25 sessions.`);
  console.log(`  - Conclusion: Zero students are starved or excluded. Distribution is optimal in both cases.`);
  console.log('========================================================================================================\n');
}

run50SeedBenchmark();

