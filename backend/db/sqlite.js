/**
 * FairLab SQLite Adapter (Better-SQLite3)
 * Provides unified data access interface for local zero-config demonstration.
 */

const Database = require('better-sqlite3');
const config = require('../config');

class SqliteAdapter {
  constructor(dbPath = config.DB_PATH) {
    this.dbPath = dbPath;
    this.dialect = 'sqlite';
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 10000');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this._initializeSchema();
  }

  _initializeSchema() {
    const { initializeSchema } = require('./database');
    initializeSchema(this.db);
  }

  /**
   * Translates common SQL syntax differences
   */
  _normalizeSql(sql) {
    return sql
      .replace(/NOW\(\)/gi, "datetime('now')")
      .replace(/CURRENT_TIMESTAMP/gi, "datetime('now')");
  }

  get(sql, params = []) {
    const normSql = this._normalizeSql(sql);
    const arr = Array.isArray(params) ? params : [params];
    return this.db.prepare(normSql).get(...arr) || null;
  }

  all(sql, params = []) {
    const normSql = this._normalizeSql(sql);
    const arr = Array.isArray(params) ? params : [params];
    return this.db.prepare(normSql).all(...arr);
  }

  run(sql, params = []) {
    const normSql = this._normalizeSql(sql);
    const arr = Array.isArray(params) ? params : [params];
    const info = this.db.prepare(normSql).run(...arr);
    return {
      changes: info.changes,
      lastInsertRowid: info.lastInsertRowid
    };
  }

  query(sql, params = []) {
    const rows = this.all(sql, params);
    return { rows, rowCount: rows.length };
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  transaction(fn) {
    const tx = this.db.transaction((...args) => {
      const txClient = {
        get: (s, p) => this.get(s, p),
        all: (s, p) => this.all(s, p),
        run: (s, p) => this.run(s, p),
        query: (s, p) => this.query(s, p),
        prepare: (s) => this.db.prepare(this._normalizeSql(s))
      };
      return fn(txClient, ...args);
    });
    return tx();
  }

  prepare(sql) {
    return this.db.prepare(this._normalizeSql(sql));
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = SqliteAdapter;

