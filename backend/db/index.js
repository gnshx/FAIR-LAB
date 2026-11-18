/**
 * FairLab Unified Database Interface & Factory
 * Dynamically boots SqliteAdapter (local zero-config) or PostgresAdapter (production scale)
 * based on environment configuration.
 */

const SqliteAdapter = require('./sqlite');
const PostgresAdapter = require('./postgres');

let activeAdapter = null;

function getDialect() {
  const envDialect = process.env.DB_DIALECT;
  const dbUrl = process.env.DATABASE_URL;

  if (envDialect === 'postgres' || (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')))) {
    return 'postgres';
  }
  return 'sqlite';
}

function getAdapter() {
  if (!activeAdapter) {
    const dialect = getDialect();
    if (dialect === 'postgres') {
      activeAdapter = new PostgresAdapter();
    } else {
      activeAdapter = new SqliteAdapter();
    }
  }
  return activeAdapter;
}

function getDb() {
  const adapter = getAdapter();
  // If SQLite, expose adapter which also supports .prepare() for backwards compatibility
  return adapter;
}

function resetDbConnection() {
  if (activeAdapter) {
    activeAdapter.close();
    activeAdapter = null;
  }
}

module.exports = {
  getDb,
  getAdapter,
  getDialect,
  resetDbConnection
};

