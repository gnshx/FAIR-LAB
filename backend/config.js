const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Auto-load .env if present (e.g. for standalone tests and CLI runners)
const envPath = path.resolve(__dirname, '../.env');
if (!process.env.IGNORE_DOTENV && fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

function resolveSecret(envKey) {
  if (process.env[envKey] && process.env[envKey].trim().length >= 16) {
    return process.env[envKey].trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required production environment variable: ${envKey}`);
  }
  // Ephemeral runtime secret for local development (never hardcoded in source)
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: resolveSecret('JWT_SECRET'),
  HMAC_SECRET: resolveSecret('HMAC_SECRET'),
  DB_PATH: process.env.FAIRLAB_DB_PATH || path.join(__dirname, 'fairlab.db'),
  DEFAULT_POLICY: {
    baseScore: 100,
    deductionPerBooking: 10,
    noShowPenalty: 5,
    highDemandDeductionPerHour: 0,
    cancellationWindowHours: 2,
    gracePeriodMinutes: 15,
    allocationMode: 'BATCH_ROUND'
  }
};
