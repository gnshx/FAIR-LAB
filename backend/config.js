const crypto = require('crypto');
const path = require('path');

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
