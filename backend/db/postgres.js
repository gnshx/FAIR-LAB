/**
 * FairLab PostgreSQL 16 Production Adapter
 * Exposes identical data access interface as SqliteAdapter for enterprise deployments.
 * Translates ? placeholders to $1, $2, ... and provides transactional row-level lock utilities.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function convertSqlPlaceholders(sql) {
  let paramIndex = 1;
  return sql
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/\?/g, () => `$${paramIndex++}`);
}

class PostgresAdapter {
  constructor(connectionStringOrConfig) {
    this.connectionString = typeof connectionStringOrConfig === 'string'
      ? connectionStringOrConfig
      : (process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fairlab_db');
    
    this.dialect = 'postgres';
    this.pool = new Pool(
      typeof connectionStringOrConfig === 'object'
        ? connectionStringOrConfig
        : {
            connectionString: this.connectionString,
            max: 20,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 5000
          }
    );
  }

  async get(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    const arr = Array.isArray(params) ? params : [params];
    const res = await this.pool.query(pgSql, arr);
    return res.rows[0] || null;
  }

  async all(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    const arr = Array.isArray(params) ? params : [params];
    const res = await this.pool.query(pgSql, arr);
    return res.rows;
  }

  async run(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    const arr = Array.isArray(params) ? params : [params];
    const res = await this.pool.query(pgSql, arr);
    return {
      changes: res.rowCount,
      lastInsertRowid: null
    };
  }

  async query(sql, params = []) {
    const pgSql = convertSqlPlaceholders(sql);
    const arr = Array.isArray(params) ? params : [params];
    const res = await this.pool.query(pgSql, arr);
    return { rows: res.rows, rowCount: res.rowCount };
  }

  async exec(sql) {
    return this.pool.query(sql);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txClient = {
        get: async (sql, params = []) => {
          const pgSql = convertSqlPlaceholders(sql);
          const arr = Array.isArray(params) ? params : [params];
          const res = await client.query(pgSql, arr);
          return res.rows[0] || null;
        },
        all: async (sql, params = []) => {
          const pgSql = convertSqlPlaceholders(sql);
          const arr = Array.isArray(params) ? params : [params];
          const res = await client.query(pgSql, arr);
          return res.rows;
        },
        run: async (sql, params = []) => {
          const pgSql = convertSqlPlaceholders(sql);
          const arr = Array.isArray(params) ? params : [params];
          const res = await client.query(pgSql, arr);
          return { changes: res.rowCount };
        },
        query: async (sql, params = []) => {
          const pgSql = convertSqlPlaceholders(sql);
          const arr = Array.isArray(params) ? params : [params];
          return client.query(pgSql, arr);
        }
      };

      const result = await fn(txClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

module.exports = PostgresAdapter;

